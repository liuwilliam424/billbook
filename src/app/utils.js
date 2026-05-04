import { DAILY_PROMPTS, createEmptySections, normalizeSections } from "./prompts.js";

export function shortenPath(filePath) {
  if (!filePath) {
    return "No folder selected";
  }

  if (filePath.length <= 68) {
    return filePath;
  }

  const parts = filePath.split("/");

  if (parts.length <= 4) {
    return filePath;
  }

  return `${parts.slice(0, 3).join("/")}/.../${parts.slice(-2).join("/")}`;
}

export function getBasename(filePath) {
  if (!filePath) {
    return "";
  }

  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}

export function getFolderName(filePath) {
  return getBasename(filePath);
}

export function createBlankDraft() {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");

  const timestamp = new Date().toISOString();

  return {
    filePath: "",
    slug: "",
    title: "",
    date,
    sections: createEmptySections(),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function cloneEntry(entry) {
  return JSON.parse(JSON.stringify(entry));
}

export function snapshotEntry(entry) {
  if (!entry) {
    return "";
  }

  const sections = normalizeSections(entry.sections);

  return JSON.stringify({
    filePath: entry.filePath || "",
    slug: entry.slug || "",
    title: entry.title || "",
    date: entry.date || "",
    sections: Object.fromEntries(DAILY_PROMPTS.map(({ key }) => [key, sections[key] || ""]))
  });
}

export function parseLocalDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function getWeekStart(dateString) {
  const date = parseLocalDate(dateString);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return date;
}

export function formatDateLong(dateString) {
  return parseLocalDate(dateString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export function formatDateInline(dateString) {
  return parseLocalDate(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  });
}

export function formatWeekStartLabel(dateString) {
  return getWeekStart(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export function getMonthLabel(dateString) {
  return getWeekStart(dateString).toLocaleDateString("en-US", {
    month: "long"
  });
}

export function getYearLabel(dateString) {
  return String(getWeekStart(dateString).getFullYear());
}

export function getSelectedYearKey(currentEntry) {
  if (!currentEntry || !currentEntry.date) {
    return "";
  }

  return getYearLabel(currentEntry.date);
}

export function getSelectedMonthKey(currentEntry) {
  if (!currentEntry || !currentEntry.date) {
    return "";
  }

  return getMonthKey(currentEntry.date);
}

export function getMonthKey(dateString) {
  const weekStart = getWeekStart(dateString);
  return `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, "0")}`;
}

export function getWeekKey(dateString) {
  const weekStart = getWeekStart(dateString);
  return [
    weekStart.getFullYear(),
    String(weekStart.getMonth() + 1).padStart(2, "0"),
    String(weekStart.getDate()).padStart(2, "0")
  ].join("-");
}

export function getSelectedWeekKey(currentEntry) {
  if (!currentEntry || !currentEntry.date) {
    return "";
  }

  return getWeekKey(currentEntry.date);
}

export function getCalendarMonthKey(dateString) {
  const [year, month] = dateString.split("-");
  return year && month ? `${year}-${month}` : "";
}
