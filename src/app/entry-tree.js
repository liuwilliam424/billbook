import {
  formatWeekStartLabel,
  getMonthKey,
  getMonthLabel,
  getWeekKey,
  getYearLabel
} from "./utils.js";

// Converts the flat entry list into the nested year -> month -> week shape
// that the sidebar renderer expects.
export function groupEntries(entries) {
  const years = new Map();

  for (const entry of entries) {
    const yearKey = getYearLabel(entry.date);
    const monthKey = getMonthKey(entry.date);
    const monthLabel = getMonthLabel(entry.date);
    const weekKey = getWeekKey(entry.date);
    const weekLabel = `Week of ${formatWeekStartLabel(entry.date)}`;

    if (!years.has(yearKey)) {
      years.set(yearKey, {
        yearKey,
        months: new Map()
      });
    }

    const yearGroup = years.get(yearKey);

    if (!yearGroup.months.has(monthKey)) {
      yearGroup.months.set(monthKey, {
        monthKey,
        monthLabel,
        weeks: new Map()
      });
    }

    const monthGroup = yearGroup.months.get(monthKey);

    if (!monthGroup.weeks.has(weekKey)) {
      monthGroup.weeks.set(weekKey, {
        weekKey,
        weekLabel,
        items: []
      });
    }

    monthGroup.weeks.get(weekKey).items.push(entry);
  }

  return Array.from(years.values())
    .map((yearGroup) => ({
      yearKey: yearGroup.yearKey,
      months: Array.from(yearGroup.months.values())
        .sort((left, right) => right.monthKey.localeCompare(left.monthKey))
        .map((monthGroup) => ({
          monthKey: monthGroup.monthKey,
          monthLabel: monthGroup.monthLabel,
          weeks: Array.from(monthGroup.weeks.values())
            .sort((left, right) => right.weekKey.localeCompare(left.weekKey))
            .map((weekGroup) => ({
              weekKey: weekGroup.weekKey,
              weekLabel: weekGroup.weekLabel,
              items: weekGroup.items.sort((left, right) => {
                if (left.date !== right.date) {
                  return right.date.localeCompare(left.date);
                }

                return right.updatedAt.localeCompare(left.updatedAt);
              })
            }))
        }))
    }))
    .sort((left, right) => right.yearKey.localeCompare(left.yearKey));
}
