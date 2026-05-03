import { getBasename, shortenPath, snapshotEntry } from "./utils.js";
import { renderEntriesTree } from "./sidebar.js";
import { getEditorView } from "./view-state.js";

export function isDirty(state) {
  return snapshotEntry(state.currentEntry) !== state.savedSnapshot;
}

export function renderSaveStatus(state, elements) {
  const dirty = isDirty(state);
  const conflict = state.hasExternalChanges;

  elements.saveStatus.textContent = conflict ? "Conflict" : dirty ? "Unsaved" : "Saved";
  elements.saveStatus.classList.toggle("is-dirty", dirty && !conflict);
  elements.saveStatus.classList.toggle("is-conflict", conflict);
  elements.saveButton.disabled = !state.currentEntry || !dirty;
}

function renderEditorSubtitle(state, elements, view) {
  if (view.mode === "editor") {
    elements.editorSubtitle.textContent = state.currentEntry.filePath
      ? getBasename(state.currentEntry.filePath)
      : "New unsaved entry";
    return;
  }

  elements.editorSubtitle.textContent = view.subtitle;
}

function renderEmptyState(state, elements, view) {
  const showEmptyState = view.mode !== "editor";

  elements.emptyState.classList.toggle("is-hidden", !showEmptyState);

  if (!showEmptyState) {
    return;
  }

  elements.emptyStateTitle.textContent = view.title;
  elements.emptyStateBody.textContent = view.body;
  elements.emptyStateButton.textContent = getEmptyStateButtonLabel(view.mode);
}

function getEmptyStateButtonLabel(mode) {
  if (mode === "no-folder") {
    return "Choose Folder";
  }

  if (mode === "missing-folder") {
    return "Locate Folder";
  }

  return "New Entry";
}

export function renderEditor(state, elements) {
  const view = getEditorView(state);
  const showEditor = view.mode === "editor";

  elements.editorForm.classList.toggle("is-hidden", !showEditor);
  elements.newEntryButton.disabled = false;

  renderEditorSubtitle(state, elements, view);
  renderEmptyState(state, elements, view);

  if (!showEditor) {
    elements.saveButton.disabled = true;
  }
}

export function renderChrome(state, elements) {
  elements.directoryLabel.textContent = shortenPath(state.journalDirectory);
  elements.conflictBar.classList.toggle("is-hidden", !state.hasExternalChanges);
  elements.conflictMessage.textContent = state.externalChangeMessage || "This note changed outside Billbook.";
  renderSaveStatus(state, elements);
}

export function renderApp(state, elements) {
  renderChrome(state, elements);
  renderEntriesTree(state, elements);
  renderEditor(state, elements);
}
