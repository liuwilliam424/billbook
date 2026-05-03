export function getElements() {
  return {
    directoryLink: document.querySelector("#directory-link"),
    directoryName: document.querySelector("#directory-name"),
    directoryPath: document.querySelector("#directory-path"),
    chooseFolderButton: document.querySelector("#choose-folder-button"),
    emptyStateButton: document.querySelector("#empty-state-button"),
    newEntryButton: document.querySelector("#new-entry-button"),
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
}
