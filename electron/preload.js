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
