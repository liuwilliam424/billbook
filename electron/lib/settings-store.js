const path = require("node:path");
const fsp = require("node:fs/promises");

function createDefaultSettings() {
  return {
    journalDirectory: "",
    finance: {
      netWorthAccountIds: [],
      spendingAccountIds: []
    },
    integrations: {
      simplefinConnectedHint: false,
      ouraConnectedHint: false
    }
  };
}

function normalizeSettings(settingsLike = {}) {
  const defaults = createDefaultSettings();
  const finance = settingsLike.finance && typeof settingsLike.finance === "object"
    ? settingsLike.finance
    : {};
  const integrations = settingsLike.integrations && typeof settingsLike.integrations === "object"
    ? settingsLike.integrations
    : {};

  return {
    ...defaults,
    ...settingsLike,
    finance: {
      ...defaults.finance,
      ...finance,
      netWorthAccountIds: Array.isArray(finance.netWorthAccountIds)
        ? finance.netWorthAccountIds.filter((value) => typeof value === "string" && value)
        : [],
      spendingAccountIds: Array.isArray(finance.spendingAccountIds)
        ? finance.spendingAccountIds.filter((value) => typeof value === "string" && value)
        : []
    },
    integrations: {
      ...defaults.integrations,
      ...integrations,
      simplefinConnectedHint: Boolean(integrations.simplefinConnectedHint),
      ouraConnectedHint: Boolean(integrations.ouraConnectedHint)
    }
  };
}

function createSettingsStore(app, fileName = "settings.json") {
  let cache = null;

  function getSettingsPath() {
    return path.join(app.getPath("userData"), fileName);
  }

  async function save(settings) {
    cache = normalizeSettings(settings);
    await fsp.mkdir(app.getPath("userData"), { recursive: true });
    await fsp.writeFile(getSettingsPath(), JSON.stringify(cache, null, 2), "utf8");
    return cache;
  }

  async function load() {
    if (cache) {
      return cache;
    }

    try {
      const raw = await fsp.readFile(getSettingsPath(), "utf8");
      cache = normalizeSettings(JSON.parse(raw));
    } catch {
      cache = createDefaultSettings();
      await save(cache);
    }

    return cache;
  }

  return {
    load,
    save
  };
}

module.exports = {
  createDefaultSettings,
  createSettingsStore,
  normalizeSettings
};
