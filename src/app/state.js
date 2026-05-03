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
    folderToastTimeoutId: null
  };
}
