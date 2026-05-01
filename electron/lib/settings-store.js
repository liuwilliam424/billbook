const path = require("node:path");
const fsp = require("node:fs/promises");

function createSettingsStore(app, fileName = "settings.json") {
  let cache = null;

  function getSettingsPath() {
    return path.join(app.getPath("userData"), fileName);
  }

  async function save(settings) {
    cache = settings;
    await fsp.mkdir(app.getPath("userData"), { recursive: true });
    await fsp.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), "utf8");
    return cache;
  }

  async function load() {
    if (cache) {
      return cache;
    }

    try {
      const raw = await fsp.readFile(getSettingsPath(), "utf8");
      cache = JSON.parse(raw);
    } catch {
      cache = { journalDirectory: "" };
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
  createSettingsStore
};
