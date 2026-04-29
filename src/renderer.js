const api = window.journalApp;

const state = {
  journalDirectory: "",
  entries: [],
  currentEntry: null,
  selectedFilePath: "",
  savedSnapshot: "",
  hasExternalChanges: false,
  externalChangeMessage: "",
  folderToastTimeoutId: null
};

const elements = {
  directoryLabel: document.querySelector("#directory-label"),
  chooseFolderButton: document.querySelector("#choose-folder-button"),
  emptyStateButton: document.querySelector("#empty-state-button"),
  newEntryButton: document.querySelector("#new-entry-button"),
  saveButton: document.querySelector("#save-button"),
  saveStatus: document.querySelector("#save-status"),
  entriesTree: document.querySelector("#entries-tree"),
  editorForm: document.querySelector("#editor-form"),
  emptyState: document.querySelector("#empty-state"),
  editorSubtitle: document.querySelector("#editor-subtitle"),
  conflictBar: document.querySelector("#conflict-bar"),
  conflictMessage: document.querySelector("#conflict-message"),
  reloadEntryButton: document.querySelector("#reload-entry-button"),
  keepMineButton: document.querySelector("#keep-mine-button"),
  emptyStateTitle: document.querySelector("#empty-state-title"),
  emptyStateBody: document.querySelector("#empty-state-body"),
  dateInput: document.querySelector("#entry-date"),
  titleInput: document.querySelector("#entry-title"),
  contentInput: document.querySelector("#entry-content"),
  confirmDialog: document.querySelector("#confirm-dialog"),
  confirmTitle: document.querySelector("#confirm-title"),
  confirmBody: document.querySelector("#confirm-body"),
  confirmActions: document.querySelector("#confirm-actions"),
  folderToast: document.querySelector("#folder-toast")
};

function shortenPath(filePath) {
  if (!filePath) {
    return "No folder selected";
  }

  if (filePath.length <= 68) {
    return filePath;
  }

  const parts = filePath.split("/");

  if (parts.length <= 4) {
    return filePath;
  }

  return `${parts.slice(0, 3).join("/")}/.../${parts.slice(-2).join("/")}`;
}

function getBasename(filePath) {
  if (!filePath) {
    return "";
  }

  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}

function showFolderToast(message) {
  clearTimeout(state.folderToastTimeoutId);
  elements.folderToast.textContent = message;
  elements.folderToast.classList.remove("is-hidden");
  state.folderToastTimeoutId = window.setTimeout(() => {
    elements.folderToast.classList.add("is-hidden");
  }, 2600);
}

function showToast(message) {
  showFolderToast(message);
}

