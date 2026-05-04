const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("journalApp", {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    chooseJournalDirectory: () => ipcRenderer.invoke("settings:choose-journal-directory"),
    openJournalDirectory: () => ipcRenderer.invoke("settings:open-journal-directory")
  },
  journal: {
    listEntries: () => ipcRenderer.invoke("journal:list-entries"),
    readEntry: (filePath) => ipcRenderer.invoke("journal:read-entry", filePath),
    revealEntry: (filePath) => ipcRenderer.invoke("journal:reveal-entry", filePath),
    createBackup: () => ipcRenderer.invoke("journal:create-backup"),
    saveEntry: (entry) => ipcRenderer.invoke("journal:save-entry", entry)
  },
  finance: {
    getStatus: () => ipcRenderer.invoke("finance:get-status"),
    connectFromFile: () => ipcRenderer.invoke("finance:connect-from-file"),
    listAccounts: () => ipcRenderer.invoke("finance:list-accounts"),
    saveConfig: (financeConfig) => ipcRenderer.invoke("finance:save-config", financeConfig),
    buildEntrySection: (dateString) => ipcRenderer.invoke("finance:build-entry-section", dateString)
  },
  oura: {
    getStatus: () => ipcRenderer.invoke("oura:get-status"),
    saveClientCredentials: (credentials) => ipcRenderer.invoke("oura:save-client-credentials", credentials),
    connect: () => ipcRenderer.invoke("oura:connect"),
    buildEntrySection: (dateString) => ipcRenderer.invoke("oura:build-entry-section", dateString)
  },
  app: {
    setDirty: (dirty) => ipcRenderer.invoke("app:set-dirty", dirty),
    closeAfterSave: () => ipcRenderer.invoke("app:close-after-save"),
    onSaveBeforeClose: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("app:save-before-close", listener);
      return () => ipcRenderer.removeListener("app:save-before-close", listener);
    }
  },
  events: {
    onDirectoryChanged: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("journal:directory-changed", listener);
      return () => ipcRenderer.removeListener("journal:directory-changed", listener);
    }
  }
});
