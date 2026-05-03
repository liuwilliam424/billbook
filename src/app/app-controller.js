import { getElements } from "./dom.js";
import { renderApp, renderChrome, renderEditor, renderSaveStatus, isDirty } from "./render.js";
import { createInitialState } from "./state.js";
import {
  cloneEntry,
  createBlankDraft,
  getSelectedWeekKey,
  shortenPath,
  snapshotEntry
} from "./utils.js";
import { getEditorView } from "./view-state.js";

export class BillbookApp {
  constructor(api) {
    this.api = api;
    this.state = createInitialState();
    this.elements = getElements();
  }

  showToast(message) {
    clearTimeout(this.state.folderToastTimeoutId);
    this.elements.folderToast.textContent = message;
    this.elements.folderToast.classList.remove("is-hidden");
    this.state.folderToastTimeoutId = window.setTimeout(() => {
      this.elements.folderToast.classList.add("is-hidden");
    }, 2600);
  }

  setCurrentEntry(entry, { markSaved = true } = {}) {
    this.state.currentEntry = cloneEntry(entry);
    this.state.selectedFilePath = entry.filePath || "";
    this.state.savedSnapshot = markSaved ? snapshotEntry(entry) : this.state.savedSnapshot;
    this.state.hasExternalChanges = false;
    this.state.externalChangeMessage = "";

    this.elements.dateInput.value = entry.date || "";
    this.elements.titleInput.value = entry.title || "";
    this.elements.contentInput.value = entry.content || "";

    renderEditor(this.state, this.elements);
    this.syncDirtyState();
  }

  updateCurrentEntryFromInputs() {
    if (!this.state.currentEntry) {
      return;
    }

    this.state.currentEntry.date = this.elements.dateInput.value;
    this.state.currentEntry.title = this.elements.titleInput.value;
    this.state.currentEntry.content = this.elements.contentInput.value;
  }

  syncDirtyState() {
    void this.api.app.setDirty(isDirty(this.state));
    renderSaveStatus(this.state, this.elements);
  }

  async showConfirmDialog({ title, body, actions }) {
    this.elements.confirmTitle.textContent = title;
    this.elements.confirmBody.textContent = body;
    this.elements.confirmActions.innerHTML = "";

    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `button ${action.variant === "primary" ? "button-primary" : "button-secondary"}`;
      button.textContent = action.label;
      button.dataset.action = action.id;
      this.elements.confirmActions.append(button);
    }