function createBlankDraft() {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");

  const timestamp = new Date().toISOString();

  return {
    filePath: "",
    slug: "",
    title: "",
    date,
    content: "",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function cloneEntry(entry) {
  return JSON.parse(JSON.stringify(entry));
}

function snapshotEntry(entry) {
  if (!entry) {
    return "";
  }

  return JSON.stringify({
    filePath: entry.filePath || "",
    slug: entry.slug || "",
    title: entry.title || "",
    date: entry.date || "",
    content: entry.content || ""
  });
}

function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function getWeekStart(dateString) {
  const date = parseLocalDate(dateString);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return date;
}

function formatDateLong(dateString) {
  return parseLocalDate(dateString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatWeekStartLabel(dateString) {
  return getWeekStart(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function getMonthLabel(dateString) {
  return getWeekStart(dateString).toLocaleDateString("en-US", {
    month: "long"
  });
}

function getYearLabel(dateString) {
  return String(getWeekStart(dateString).getFullYear());
}

function getMonthKey(dateString) {
  const weekStart = getWeekStart(dateString);
  return `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}`;
}

function getWeekKey(dateString) {
  const weekStart = getWeekStart(dateString);
  return [
    weekStart.getFullYear(),
    String(weekStart.getMonth() + 1).padStart(2, "0"),
    String(weekStart.getDate()).padStart(2, "0")
  ].join("-");
}

function isDirty() {
  return snapshotEntry(state.currentEntry) !== state.savedSnapshot;
}

function renderSaveStatus() {
  const dirty = isDirty();
  const conflict = state.hasExternalChanges;

  elements.saveStatus.textContent = conflict ? "Conflict" : dirty ? "Unsaved" : "Saved";
  elements.saveStatus.classList.toggle("is-dirty", dirty && !conflict);
  elements.saveStatus.classList.toggle("is-conflict", conflict);
  elements.saveButton.disabled = !state.currentEntry || !dirty;
}

function syncDirtyState() {
  const dirty = isDirty();
  void api.app.setDirty(dirty);
  renderSaveStatus();
}

function setCurrentEntry(entry, { markSaved = true } = {}) {
  state.currentEntry = cloneEntry(entry);
  state.selectedFilePath = entry.filePath || "";
  state.savedSnapshot = markSaved ? snapshotEntry(entry) : state.savedSnapshot;
  state.hasExternalChanges = false;
  state.externalChangeMessage = "";

  elements.dateInput.value = entry.date || "";
  elements.titleInput.value = entry.title || "";
  elements.contentInput.value = entry.content || "";

  renderEditor();
  syncDirtyState();
}

function updateCurrentEntryFromInputs() {
  if (!state.currentEntry) {
    return;
  }

  state.currentEntry.date = elements.dateInput.value;
  state.currentEntry.title = elements.titleInput.value;
  state.currentEntry.content = elements.contentInput.value;
}

function groupEntries(entries) {
  const years = new Map();

  for (const entry of entries) {
    const yearKey = getYearLabel(entry.date);
    const monthKey = getMonthKey(entry.date);
    const monthLabel = getMonthLabel(entry.date);
    const weekKey = getWeekKey(entry.date);
    const weekLabel = `Week of ${formatWeekStartLabel(entry.date)}`;

    if (!years.has(yearKey)) {
      years.set(yearKey, {
        yearKey,
        months: new Map()
      });
    }

    const yearGroup = years.get(yearKey);

    if (!yearGroup.months.has(monthKey)) {
      yearGroup.months.set(monthKey, {
        monthKey,
        monthLabel,
        weeks: new Map()
      });
    }

    const monthGroup = yearGroup.months.get(monthKey);

    if (!monthGroup.weeks.has(weekKey)) {
      monthGroup.weeks.set(weekKey, {
        weekKey,
        weekLabel,
        items: []
      });
    }

    monthGroup.weeks.get(weekKey).items.push(entry);
  }

  return Array.from(years.values()).map((yearGroup) => ({
    yearKey: yearGroup.yearKey,
    months: Array.from(yearGroup.months.values())
      .sort((left, right) => right.monthKey.localeCompare(left.monthKey))
      .map((monthGroup) => ({
        monthKey: monthGroup.monthKey,
        monthLabel: monthGroup.monthLabel,
        weeks: Array.from(monthGroup.weeks.values())
          .sort((left, right) => right.weekKey.localeCompare(left.weekKey))
          .map((weekGroup) => ({
            weekKey: weekGroup.weekKey,
            weekLabel: weekGroup.weekLabel,
            items: weekGroup.items.sort((left, right) => {
              if (left.date !== right.date) {
                return right.date.localeCompare(left.date);
              }

              return right.updatedAt.localeCompare(left.updatedAt);
            })
          }))
      }))
  }))
    .sort((left, right) => right.yearKey.localeCompare(left.yearKey));
}

function renderEntriesTree() {
  elements.entriesTree.innerHTML = "";

  if (!state.journalDirectory) {
    const message = document.createElement("p");
    message.className = "sidebar-empty";
    message.textContent = "No entries loaded.";
    elements.entriesTree.append(message);
    return;
  }

  if (state.entries.length === 0) {
    const message = document.createElement("p");
    message.className = "sidebar-empty";
    message.textContent = "No saved entries yet.";
    elements.entriesTree.append(message);
    return;
  }

  const groupedEntries = groupEntries(state.entries);

  for (const yearGroup of groupedEntries) {
    const yearBlock = document.createElement("section");
    yearBlock.className = "group-block";

    const yearHeading = document.createElement("h2");
    yearHeading.className = "group-heading";
    yearHeading.textContent = yearGroup.yearKey;
    yearBlock.append(yearHeading);

    for (const monthGroup of yearGroup.months) {
      const monthBlock = document.createElement("section");

      const monthHeading = document.createElement("h3");
      monthHeading.className = "month-heading";
      monthHeading.textContent = monthGroup.monthLabel;
      monthBlock.append(monthHeading);

      for (const weekGroup of monthGroup.weeks) {
        const weekHeading = document.createElement("h4");
        weekHeading.className = "week-heading";
        weekHeading.textContent = weekGroup.weekLabel;
        monthBlock.append(weekHeading);

        const list = document.createElement("div");
        list.className = "entry-list";

        for (const entry of weekGroup.items) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "entry-button";
          button.dataset.filePath = entry.filePath;

          if (entry.filePath === state.selectedFilePath) {
            button.classList.add("is-selected");
          }

          const title = document.createElement("p");
          title.className = "entry-title";
          title.textContent = entry.title.trim() || "Untitled";

          const meta = document.createElement("p");
          meta.className = "entry-meta";
          meta.textContent = formatDateLong(entry.date);

          button.append(title, meta);
          list.append(button);
        }

        monthBlock.append(list);
      }

      yearBlock.append(monthBlock);
    }

    elements.entriesTree.append(yearBlock);
  }
}

function renderEditor() {
  const hasSelection = Boolean(state.currentEntry);
  elements.editorForm.classList.toggle("is-hidden", !hasSelection);
  elements.emptyState.classList.add("is-hidden");
  elements.newEntryButton.disabled = false;

  if (!hasSelection) {
    elements.editorSubtitle.textContent = state.journalDirectory
      ? "No entry selected"
      : "No folder selected";
    elements.saveButton.disabled = true;
    return;
  }

  elements.editorSubtitle.textContent = state.currentEntry.filePath
    ? getBasename(state.currentEntry.filePath)
    : "New unsaved entry";
}

function renderChrome() {
  elements.directoryLabel.textContent = shortenPath(state.journalDirectory);
  elements.conflictBar.classList.toggle("is-hidden", !state.hasExternalChanges);
  elements.conflictMessage.textContent = state.externalChangeMessage || "This note changed outside Billbook.";
  renderSaveStatus();
}

function render() {
  renderChrome();
  renderEntriesTree();
  renderEditor();
}

async function showConfirmDialog({ title, body, actions }) {
  elements.confirmTitle.textContent = title;
  elements.confirmBody.textContent = body;
  elements.confirmActions.innerHTML = "";

  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `button ${action.variant === "primary" ? "button-primary" : "button-secondary"}`;
    button.textContent = action.label;
    button.dataset.action = action.id;
    elements.confirmActions.append(button);
  }

  return new Promise((resolve) => {
    const handleClick = (event) => {
      const { action } = event.target.dataset;

      if (!action) {
        return;
      }

      cleanup();
      elements.confirmDialog.close(action);
      resolve(action);
    };

    const handleCancel = () => {
      cleanup();
      resolve("cancel");
    };

    const cleanup = () => {
      elements.confirmActions.removeEventListener("click", handleClick);
      elements.confirmDialog.removeEventListener("cancel", handleCancel);
    };

    elements.confirmActions.addEventListener("click", handleClick);
    elements.confirmDialog.addEventListener("cancel", handleCancel, { once: true });
    elements.confirmDialog.showModal();
  });
}

async function ensureJournalDirectory() {
  if (state.journalDirectory) {
    return true;
  }

  const settings = await api.settings.chooseJournalDirectory();
  state.journalDirectory = settings.journalDirectory || "";
  renderChrome();

  if (!state.journalDirectory) {
    return false;
  }

  await loadEntries();
  return true;
}

async function loadEntries({ preserveSelection = true } = {}) {
  const { journalDirectory, entries } = await api.journal.listEntries();
  state.journalDirectory = journalDirectory;
  state.entries = entries;

  if (!preserveSelection || !state.selectedFilePath) {
    if (!state.currentEntry && state.entries.length > 0) {
      await loadEntry(state.entries[0].filePath);
      return;
    }

    if (!state.currentEntry && state.journalDirectory && state.entries.length === 0) {
      setCurrentEntry(createBlankDraft());
      render();
      return;
    }

    render();
    return;
  }

  const selectedEntryExists = state.entries.some((entry) => entry.filePath === state.selectedFilePath);

  if (!selectedEntryExists && !isDirty()) {
    state.currentEntry = null;
    state.selectedFilePath = "";
    state.savedSnapshot = "";
  }

  render();
}

async function loadEntry(filePath) {
  const entry = await api.journal.readEntry(filePath);
  setCurrentEntry(entry);
  render();
}

async function maybeHandleUnsavedChanges() {
  if (!isDirty()) {
    return true;
  }

  const action = await showConfirmDialog({
    title: "Unsaved changes",
    body: "Save your current entry before continuing?",
    actions: [
      { id: "save", label: "Save Changes", variant: "primary" },
      { id: "discard", label: "Discard Changes", variant: "secondary" },
      { id: "cancel", label: "Cancel", variant: "secondary" }
    ]
  });

  if (action === "save") {
    return saveCurrentEntry();
  }

  return action === "discard";
}

async function saveCurrentEntry() {
  if (!state.currentEntry) {
    return true;
  }

  if (!(await ensureJournalDirectory())) {
    return false;
  }

  updateCurrentEntryFromInputs();

  if (!state.currentEntry.date) {
    state.currentEntry.date = createBlankDraft().date;
    elements.dateInput.value = state.currentEntry.date;
  }

  try {
    const { entry } = await api.journal.saveEntry(state.currentEntry);
    state.entries = state.entries.filter((item) => item.filePath !== state.selectedFilePath);
    setCurrentEntry(entry);
    await loadEntries();
    render();
    return true;
  } catch (error) {
    await showConfirmDialog({
      title: "Save failed",
      body: error.message || "The entry could not be saved.",
      actions: [{ id: "ok", label: "OK", variant: "primary" }]
    });
    return false;
  }
}

async function handleNewEntry() {
  const canContinue = await maybeHandleUnsavedChanges();

  if (!canContinue) {
    return;
  }

  setCurrentEntry(createBlankDraft());
  render();
  elements.titleInput.focus();
}

async function handleEntrySelection(filePath) {
  if (filePath === state.selectedFilePath) {
    return;
  }

  const canContinue = await maybeHandleUnsavedChanges();

  if (!canContinue) {
    return;
  }

  await loadEntry(filePath);
}

async function handleChooseFolder() {
  const canContinue = await maybeHandleUnsavedChanges();

  if (!canContinue) {
    return;
  }

  const settings = await api.settings.chooseJournalDirectory();
  const previousDirectory = state.journalDirectory;
  state.journalDirectory = settings.journalDirectory || "";
  state.currentEntry = null;
  state.selectedFilePath = "";
  state.savedSnapshot = "";
  await loadEntries({ preserveSelection: false });

  if (state.journalDirectory && state.journalDirectory !== previousDirectory) {
    showFolderToast(`Folder selected: ${shortenPath(state.journalDirectory)}`);
  }
}

function handleEditorInput() {
  updateCurrentEntryFromInputs();
  syncDirtyState();
  renderEditor();
}

async function handleExternalChanges() {
  const currentPath = state.selectedFilePath;
  const dirty = isDirty();

  await loadEntries();

  if (!currentPath) {
    return;
  }

  const selectedStillExists = state.entries.some((entry) => entry.filePath === currentPath);

  if (!selectedStillExists) {
    if (!dirty) {
      state.currentEntry = null;
      state.selectedFilePath = "";
      state.savedSnapshot = "";
      render();
      showToast("Note removed from disk");
      return;
    }

    state.hasExternalChanges = true;
    state.externalChangeMessage = "This note was removed outside Billbook.";
    renderChrome();
    return;
  }

  if (dirty) {
    state.hasExternalChanges = true;
    state.externalChangeMessage = "This note changed outside Billbook.";
    renderChrome();
    return;
  }

  await loadEntry(currentPath);
  showToast("Updated from disk");
}

async function handleReloadFromDisk() {
  if (!state.selectedFilePath) {
    return;
  }

  await loadEntry(state.selectedFilePath);
  showToast("Reloaded from disk");
}

function handleKeepMine() {
  state.hasExternalChanges = false;
  state.externalChangeMessage = "";
  renderChrome();
}

function bindEvents() {
  elements.chooseFolderButton.addEventListener("click", handleChooseFolder);
  elements.emptyStateButton.addEventListener("click", handleChooseFolder);
  elements.newEntryButton.addEventListener("click", handleNewEntry);
  elements.saveButton.addEventListener("click", saveCurrentEntry);
  elements.reloadEntryButton.addEventListener("click", handleReloadFromDisk);
  elements.keepMineButton.addEventListener("click", handleKeepMine);
  elements.dateInput.addEventListener("input", handleEditorInput);
  elements.titleInput.addEventListener("input", handleEditorInput);
  elements.contentInput.addEventListener("input", handleEditorInput);

  elements.entriesTree.addEventListener("click", async (event) => {
    const button = event.target.closest(".entry-button");

    if (!button) {
      return;
    }

    await handleEntrySelection(button.dataset.filePath);
  });

  window.addEventListener("keydown", async (event) => {
    const savePressed = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";

    if (!savePressed) {
      return;
    }

    event.preventDefault();
    await saveCurrentEntry();
  });

  api.events.onDirectoryChanged(async () => {
    await handleExternalChanges();
  });

  api.app.onSaveBeforeClose(async () => {
    const saved = await saveCurrentEntry();

    if (saved) {
      await api.app.closeAfterSave();
    }
  });
}

async function initialize() {
  bindEvents();

  const settings = await api.settings.get();
  state.journalDirectory = settings.journalDirectory || "";
  await loadEntries({ preserveSelection: false });
  render();
}

initialize();
