import { DAILY_PROMPTS } from "./prompts.js";

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
    sidebarMenu: document.querySelector("#sidebar-menu"),
    sidebarMenuButton: document.querySelector("#sidebar-menu-button"),
    connectSimplefinButton: document.querySelector("#connect-simplefin-button"),
    connectOuraButton: document.querySelector("#connect-oura-button"),
    configureFinanceButton: document.querySelector("#configure-finance-button"),
    toggleAutoConnectButton: document.querySelector("#toggle-auto-connect-button"),
    toggleTouchIDButton: document.querySelector("#toggle-touch-id-button"),
    backupJournalButton: document.querySelector("#backup-journal-button"),
    simplefinStatus: document.querySelector("#simplefin-status"),
    ouraStatus: document.querySelector("#oura-status"),
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
    dateButton: document.querySelector("#entry-date-button"),
    titleInput: document.querySelector("#entry-title"),
    sectionInputs: Object.fromEntries(
      DAILY_PROMPTS.map(({ key }) => [key, document.querySelector(`#entry-${key}`)])
    ),
    sectionRefreshButtons: Object.fromEntries(
      DAILY_PROMPTS.map(({ key }) => [
        key,
        document.querySelector(`.section-refresh-label[data-section-key="${key}"]`)
      ])
    ),
    sectionLoaders: Object.fromEntries(
      DAILY_PROMPTS.map(({ key }) => [key, document.querySelector(`#entry-${key}-loading`)])
    ),
    confirmDialog: document.querySelector("#confirm-dialog"),
    confirmTitle: document.querySelector("#confirm-title"),
    confirmBody: document.querySelector("#confirm-body"),
    confirmActions: document.querySelector("#confirm-actions"),
    financeDialog: document.querySelector("#finance-dialog"),
    financeAccountList: document.querySelector("#finance-account-list"),
    financeCancelButton: document.querySelector("#finance-cancel-button"),
    financeSaveButton: document.querySelector("#finance-save-button"),
    ouraCredentialsDialog: document.querySelector("#oura-credentials-dialog"),
    ouraClientIdInput: document.querySelector("#oura-client-id"),
    ouraClientSecretInput: document.querySelector("#oura-client-secret"),
    ouraCancelButton: document.querySelector("#oura-cancel-button"),
    ouraSaveButton: document.querySelector("#oura-save-button"),
    folderToast: document.querySelector("#folder-toast")
  };
}
