const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const SETTINGS_FILE = "settings.json";
const APP_TITLE = "Billbook";

let mainWindow = null;
let allowClose = false;
let isDirty = false;
let watcher = null;
let settingsCache = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

async function loadSettings() {
  if (settingsCache) {
    return settingsCache;
  }

  try {
    const raw = await fsp.readFile(getSettingsPath(), "utf8");
    settingsCache = JSON.parse(raw);
  } catch {
    settingsCache = { journalDirectory: "" };
    await saveSettings(settingsCache);
  }

  return settingsCache;
}

async function saveSettings(settings) {
  settingsCache = settings;
  await fsp.mkdir(app.getPath("userData"), { recursive: true });
  await fsp.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), "utf8");
  return settingsCache;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid journal date: ${dateString}`);
  }

  return date;
}

function getWeekStart(dateString) {
  const date = parseLocalDate(dateString);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return date;
}

function parseFrontmatter(rawContent) {
  const normalized = rawContent.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (lines[0] !== "---") {
    return {
      frontmatter: {},
      content: normalized
    };
  }

  const frontmatter = {};
  let index = 1;

  while (index < lines.length) {
    const line = lines[index];

    if (line === "---") {
      index += 1;
      break;
    }

    const separator = line.indexOf(":");

    if (separator !== -1) {
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();

      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        try {
          value = JSON.parse(value);
        } catch {
          value = value.slice(1, -1);
        }
      }

      frontmatter[key] = value;
    }

    index += 1;
  }

  return {
    frontmatter,
    content: lines.slice(index).join("\n")
  };
}

function stringifyFrontmatterValue(value) {
  return JSON.stringify(String(value));
}

function serializeEntry(entry) {
  const frontmatterLines = [
    "---",
    `title: ${stringifyFrontmatterValue(entry.title || "")}`,
    `date: ${stringifyFrontmatterValue(entry.date)}`,
    `createdAt: ${stringifyFrontmatterValue(entry.createdAt)}`,
    `updatedAt: ${stringifyFrontmatterValue(entry.updatedAt)}`,
    "---",
    ""
  ];

  const content = entry.content || "";
  return `${frontmatterLines.join("\n")}${content.endsWith("\n") ? content : `${content}\n`}`;
}

function sanitizeEntry(entryLike) {
  const now = new Date().toISOString();

  return {
    title: typeof entryLike.title === "string" ? entryLike.title : "",
    date: typeof entryLike.date === "string" && entryLike.date ? entryLike.date : formatDate(new Date()),
    content: typeof entryLike.content === "string" ? entryLike.content : "",
    slug: typeof entryLike.slug === "string" && entryLike.slug ? entryLike.slug : "",
    createdAt: typeof entryLike.createdAt === "string" && entryLike.createdAt ? entryLike.createdAt : now,
    updatedAt: typeof entryLike.updatedAt === "string" && entryLike.updatedAt ? entryLike.updatedAt : now
  };
}

function buildEntryPath(rootDirectory, entry) {
  const weekStart = getWeekStart(entry.date);
  const yearFolder = String(weekStart.getFullYear());
  const monthIndex = String(weekStart.getMonth() + 1).padStart(2, "0");
  const monthName = weekStart.toLocaleString("en-US", { month: "long" });
  const monthFolder = `${monthIndex}-${monthName}`;
  const weekFolder = `week-of-${formatDate(weekStart)}`;
  const fileName = `${entry.date}-${entry.slug}.md`;

  return path.join(rootDirectory, yearFolder, monthFolder, weekFolder, fileName);
}

function createSlug() {
  return crypto.randomBytes(4).toString("hex");
}

async function ensureUniqueSlug(rootDirectory, dateString, requestedSlug = "") {
  let slug = requestedSlug || createSlug();

  while (true) {
    const targetPath = buildEntryPath(rootDirectory, { date: dateString, slug });

    try {
      await fsp.access(targetPath, fs.constants.F_OK);
      slug = createSlug();
    } catch {
      return slug;
    }
  }
}

async function ensureAvailableSlug(rootDirectory, dateString, sourcePath, requestedSlug = "") {
  let slug = requestedSlug || createSlug();

  while (true) {
    const candidatePath = buildEntryPath(rootDirectory, { date: dateString, slug });

    try {
      await fsp.access(candidatePath, fs.constants.F_OK);

      if (sourcePath && path.resolve(candidatePath) === path.resolve(sourcePath)) {
        return slug;
      }

      slug = createSlug();
    } catch {
      return slug;
    }
  }
}

function ensureInsideRoot(rootDirectory, candidatePath) {
  const root = path.resolve(rootDirectory);
  const candidate = path.resolve(candidatePath);

  if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
    return candidate;
  }

  throw new Error("Attempted to access a file outside the selected journal directory.");
}

async function walkMarkdownFiles(directory) {
  let entries = [];

  const children = await fsp.readdir(directory, { withFileTypes: true });

  for (const child of children) {
    if (child.name.startsWith(".")) {
      continue;
    }

    const absolutePath = path.join(directory, child.name);

    if (child.isDirectory()) {
      entries = entries.concat(await walkMarkdownFiles(absolutePath));
      continue;
    }

    if (child.isFile() && absolutePath.endsWith(".md")) {
      entries.push(absolutePath);
    }
  }

  return entries;
}

function getSlugFromFilename(filePath) {
  const name = path.basename(filePath, ".md");
  const match = name.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
  return match ? match[1] : "";
}

function summarizeContent(content) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "";
}

async function readEntryFile(filePath) {
  const raw = await fsp.readFile(filePath, "utf8");
  const { frontmatter, content } = parseFrontmatter(raw);
  const stats = await fsp.stat(filePath);
  const fallbackDate = path.basename(filePath).slice(0, 10);

  return {
    filePath,
    slug: getSlugFromFilename(filePath),
    title: frontmatter.title || "",
    date: frontmatter.date || fallbackDate || formatDate(stats.mtime),
    createdAt: frontmatter.createdAt || stats.birthtime.toISOString(),
    updatedAt: frontmatter.updatedAt || stats.mtime.toISOString(),
    content,
    preview: summarizeContent(content)
  };
}

async function listEntries(rootDirectory) {
  const markdownFiles = await walkMarkdownFiles(rootDirectory);
  const entries = await Promise.all(markdownFiles.map((filePath) => readEntryFile(filePath)));

  return entries
    .sort((left, right) => {
      if (left.date !== right.date) {
        return right.date.localeCompare(left.date);
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .map((entry) => ({
      filePath: entry.filePath,
      slug: entry.slug,
      title: entry.title,
      date: entry.date,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      preview: entry.preview
    }));
}

async function pruneEmptyDirectories(startDirectory, stopDirectory) {
  let currentDirectory = path.resolve(startDirectory);
  const stop = path.resolve(stopDirectory);

  while (currentDirectory.startsWith(stop) && currentDirectory !== stop) {
    const children = await fsp.readdir(currentDirectory);

    if (children.length > 0) {
      return;
    }

    await fsp.rmdir(currentDirectory);
    currentDirectory = path.dirname(currentDirectory);
  }
}

async function saveEntry(rootDirectory, incomingEntry) {
  const entry = sanitizeEntry(incomingEntry);
  const sourcePath = incomingEntry.filePath ? ensureInsideRoot(rootDirectory, incomingEntry.filePath) : "";
  const slug = sourcePath
    ? await ensureAvailableSlug(rootDirectory, entry.date, sourcePath, entry.slug || getSlugFromFilename(sourcePath))
    : await ensureUniqueSlug(rootDirectory, entry.date, entry.slug);
  const now = new Date().toISOString();

  entry.slug = slug;
  entry.updatedAt = now;
  entry.createdAt = sourcePath ? entry.createdAt : now;

  const targetPath = ensureInsideRoot(rootDirectory, buildEntryPath(rootDirectory, entry));
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });

  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.tmp`
  );

  await fsp.writeFile(tempPath, serializeEntry(entry), "utf8");
  await fsp.rename(tempPath, targetPath);

  if (sourcePath && sourcePath !== targetPath) {
    await fsp.rm(sourcePath, { force: true });
    await pruneEmptyDirectories(path.dirname(sourcePath), rootDirectory);
  }

  return readEntryFile(targetPath);
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

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
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

app.on("second-instance", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  }
});

ipcMain.handle("settings:get", async () => {
  const settings = await loadSettings();

  if (settings.journalDirectory) {
    await fsp.mkdir(settings.journalDirectory, { recursive: true });
    await watchJournalDirectory(settings.journalDirectory);
  }

  return settings;
});

ipcMain.handle("settings:choose-journal-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Journal Directory",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return loadSettings();
  }

  const settings = await loadSettings();
  settings.journalDirectory = result.filePaths[0];
  await fsp.mkdir(settings.journalDirectory, { recursive: true });
  await saveSettings(settings);
  await watchJournalDirectory(settings.journalDirectory);
  return settings;
});

ipcMain.handle("journal:list-entries", async () => {
  const settings = await loadSettings();

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
  const settings = await loadSettings();

  if (!settings.journalDirectory) {
    throw new Error("No journal directory configured.");
  }

  return readEntryFile(ensureInsideRoot(settings.journalDirectory, filePath));
});

ipcMain.handle("journal:save-entry", async (_event, entry) => {
  const settings = await loadSettings();

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

app.whenReady().then(createMainWindow);

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
