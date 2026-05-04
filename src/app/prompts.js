export const DAILY_PROMPTS = [
  { key: "feelings", label: "Feelings" },
  { key: "moments", label: "Moments" },
  { key: "predictions", label: "Predictions" },
  { key: "news", label: "News" },
  { key: "happiness", label: "Happiness" },
  { key: "finances", label: "Finances" }
];

export function createEmptySections() {
  return Object.fromEntries(DAILY_PROMPTS.map(({ key }) => [key, ""]));
}

export function normalizeSections(sectionsLike = {}) {
  const sections = createEmptySections();

  for (const { key } of DAILY_PROMPTS) {
    if (typeof sectionsLike[key] === "string") {
      sections[key] = sectionsLike[key];
    }
  }

  return sections;
}
