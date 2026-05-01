const { app, BrowserWindow, dialog, ipcMain } = require("electron");
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

async function watchJournalDirectory(rootDirectory) {
  closeWatcher();

  if (!rootDirectory) {
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

  if (settings.journalDirectory) {
    await fsp.mkdir(settings.journalDirectory, { recursive: true });
    await watchJournalDirectory(settings.journalDirectory);
  }

  return settings;
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
      return settingsStore.load();
    }

    const settings = await settingsStore.load();
    settings.journalDirectory = result.filePaths[0];
    await fsp.mkdir(settings.journalDirectory, { recursive: true });
    await settingsStore.save(settings);
    await watchJournalDirectory(settings.journalDirectory);
    return settings;
  });
}

function registerJournalHandlers() {
  ipcMain.handle("journal:list-entries", async () => {
    const settings = await settingsStore.load();

    if (!settings.journalDirectory) {
      return {
        journalDirectory: "",
        entries: []
      };
    }

    await fsp.mkdir(settings.journalDirectory, { recursive: true });
    await watchJournalDirectory(settings.journalDirectory);

    return {
      journalDirectory: settings.journalDirectory,
      entries: await listEntries(settings.journalDirectory)
    };
  });

  ipcMain.handle("journal:read-entry", async (_event, filePath) => {
    const settings = await settingsStore.load();

    if (!settings.journalDirectory) {
      throw new Error("No journal directory configured.");
    }

    return readEntryFile(ensureInsideRoot(settings.journalDirectory, filePath));
  });

  ipcMain.handle("journal:save-entry", async (_event, entry) => {
    const settings = await settingsStore.load();

    if (!settings.journalDirectory) {
      throw new Error("Choose a journal directory before saving an entry.");
    }

    await fsp.mkdir(settings.journalDirectory, { recursive: true });
    const savedEntry = await saveEntry(settings.journalDirectory, entry);

    return {
      journalDirectory: settings.journalDirectory,
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
