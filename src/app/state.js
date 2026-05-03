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
    expandedWeeks: new Set(),
    folderToastTimeoutId: null
  };
}
