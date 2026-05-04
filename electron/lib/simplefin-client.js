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

async function claimAccessUrl(setupToken) {
  const claimUrl = decodeSetupToken(setupToken);
  const response = await fetch(claimUrl, {
    method: "POST",
    headers: {
      "Content-Length": "0"
    }
  });

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
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || "Failed to fetch data from SimpleFIN.");
  }

  return response.json();
}

module.exports = {
  claimAccessUrl,
  extractSetupToken,
  fetchAccounts
};
