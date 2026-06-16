const path = require("node:path");
const fsp = require("node:fs/promises");

function createDefaultSettings() {
  return {
    journalDirectory: "",
    integrations: {
      ouraConnectedHint: false,
      autoConnectOnStartup: true
    },
    security: {
      requireTouchIDOnLaunch: false
    }
  };
}

function normalizeSettings(settingsLike = {}) {
  const defaults = createDefaultSettings();
  const integrations = settingsLike.integrations && typeof settingsLike.integrations === "object"
    ? settingsLike.integrations
    : {};
  const security = settingsLike.security && typeof settingsLike.security === "object"
    ? settingsLike.security
    : {};
  const autoConnectOnStartup = Object.prototype.hasOwnProperty.call(integrations, "autoConnectOnStartup")
    ? Boolean(integrations.autoConnectOnStartup)
    : defaults.integrations.autoConnectOnStartup;

  return {
    journalDirectory: typeof settingsLike.journalDirectory === "string"
      ? settingsLike.journalDirectory
      : defaults.journalDirectory,
    integrations: {
      ouraConnectedHint: Boolean(integrations.ouraConnectedHint),
      autoConnectOnStartup
    },
    security: {
      requireTouchIDOnLaunch: Boolean(security.requireTouchIDOnLaunch)
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
    } catch (error) {
      if (error instanceof SyntaxError) {
        const corruptPath = `${getSettingsPath()}.corrupt.${Date.now()}`;
        await fsp.mkdir(app.getPath("userData"), { recursive: true });
        await fsp.rename(getSettingsPath(), corruptPath);
      }

      if (error && error.code && error.code !== "ENOENT" && !(error instanceof SyntaxError)) {
        throw error;
      }

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
