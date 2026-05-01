export function getEditorView(state) {
  if (!state.journalDirectory) {
    return {
      mode: "no-folder",
      subtitle: "No folder selected",
      title: "No journal folder selected.",
      body: "Choose a folder to start."
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
