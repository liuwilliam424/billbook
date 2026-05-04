const path = require("node:path");
const fsp = require("node:fs/promises");

function createSecureStore(app, safeStorage, fileName = "secure-store.json") {
  let cache = null;

  function getStorePath() {
    return path.join(app.getPath("userData"), fileName);
  }

  async function load() {
    if (cache) {
      return cache;
    }

    let raw = "";

    try {
      raw = await fsp.readFile(getStorePath(), "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        cache = {};
        return cache;
      }

      throw error;
    }

    try {
      const payload = JSON.parse(raw);

      if (!payload || typeof payload !== "object") {
        cache = {};
        return cache;
      }

      if (payload.encrypted && typeof payload.data === "string") {
        const decrypted = safeStorage.decryptString(Buffer.from(payload.data, "base64"));
        cache = JSON.parse(decrypted);
        return cache;
      }

      if (typeof payload.data === "string") {
        cache = JSON.parse(payload.data);
        return cache;
      }

      cache = {};
      return cache;
    } catch (error) {
      cache = null;

      if (error instanceof SyntaxError) {
        throw new Error("Billbook could not read its saved integration credentials.");
      }

      throw error;
    }
  }

  async function save(data) {
    cache = data && typeof data === "object" ? data : {};
    await fsp.mkdir(app.getPath("userData"), { recursive: true });

    const serialized = JSON.stringify(cache, null, 2);

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(serialized);
      await fsp.writeFile(
        getStorePath(),
        JSON.stringify(
          {
            encrypted: true,
            data: encrypted.toString("base64")
          },
          null,
          2
        ),
        "utf8"
      );
      return cache;
    }

    await fsp.writeFile(
      getStorePath(),
      JSON.stringify(
        {
          encrypted: false,
          data: serialized
        },
        null,
        2
      ),
      "utf8"
    );

    return cache;
  }

  return {
    load,
    save
  };
}

module.exports = {
  createSecureStore
};
