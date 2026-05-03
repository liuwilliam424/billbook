import { groupEntries } from "./entry-tree.js";
import { formatDateLong, getSelectedWeekKey } from "./utils.js";

export function renderEntriesTree(state, elements) {
  elements.entriesTree.innerHTML = "";

  if (!state.journalDirectory) {
    const message = document.createElement("p");
    message.className = "sidebar-empty";
    message.textContent = "No entries loaded.";
    elements.entriesTree.append(message);
    return;
  }

  if (state.journalDirectoryMissing) {
    const message = document.createElement("p");
    message.className = "sidebar-empty";
    message.textContent = "Saved folder is missing.";
    elements.entriesTree.append(message);
    return;
  }

  if (state.entries.length === 0) {
    const message = document.createElement("p");
    message.className = "sidebar-empty";
    message.textContent = "No saved entries yet.";
    elements.entriesTree.append(message);
    return;
  }

  const groupedEntries = groupEntries(state.entries);
  const selectedWeekKey = getSelectedWeekKey(state.currentEntry);

  for (const yearGroup of groupedEntries) {
    const yearBlock = document.createElement("section");
    yearBlock.className = "group-block";

    const yearHeading = document.createElement("h2");
    yearHeading.className = "group-heading";
    yearHeading.textContent = yearGroup.yearKey;
    yearBlock.append(yearHeading);

    for (const monthGroup of yearGroup.months) {
      const monthBlock = document.createElement("section");
      monthBlock.className = "month-block";

      const monthHeading = document.createElement("h3");
      monthHeading.className = "month-heading";
      monthHeading.textContent = monthGroup.monthLabel;
      monthBlock.append(monthHeading);

      for (const weekGroup of monthGroup.weeks) {
        const weekBlock = document.createElement("section");
        weekBlock.className = "week-block";

        const weekHeading = document.createElement("button");
        weekHeading.type = "button";
        weekHeading.className = "week-heading";
        weekHeading.dataset.weekKey = weekGroup.weekKey;

        const weekLabel = document.createElement("span");
        weekLabel.className = "week-heading-label";
        weekLabel.textContent = weekGroup.weekLabel;

        const weekMeta = document.createElement("span");
        weekMeta.className = "week-heading-meta";
        weekMeta.textContent = `${weekGroup.items.length}`;

        weekHeading.append(weekLabel, weekMeta);
        weekBlock.append(weekHeading);

        const list = document.createElement("div");
        list.className = "entry-list";
        const isExpanded = state.expandedWeeks.has(weekGroup.weekKey) || weekGroup.weekKey === selectedWeekKey;

        if (!isExpanded) {
          list.classList.add("is-hidden");
          weekHeading.classList.add("is-collapsed");
        }

        for (const entry of weekGroup.items) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "entry-button";
          button.dataset.filePath = entry.filePath;

          if (entry.filePath === state.selectedFilePath) {
            button.classList.add("is-selected");
          }

          const title = document.createElement("p");
          title.className = "entry-title";
          title.textContent = entry.title.trim() || "Untitled";

          const meta = document.createElement("p");
          meta.className = "entry-meta";
          meta.textContent = formatDateLong(entry.date);

          button.append(title, meta);
          list.append(button);
        }

        weekBlock.append(list);
        monthBlock.append(weekBlock);
      }

      yearBlock.append(monthBlock);
    }

    elements.entriesTree.append(yearBlock);
  }
}
