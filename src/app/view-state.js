export function getEditorView(state) {
  if (!state.journalDirectory) {
    return {
      mode: "no-folder",
      subtitle: "No folder selected",
      title: "No journal folder selected.",
      body: "Choose a folder to start."
    };
  }

  if (state.journalDirectoryMissing) {
    return {
      mode: "missing-folder",
      subtitle: "Journal folder missing",
      title: "Journal folder not found.",
      body: "The saved journal location is no longer available. Locate it again or choose a new folder."
    };
  }

  if (!state.currentEntry) {
    return {
      mode: "no-selection",
      subtitle: "No entry selected",
      title: "No entry selected.",
      body: "Choose an entry or create a new one."
    };
  }

  return {
    mode: "editor",
    subtitle: state.currentEntry.filePath ? "saved-entry" : "draft-entry",
    title: "",
    body: ""
  };
}
