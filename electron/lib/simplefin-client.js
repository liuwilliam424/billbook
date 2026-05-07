function stripWrappingQuotes(value) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function extractSetupToken(rawValue) {
  const trimmed = String(rawValue || "").trim();

  if (!trimmed) {
    throw new Error("The selected SimpleFIN token file was empty.");
  }

  const directLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (
    directLines.length === 1 &&
    !/^(?:export\s+)?SIMPLEFIN_SETUP_TOKEN\s*=/.test(directLines[0])
  ) {
    return directLines[0];
  }

  for (const line of directLines) {
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);

    if (!match) {
      continue;
    }

    if (match[1] === "SIMPLEFIN_SETUP_TOKEN") {
      return stripWrappingQuotes(match[2]);
    }
  }

  throw new Error("No SimpleFIN setup token was found in the selected file.");
}

function decodeSetupToken(setupToken) {
  try {
    const decoded = Buffer.from(String(setupToken || "").trim(), "base64").toString("utf8").trim();
    const url = new URL(decoded);

    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("unsupported protocol");
    }

    return url.toString();
  } catch {
    throw new Error("The SimpleFIN setup token could not be decoded.");
  }
}

function parseAccessUrl(accessUrl) {
  const parsed = new URL(accessUrl);
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);

  if (!username || !password) {
    throw new Error("The SimpleFIN access URL was missing credentials.");
  }

  parsed.username = "";
  parsed.password = "";

  return {
    baseUrl: parsed.toString().replace(/\/$/, ""),
    username,
    password
  };
}

const SIMPLEFIN_REQUEST_TIMEOUT_MS = 15000;

function getTimeoutSignal() {
  return AbortSignal.timeout(SIMPLEFIN_REQUEST_TIMEOUT_MS);
}

async function claimAccessUrl(setupToken) {
  const claimUrl = decodeSetupToken(setupToken);
  let response;

  try {
    response = await fetch(claimUrl, {
      method: "POST",
      headers: {
        "Content-Length": "0"
      },
      signal: getTimeoutSignal()
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("SimpleFIN took too long to claim the setup token.");
    }

    throw error;
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "SimpleFIN rejected the setup token.");
  }

  const accessUrl = (await response.text()).trim();

  if (!accessUrl) {
    throw new Error("SimpleFIN returned an empty access URL.");
  }

  return accessUrl;
}

function createAccountsUrl(baseUrl, query = {}) {
  const url = new URL("accounts", `${baseUrl}/`);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== "") {
          url.searchParams.append(key, String(item));
        }
      }

      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url;
}

async function fetchAccounts(accessUrl, query = {}) {
  const { baseUrl, username, password } = parseAccessUrl(accessUrl);
  const url = createAccountsUrl(baseUrl, {
    version: 2,
    ...query
  });
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  let response;

  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json"
      },
      signal: getTimeoutSignal()
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("SimpleFIN took too long to respond.");
    }

    throw error;
  }

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(body || "Failed to fetch data from SimpleFIN.");
    error.status = response.status;
    throw error;
  }

  return response.json();
}

module.exports = {
  claimAccessUrl,
  extractSetupToken,
  fetchAccounts
};
