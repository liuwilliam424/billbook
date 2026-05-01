export function createInitialState() {
  return {
    journalDirectory: "",
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