    return new Promise((resolve) => {
      const handleClick = (event) => {
        const { action } = event.target.dataset;

        if (!action) {
          return;
        }

        cleanup();
        this.elements.confirmDialog.close(action);
        resolve(action);
      };

      const handleCancel = () => {
        cleanup();
        resolve("cancel");
      };

      const cleanup = () => {
        this.elements.confirmActions.removeEventListener("click", handleClick);
        this.elements.confirmDialog.removeEventListener("cancel", handleCancel);
      };

      this.elements.confirmActions.addEventListener("click", handleClick);
      this.elements.confirmDialog.addEventListener("cancel", handleCancel, { once: true });
      this.elements.confirmDialog.showModal();
    });
  }

  async ensureJournalDirectory() {
    if (this.state.journalDirectory && !this.state.journalDirectoryMissing) {
      return true;
    }

    const settings = await this.api.settings.chooseJournalDirectory();
    this.state.journalDirectory = settings.journalDirectory || "";
    this.state.journalDirectoryMissing = Boolean(settings.journalDirectoryMissing);
    renderChrome(this.state, this.elements);

    if (!this.state.journalDirectory) {
      return false;
    }

    await this.loadEntries();
    return true;
  }

  async loadEntries({ preserveSelection = true } = {}) {
    const hadUnsavedChanges = isDirty(this.state);
    const { journalDirectory, journalDirectoryMissing, entries } = await this.api.journal.listEntries();
    this.state.journalDirectory = journalDirectory;
    this.state.journalDirectoryMissing = Boolean(journalDirectoryMissing);
    this.state.entries = entries;

    if (this.state.journalDirectoryMissing) {
      if (!hadUnsavedChanges) {
        this.state.currentEntry = null;
        this.state.selectedFilePath = "";
        this.state.savedSnapshot = "";
      }

      this.state.hasExternalChanges = false;
      this.state.externalChangeMessage = "";
      renderApp(this.state, this.elements);
      return;
    }

    if (!preserveSelection || !this.state.selectedFilePath) {
      if (!this.state.currentEntry && this.state.entries.length > 0) {
        await this.loadEntry(this.state.entries[0].filePath);
        return;
      }

      if (!this.state.currentEntry && this.state.journalDirectory && this.state.entries.length === 0) {
        this.setCurrentEntry(createBlankDraft());
        renderApp(this.state, this.elements);
        return;
      }

      renderApp(this.state, this.elements);
      return;
    }

    const selectedEntryExists = this.state.entries.some((entry) => entry.filePath === this.state.selectedFilePath);

    if (!selectedEntryExists && !isDirty(this.state)) {
      this.state.currentEntry = null;
      this.state.selectedFilePath = "";
      this.state.savedSnapshot = "";
    }

    renderApp(this.state, this.elements);
  }

  async loadEntry(filePath) {
    const entry = await this.api.journal.readEntry(filePath);
    this.setCurrentEntry(entry);
    renderApp(this.state, this.elements);
  }

  async maybeHandleUnsavedChanges() {
    if (!isDirty(this.state)) {
      return true;
    }

    const action = await this.showConfirmDialog({
      title: "Unsaved changes",
      body: "Save your current entry before continuing?",
      actions: [
        { id: "save", label: "Save Changes", variant: "primary" },
        { id: "discard", label: "Discard Changes", variant: "secondary" },
        { id: "cancel", label: "Cancel", variant: "secondary" }
      ]
    });

    if (action === "save") {
      return this.saveCurrentEntry();
    }

    return action === "discard";
  }

  async saveCurrentEntry() {
    if (!this.state.currentEntry) {
      return true;
    }

    if (!(await this.ensureJournalDirectory())) {
      return false;
    }

    this.updateCurrentEntryFromInputs();

    if (!this.state.currentEntry.date) {
      this.state.currentEntry.date = createBlankDraft().date;
      this.elements.dateInput.value = this.state.currentEntry.date;
    }

    try {
      const { entry } = await this.api.journal.saveEntry(this.state.currentEntry);
      this.state.entries = this.state.entries.filter((item) => item.filePath !== this.state.selectedFilePath);
      this.setCurrentEntry(entry);
      await this.loadEntries();
      renderApp(this.state, this.elements);
      return true;
    } catch (error) {
      await this.showConfirmDialog({
        title: "Save failed",
        body: error.message || "The entry could not be saved.",
        actions: [{ id: "ok", label: "OK", variant: "primary" }]
      });
      return false;
    }
  }

  async handleNewEntry() {
    const canContinue = await this.maybeHandleUnsavedChanges();

    if (!canContinue) {
      return;
    }

    this.setCurrentEntry(createBlankDraft());
    renderApp(this.state, this.elements);
    this.elements.titleInput.focus();
  }

  async handleEntrySelection(filePath) {
    if (filePath === this.state.selectedFilePath) {
      return;
    }

    const canContinue = await this.maybeHandleUnsavedChanges();

    if (!canContinue) {
      return;
    }

    await this.loadEntry(filePath);
  }

  async handleChooseFolder() {
    const canContinue = await this.maybeHandleUnsavedChanges();

    if (!canContinue) {
      return;
    }

    const settings = await this.api.settings.chooseJournalDirectory();
    const previousDirectory = this.state.journalDirectory;
    this.state.journalDirectory = settings.journalDirectory || "";
    this.state.journalDirectoryMissing = Boolean(settings.journalDirectoryMissing);
    this.state.currentEntry = null;
    this.state.selectedFilePath = "";
    this.state.savedSnapshot = "";
    await this.loadEntries({ preserveSelection: false });

    if (this.state.journalDirectory && this.state.journalDirectory !== previousDirectory) {
      this.showToast(`Folder selected: ${shortenPath(this.state.journalDirectory)}`);
    }
  }

  handleEditorInput() {
    this.updateCurrentEntryFromInputs();
    this.syncDirtyState();
    renderEditor(this.state, this.elements);
  }

  async handleExternalChanges() {
    const currentPath = this.state.selectedFilePath;
    const dirty = isDirty(this.state);

    await this.loadEntries();

    if (!currentPath) {
      return;
    }

    const selectedStillExists = this.state.entries.some((entry) => entry.filePath === currentPath);

    if (!selectedStillExists) {
      if (!dirty) {
        this.state.currentEntry = null;
        this.state.selectedFilePath = "";
        this.state.savedSnapshot = "";
        renderApp(this.state, this.elements);
        this.showToast("Note removed from disk");
        return;
      }

      this.state.hasExternalChanges = true;
      this.state.externalChangeMessage = "This note was removed outside Billbook.";
      renderChrome(this.state, this.elements);
      return;
    }

    if (dirty) {
      this.state.hasExternalChanges = true;
      this.state.externalChangeMessage = "This note changed outside Billbook.";
      renderChrome(this.state, this.elements);
      return;
    }

    await this.loadEntry(currentPath);
    this.showToast("Updated from disk");
  }

  async handleReloadFromDisk() {
    if (!this.state.selectedFilePath) {
      return;
    }

    await this.loadEntry(this.state.selectedFilePath);
    this.showToast("Reloaded from disk");
  }

  handleKeepMine() {
    this.state.hasExternalChanges = false;
    this.state.externalChangeMessage = "";
    renderChrome(this.state, this.elements);
  }

  async handleEmptyStateAction() {
    const view = getEditorView(this.state);

    if (view.mode === "no-folder") {
      await this.handleChooseFolder();
      return;
    }

    if (view.mode === "missing-folder") {
      await this.handleChooseFolder();
      return;
    }

    if (view.mode === "no-selection") {
      await this.handleNewEntry();
    }
  }

  handleWeekToggle(weekKey) {
    const selectedWeekKey = getSelectedWeekKey(this.state.currentEntry);

    if (!weekKey || weekKey === selectedWeekKey) {
      return;
    }

    if (this.state.expandedWeeks.has(weekKey)) {
      this.state.expandedWeeks.delete(weekKey);
    } else {
      this.state.expandedWeeks.add(weekKey);
    }

    renderApp(this.state, this.elements);
  }

  bindEvents() {
    this.elements.chooseFolderButton.addEventListener("click", () => this.handleChooseFolder());
    this.elements.emptyStateButton.addEventListener("click", () => this.handleEmptyStateAction());
    this.elements.newEntryButton.addEventListener("click", () => this.handleNewEntry());
    this.elements.saveButton.addEventListener("click", () => this.saveCurrentEntry());
    this.elements.reloadEntryButton.addEventListener("click", () => this.handleReloadFromDisk());
    this.elements.keepMineButton.addEventListener("click", () => this.handleKeepMine());
    this.elements.dateInput.addEventListener("input", () => this.handleEditorInput());
    this.elements.titleInput.addEventListener("input", () => this.handleEditorInput());
    this.elements.contentInput.addEventListener("input", () => this.handleEditorInput());

    this.elements.entriesTree.addEventListener("click", async (event) => {
      const weekButton = event.target.closest(".week-heading");

      if (weekButton) {
        this.handleWeekToggle(weekButton.dataset.weekKey);
        return;
      }

      const entryButton = event.target.closest(".entry-button");

      if (!entryButton) {
        return;
      }

      await this.handleEntrySelection(entryButton.dataset.filePath);
    });

    window.addEventListener("keydown", async (event) => {
      const savePressed = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";

      if (!savePressed) {
        return;
      }

      event.preventDefault();
      await this.saveCurrentEntry();
    });

    this.api.events.onDirectoryChanged(async () => {
      await this.handleExternalChanges();
    });

    this.api.app.onSaveBeforeClose(async () => {
      const saved = await this.saveCurrentEntry();

      if (saved) {
        await this.api.app.closeAfterSave();
      }
    });
  }

  async initialize() {
    this.bindEvents();

    const settings = await this.api.settings.get();
    this.state.journalDirectory = settings.journalDirectory || "";
    this.state.journalDirectoryMissing = Boolean(settings.journalDirectoryMissing);
    await this.loadEntries({ preserveSelection: false });
    renderApp(this.state, this.elements);
  }
}
