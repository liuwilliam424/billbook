// This module is the renderer's only direct dependency on the Electron preload API.
// Everything above this layer can talk in app concepts like "save entry" instead of
// knowing the nested `window.journalApp` shape.
export function createJournalGateway(api) {
  return {
    loadSettings: () => api.settings.get(),
    saveIntegrationPreferences: (preferences) => api.settings.saveIntegrationPreferences(preferences),
    chooseJournalDirectory: () => api.settings.chooseJournalDirectory(),
    openJournalDirectory: () => api.settings.openJournalDirectory(),
    listEntries: () => api.journal.listEntries(),
    readEntry: (filePath) => api.journal.readEntry(filePath),
    revealEntry: (filePath) => api.journal.revealEntry(filePath),
    createBackup: () => api.journal.createBackup(),
    saveEntry: (entry) => api.journal.saveEntry(entry),
    getFinanceStatus: () => api.finance.getStatus(),
    autoConnectSimplefin: () => api.finance.autoConnect(),
    connectSimplefinFromFile: () => api.finance.connectFromFile(),
    listFinanceAccounts: () => api.finance.listAccounts(),
    saveFinanceConfig: (financeConfig) => api.finance.saveConfig(financeConfig),
    buildFinanceSection: (dateString) => api.finance.buildEntrySection(dateString),
    getOuraStatus: () => api.oura.getStatus(),
    autoConnectOura: () => api.oura.autoConnect(),
    saveOuraClientCredentials: (credentials) => api.oura.saveClientCredentials(credentials),
    connectOura: () => api.oura.connect(),
    buildSleepSection: (dateString) => api.oura.buildEntrySection(dateString),
    getIntegrationStatuses: (options) => api.app.getIntegrationStatuses(options),
    setDirty: (dirty) => api.app.setDirty(dirty),
    closeAfterSave: () => api.app.closeAfterSave(),
    onSaveBeforeClose: (callback) => api.app.onSaveBeforeClose(callback),
    onDirectoryChanged: (callback) => api.events.onDirectoryChanged(callback)
  };
}
