const http = require("node:http");
const crypto = require("node:crypto");

const OURA_AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
const OURA_TOKEN_URL = "https://api.ouraring.com/oauth/token";
const OURA_SLEEP_URL = "https://api.ouraring.com/v2/usercollection/sleep";
const OURA_REDIRECT_URI = "http://localhost:53682/oura/callback";
const OURA_SCOPE = "daily";
const OURA_CONNECT_TIMEOUT_MS = 5 * 60 * 1000;
const OURA_EXPIRY_SKEW_MS = 60 * 1000;

function getNextDateString(dateString) {
  const value = typeof dateString === "string" ? dateString.trim() : "";

  if (!value) {
    return value;
  }

  const parsed = new Date(`${value}T12:00:00Z`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function createOuraService({ settingsStore, secureStore, shell }) {
  async function loadSecrets() {
    const secrets = await secureStore.load();
    return secrets && typeof secrets === "object" ? secrets : {};
  }

  async function saveSecrets(secrets) {
    return secureStore.save(secrets);
  }

  async function loadSettings() {
    return settingsStore.load();
  }

  async function saveSettings(settings) {
    return settingsStore.save(settings);
  }

  async function updateConnectionHint(connected) {
    const settings = await loadSettings();
    settings.integrations = {
      ...(settings.integrations || {}),
      ouraConnectedHint: Boolean(connected)
    };
    await saveSettings(settings);
  }

  function formatOuraError(payload, fallbackMessage) {
    if (!payload || typeof payload !== "object") {
      return fallbackMessage;
    }

    return payload.error_description
      || payload.detail
      || payload.title
      || fallbackMessage;
  }

  function buildAuthorizationUrl(clientId, state) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: OURA_REDIRECT_URI,
      scope: OURA_SCOPE,
      state
    });

    return `${OURA_AUTHORIZE_URL}?${params.toString()}`;
  }

  function createCallbackServer(expectedState) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        const requestUrl = new URL(request.url || "/", OURA_REDIRECT_URI);

        if (requestUrl.pathname !== "/oura/callback") {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        const error = requestUrl.searchParams.get("error");
        const state = requestUrl.searchParams.get("state");
        const code = requestUrl.searchParams.get("code");

        if (state !== expectedState) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end("<p>Billbook could not verify the Oura callback.</p>");
          cleanup();
          reject(new Error("Oura returned an invalid state parameter."));
          return;
        }

        if (error) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end("<p>Billbook could not connect to Oura.</p>");
          cleanup();
          reject(new Error(`Oura authorization failed: ${error}`));
          return;
        }

        if (!code) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end("<p>Billbook did not receive an authorization code from Oura.</p>");
          cleanup();
          reject(new Error("Oura did not return an authorization code."));
          return;
        }

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<p>Billbook is connected to Oura. You can close this window.</p>");
        cleanup();
        resolve(code);
      });

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Oura connection timed out before authorization completed."));
      }, OURA_CONNECT_TIMEOUT_MS);

      function cleanup() {
        clearTimeout(timeout);
        server.close();
      }

      server.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      server.listen(53682);
    });
  }

  async function exchangeToken({
    grantType,
    clientId,
    clientSecret,
    code = "",
    refreshToken = ""
  }) {
    const params = new URLSearchParams({
      grant_type: grantType,
      client_id: clientId,
      client_secret: clientSecret
    });

    if (grantType === "authorization_code") {
      params.set("code", code);
      params.set("redirect_uri", OURA_REDIRECT_URI);
    } else if (grantType === "refresh_token") {
      params.set("refresh_token", refreshToken);
    }

    const response = await fetch(OURA_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(formatOuraError(payload, "Oura rejected the token request."));
    }

    if (!payload.access_token) {
      throw new Error("Oura returned an empty access token.");
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token || "",
      expiresAt: Date.now() + Number(payload.expires_in || 0) * 1000
    };
  }

  async function getStatus() {
    const secrets = await loadSecrets();

    return {
      connected: Boolean(secrets.ouraRefreshToken || secrets.ouraAccessToken),
      hasClientCredentials: Boolean(secrets.ouraClientId && secrets.ouraClientSecret)
    };
  }

  async function autoConnect() {
    const status = await getStatus();

    if (!status.hasClientCredentials) {
      await updateConnectionHint(false);
      return status;
    }

    if (!status.connected) {
      return status;
    }

    try {
      await ensureAccessToken();
      await updateConnectionHint(true);
      return {
        connected: true,
        hasClientCredentials: true
      };
    } catch (error) {
      return {
        connected: false,
        hasClientCredentials: true,
        error: error.message || "Billbook could not reconnect to Oura."
      };
    }
  }

  async function saveClientCredentials({ clientId, clientSecret }) {
    const normalizedClientId = typeof clientId === "string" ? clientId.trim() : "";
    const normalizedClientSecret = typeof clientSecret === "string" ? clientSecret.trim() : "";

    if (!normalizedClientId || !normalizedClientSecret) {
      throw new Error("Both the Oura client ID and client secret are required.");
    }

    const secrets = await loadSecrets();
    await saveSecrets({
      ...secrets,
      ouraClientId: normalizedClientId,
      ouraClientSecret: normalizedClientSecret,
      ouraAccessToken: "",
      ouraRefreshToken: "",
      ouraTokenExpiresAt: 0
    });
    await updateConnectionHint(false);

    return {
      saved: true
    };
  }

  async function connect() {
    const secrets = await loadSecrets();
    const clientId = typeof secrets.ouraClientId === "string" ? secrets.ouraClientId : "";
    const clientSecret = typeof secrets.ouraClientSecret === "string" ? secrets.ouraClientSecret : "";

    if (!clientId || !clientSecret) {
      throw new Error("Oura client credentials are not configured on this machine.");
    }

    const state = crypto.randomBytes(24).toString("hex");
    const codePromise = createCallbackServer(state);
    const authorizationUrl = buildAuthorizationUrl(clientId, state);
    await shell.openExternal(authorizationUrl);
    const code = await codePromise;
    const tokens = await exchangeToken({
      grantType: "authorization_code",
      clientId,
      clientSecret,
      code
    });

    await saveSecrets({
      ...secrets,
      ouraAccessToken: tokens.accessToken,
      ouraRefreshToken: tokens.refreshToken,
      ouraTokenExpiresAt: tokens.expiresAt
    });
    await updateConnectionHint(true);

    return {
      connected: true
    };
  }

  async function clearTokens() {
    const secrets = await loadSecrets();
    delete secrets.ouraAccessToken;
    delete secrets.ouraRefreshToken;
    delete secrets.ouraTokenExpiresAt;
    await saveSecrets(secrets);
    await updateConnectionHint(false);
  }

  async function ensureAccessToken() {
    const secrets = await loadSecrets();
    const clientId = typeof secrets.ouraClientId === "string" ? secrets.ouraClientId : "";
    const clientSecret = typeof secrets.ouraClientSecret === "string" ? secrets.ouraClientSecret : "";

    if (!clientId || !clientSecret) {
      throw new Error("Oura client credentials are not configured on this machine.");
    }

    if (
      typeof secrets.ouraAccessToken === "string"
      && secrets.ouraAccessToken
      && Number(secrets.ouraTokenExpiresAt || 0) > Date.now() + OURA_EXPIRY_SKEW_MS
    ) {
      return secrets.ouraAccessToken;
    }

    if (!secrets.ouraRefreshToken) {
      await updateConnectionHint(false);
      throw new Error("Oura is not connected yet.");
    }

    try {
      const tokens = await exchangeToken({
        grantType: "refresh_token",
        clientId,
        clientSecret,
        refreshToken: secrets.ouraRefreshToken
      });

      await saveSecrets({
        ...secrets,
        ouraAccessToken: tokens.accessToken,
        ouraRefreshToken: tokens.refreshToken || secrets.ouraRefreshToken,
        ouraTokenExpiresAt: tokens.expiresAt
      });
      await updateConnectionHint(true);
      return tokens.accessToken;
    } catch (error) {
      await clearTokens();
      throw error;
    }
  }

  function formatDuration(seconds) {
    const totalMinutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `Duration: ${hours} hrs ${minutes} mins`;
  }

  function pickSleepRecord(records = [], dateString) {
    const eligible = (Array.isArray(records) ? records : [])
      .filter((record) => record && record.day === dateString)
      .filter((record) => typeof record.total_sleep_duration === "number" && record.total_sleep_duration > 0)
      .filter((record) => record.type !== "deleted" && record.type !== "rest");

    if (!eligible.length) {
      return null;
    }

    const preferred = eligible.filter((record) => record.type === "long_sleep");
    const candidates = preferred.length ? preferred : eligible;

    return candidates.sort((left, right) => {
      if (right.total_sleep_duration !== left.total_sleep_duration) {
        return right.total_sleep_duration - left.total_sleep_duration;
      }

      return String(right.bedtime_end || "").localeCompare(String(left.bedtime_end || ""));
    })[0];
  }

  async function buildSleepSection(dateString) {
    const accessToken = await ensureAccessToken();
    const params = new URLSearchParams({
      start_date: dateString,
      end_date: getNextDateString(dateString),
      fields: "day,total_sleep_duration,type,bedtime_end"
    });
    const response = await fetch(`${OURA_SLEEP_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = formatOuraError(payload, "Billbook could not load your Oura sleep data.");

      if (response.status === 401) {
        await clearTokens();
      }

      throw new Error(message);
    }

    const sleepRecord = pickSleepRecord(payload.data, dateString);

    if (!sleepRecord) {
      return {
        content: "Duration: unavailable"
      };
    }

    return {
      content: formatDuration(sleepRecord.total_sleep_duration)
    };
  }

  return {
    autoConnect,
    buildSleepSection,
    connect,
    getStatus,
    saveClientCredentials
  };
}

module.exports = {
  createOuraService,
  OURA_REDIRECT_URI
};
