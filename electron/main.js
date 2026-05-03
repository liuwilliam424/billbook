const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const fsp = require("node:fs/promises");
const { createSettingsStore } = require("./lib/settings-store");
const {
  ensureInsideRoot,
  listEntries,
  readEntryFile,
  saveEntry
} = require("./lib/journal-store");

const APP_TITLE = "Billbook";

let mainWindow = null;
let allowClose = false;
let isDirty = false;
let watcher = null;
const settingsStore = createSettingsStore(app);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

function closeWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

function debounce(callback, delay) {
  let timeoutId = null;

  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), delay);
  };
}

async function pathExists(targetPath) {
  if (!targetPath) {
    return false;
  }

  try {
    await fsp.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function watchJournalDirectory(rootDirectory) {
  closeWatcher();

  if (!rootDirectory) {
    return;
  }

  if (!(await pathExists(rootDirectory))) {
    return;
  }

  const emitChange = debounce((payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("journal:directory-changed", payload);
    }
  }, 160);

  watcher = fs.watch(rootDirectory, { recursive: true }, (eventType, filename) => {
    emitChange({
      eventType,
      filename: filename ? filename.toString() : ""
    });
  });

  watcher.on("error", (error) => {
    console.error("Journal watcher error:", error);
  });
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

async function getSettingsWithWatcher() {
  const settings = await settingsStore.load();
  const exists = await pathExists(settings.journalDirectory);

  if (exists) {
    await watchJournalDirectory(settings.journalDirectory);
  }

  return {
    ...settings,
    journalDirectoryMissing: Boolean(settings.journalDirectory) && !exists
  };
}

async function getJournalDirectoryState() {
  const settings = await settingsStore.load();
  const journalDirectory = settings.journalDirectory || "";
  const exists = await pathExists(journalDirectory);

  return {
    settings,
    journalDirectory,
    exists
  };
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: APP_TITLE,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f1ede3",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));

  mainWindow.on("close", async (event) => {
    if (allowClose || !isDirty) {
      return;
    }

    event.preventDefault();

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Save and Close", "Discard Changes", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: APP_TITLE,
      message: "You have unsaved journal changes.",
      detail: "Save your current entry before closing?"
    });

    if (response === 0) {
      mainWindow.webContents.send("app:save-before-close");
      return;
    }

    if (response === 1) {
      allowClose = true;
      mainWindow.close();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerSettingsHandlers() {
  ipcMain.handle("settings:get", async () => getSettingsWithWatcher());

  ipcMain.handle("settings:choose-journal-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Journal Directory",
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || !result.filePaths[0]) {
      return getSettingsWithWatcher();
    }

    const settings = await settingsStore.load();
    settings.journalDirectory = result.filePaths[0];
    await fsp.mkdir(settings.journalDirectory, { recursive: true });
    await settingsStore.save(settings);
    await watchJournalDirectory(settings.journalDirectory);
    return {
      ...settings,
      journalDirectoryMissing: false
    };
  });

  ipcMain.handle("settings:open-journal-directory", async () => {
    const { journalDirectory, exists } = await getJournalDirectoryState();

    if (!journalDirectory) {
      return false;
    }

    if (!exists) {
      throw new Error("The selected journal folder could not be found.");
    }

    const errorMessage = await shell.openPath(journalDirectory);

    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return true;
  });
}

function registerJournalHandlers() {
  ipcMain.handle("journal:list-entries", async () => {
    const { journalDirectory, exists } = await getJournalDirectoryState();

    if (!journalDirectory) {
      return {
        journalDirectory: "",
        journalDirectoryMissing: false,
        entries: []
      };
    }

    if (!exists) {
      closeWatcher();
      return {
        journalDirectory,
        journalDirectoryMissing: true,
        entries: []
      };
    }

    await watchJournalDirectory(journalDirectory);

    return {
      journalDirectory,
      journalDirectoryMissing: false,
      entries: await listEntries(journalDirectory)
    };
  });

  ipcMain.handle("journal:read-entry", async (_event, filePath) => {
    const { journalDirectory, exists } = await getJournalDirectoryState();

    if (!journalDirectory) {
      throw new Error("No journal directory configured.");
    }

    if (!exists) {
      throw new Error("The selected journal folder could not be found.");
    }

    return readEntryFile(ensureInsideRoot(journalDirectory, filePath));
  });

  ipcMain.handle("journal:save-entry", async (_event, entry) => {
    const { journalDirectory, exists } = await getJournalDirectoryState();

    if (!journalDirectory) {
      throw new Error("Choose a journal directory before saving an entry.");
    }

    if (!exists) {
      throw new Error("The selected journal folder is missing. Locate it again before saving.");
    }

    const savedEntry = await saveEntry(journalDirectory, entry);

    return {
      journalDirectory,
      entry: savedEntry
    };
  });
}

function registerAppHandlers() {
  ipcMain.handle("app:set-dirty", (_event, dirty) => {
    isDirty = Boolean(dirty);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setDocumentEdited(isDirty);
    }

    return isDirty;
  });

  ipcMain.handle("app:close-after-save", () => {
    allowClose = true;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }

    return true;
  });
}

function registerIpcHandlers() {
  registerSettingsHandlers();
  registerJournalHandlers();
  registerAppHandlers();
}

app.on("second-instance", () => {
  focusMainWindow();
});

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

app.on("before-quit", () => {
  allowClose = true;
  closeWatcher();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
