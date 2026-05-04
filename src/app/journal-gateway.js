// This module is the renderer's only direct dependency on the Electron preload API.
// Everything above this layer can talk in app concepts like "save entry" instead of
// knowing the nested `window.journalApp` shape.
export function createJournalGateway(api) {
  return {
    loadSettings: () => api.settings.get(),
    chooseJournalDirectory: () => api.settings.chooseJournalDirectory(),
    openJournalDirectory: () => api.settings.openJournalDirectory(),
    listEntries: () => api.journal.listEntries(),
    readEntry: (filePath) => api.journal.readEntry(filePath),
    revealEntry: (filePath) => api.journal.revealEntry(filePath),
    createBackup: () => api.journal.createBackup(),
    saveEntry: (entry) => api.journal.saveEntry(entry),
    getFinanceStatus: () => api.finance.getStatus(),
    connectSimplefinFromFile: () => api.finance.connectFromFile(),
    listFinanceAccounts: () => api.finance.listAccounts(),
    saveFinanceConfig: (financeConfig) => api.finance.saveConfig(financeConfig),
    buildFinanceSection: (dateString) => api.finance.buildEntrySection(dateString),
    setDirty: (dirty) => api.app.setDirty(dirty),
    closeAfterSave: () => api.app.closeAfterSave(),
    onSaveBeforeClose: (callback) => api.app.onSaveBeforeClose(callback),
    onDirectoryChanged: (callback) => api.events.onDirectoryChanged(callback)
  };
}
