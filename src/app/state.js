export function createInitialState() {
  return {
    journalDirectory: "",
    journalDirectoryMissing: false,
    entries: [],
    currentEntry: null,
    selectedFilePath: "",
    savedSnapshot: "",
    hasExternalChanges: false,
    externalChangeMessage: "",
    collapsedYears: new Set(),
    collapsedMonths: new Set(),
    expandedWeeks: new Set(),
    isSidebarMenuOpen: false,
    folderToastTimeoutId: null,
    financeConnected: false,
    financeConfigured: false,
    financeRequiresReconnect: false,
    financeStatusError: "",
    ouraConnected: false,
    ouraHasClientCredentials: false,
    ouraStatusError: "",
    autoConnectIntegrationsOnStartup: true
  };
}
