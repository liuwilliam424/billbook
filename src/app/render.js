import { getBasename, getFolderName, shortenPath, snapshotEntry } from "./utils.js";
import { renderEntriesTree } from "./sidebar.js";
import { getEditorView } from "./view-state.js";

export function isDirty(state) {
  return snapshotEntry(state.currentEntry) !== state.savedSnapshot;
}

export function renderSaveStatus(state, elements) {
  const dirty = isDirty(state);
  const conflict = state.hasExternalChanges;

  elements.saveStatus.textContent = conflict ? "Conflict" : dirty ? "Unsaved" : "";
  elements.saveStatus.title = conflict
    ? "This note changed outside Billbook."
    : dirty
      ? "Press Command-S to save."
      : "";
  elements.saveStatus.classList.toggle("is-hidden", !conflict && !dirty);
  elements.saveStatus.classList.toggle("is-dirty", dirty && !conflict);
  elements.saveStatus.classList.toggle("is-conflict", conflict);
}

function renderSidebarMenu(state, elements) {
  const canCreateBackup = Boolean(state.journalDirectory) && !state.journalDirectoryMissing;
  elements.sidebarMenu.classList.toggle("is-hidden", !state.isSidebarMenuOpen);
  elements.sidebarMenuButton.setAttribute("aria-expanded", state.isSidebarMenuOpen ? "true" : "false");
  elements.connectSimplefinButton.textContent = state.financeConnected
    ? "Reconnect SimpleFIN"
    : "Connect SimpleFIN";
  elements.connectOuraButton.textContent = state.ouraConnected
    ? "Reconnect Oura"
    : state.ouraHasClientCredentials
      ? "Authorize Oura"
      : "Connect Oura";
  elements.configureFinanceButton.disabled = !state.financeConnected;
  elements.toggleAutoConnectButton.textContent = state.autoConnectIntegrationsOnStartup
    ? "Disable Startup Auto-Connect"
    : "Enable Startup Auto-Connect";
  elements.toggleTouchIDButton.textContent = state.touchIDAvailable
    ? state.requireTouchIDOnLaunch
      ? "Disable Touch ID Lock"
      : "Enable Touch ID Lock"
    : "Touch ID Unavailable";
  elements.toggleTouchIDButton.disabled = !state.touchIDAvailable;
  elements.backupJournalButton.disabled = !canCreateBackup;
  renderIntegrationStatus(state, elements);
}

function renderIntegrationStatus(state, elements) {
  const simplefinText = getSimplefinStatusText(state);
  const ouraText = getOuraStatusText(state);

  elements.simplefinStatus.textContent = simplefinText;
  elements.ouraStatus.textContent = ouraText;
  elements.simplefinStatus.classList.toggle("is-error", Boolean(state.financeStatusError));
  elements.ouraStatus.classList.toggle("is-error", Boolean(state.ouraStatusError));
}

function getSimplefinStatusText(state) {
  if (state.financeStatusError) {
    return state.financeStatusError;
  }

  if (state.financeRequiresReconnect) {
    return "Re-login required";
  }

  if (state.financeConnected && state.financeConfigured) {
    return "Connected • accounts set";
  }

  if (state.financeConnected) {
    return "Connected • choose accounts";
  }

  if (state.financeConfigured) {
    return "Configured • reconnect needed";
  }

  return "Not connected";
}

function getOuraStatusText(state) {
  if (state.ouraStatusError) {
    return state.ouraStatusError;
  }

  if (state.ouraConnected) {
    return "Connected";
  }

  if (state.ouraHasClientCredentials) {
    return "Authorization needed";
  }

  return "Not connected";
}

function renderEditorSubtitle(state, elements, view) {
  if (view.mode === "editor") {
    const hasSavedFile = Boolean(state.currentEntry.filePath);
    elements.editorSubtitle.textContent = hasSavedFile
      ? getBasename(state.currentEntry.filePath)
      : "New unsaved entry";
    elements.editorSubtitle.disabled = !hasSavedFile;
    elements.editorSubtitle.title = hasSavedFile ? "Reveal this entry in Finder." : "";
    return;
  }

  elements.editorSubtitle.textContent = view.subtitle;
  elements.editorSubtitle.disabled = true;
  elements.editorSubtitle.title = "";
}

function renderSectionLoadingStates(state, elements, showEditor) {
  for (const [key, input] of Object.entries(elements.sectionInputs)) {
    const loader = elements.sectionLoaders?.[key];
    const refreshButton = elements.sectionRefreshButtons?.[key];

    if (!loader) {
      continue;
    }

    const loading = showEditor && state.loadingSections.has(key);

    if (loading && !input.classList.contains("is-hidden")) {
      const inputHeight = Math.ceil(input.getBoundingClientRect().height);
      loader.style.minHeight = `${Math.max(84, inputHeight)}px`;
    }

    if (!loading) {
      loader.style.minHeight = "";
    }

    input.classList.toggle("is-hidden", loading);
    input.disabled = loading;
    loader.classList.toggle("is-hidden", !loading);

    if (refreshButton) {
      refreshButton.disabled = loading || !showEditor;
      refreshButton.classList.toggle("is-loading", loading);
      refreshButton.textContent = loading ? "Refreshing" : refreshButton.dataset.label;
    }
  }
}

function renderEmptyState(state, elements, view) {
  const showEmptyState = view.mode !== "editor";

  elements.emptyState.classList.toggle("is-hidden", !showEmptyState);
  elements.emptyState.classList.toggle("is-blank", view.mode === "no-selection");

  if (!showEmptyState) {
    return;
  }

  if (view.mode === "no-selection") {
    elements.emptyStateTitle.textContent = "";
    elements.emptyStateBody.textContent = "";
    elements.emptyStateButton.classList.add("is-hidden");
    return;
  }

  elements.emptyStateTitle.textContent = view.title;
  elements.emptyStateBody.textContent = view.body;
  elements.emptyStateButton.textContent = getEmptyStateButtonLabel(view.mode);
  elements.emptyStateButton.classList.remove("is-hidden");
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
  renderSectionLoadingStates(state, elements, showEditor);
}

export function renderChrome(state, elements) {
  elements.directoryName.textContent = state.journalDirectory ? getFolderName(state.journalDirectory) : "No folder selected";
  elements.directoryPath.textContent = state.journalDirectory ? shortenPath(state.journalDirectory) : "";
  elements.directoryPath.classList.toggle("is-hidden", !state.journalDirectory);
  elements.directoryLink.disabled = !state.journalDirectory || state.journalDirectoryMissing;
  elements.conflictBar.classList.toggle("is-hidden", !state.hasExternalChanges);
  elements.conflictMessage.textContent = state.externalChangeMessage || "This note changed outside Billbook.";
  renderSaveStatus(state, elements);
  renderSidebarMenu(state, elements);
}

export function renderApp(state, elements) {
  renderChrome(state, elements);
  renderEntriesTree(state, elements);
  renderEditor(state, elements);
}
