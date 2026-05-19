const crypto = require("node:crypto");
const http = require("node:http");

const {
  createLinkToken,
  exchangePublicToken,
  formatPlaidError,
  getAccounts,
  getTransactions,
  isPlaidReconnectError,
  normalizePlaidEnvironment
} = require("./plaid-client");

const STATUS_CACHE_MS = 30 * 60 * 1000;
const PLAID_CALLBACK_PORT = 53683;
const PLAID_LOCAL_ORIGIN = `http://localhost:${PLAID_CALLBACK_PORT}`;
const PLAID_CALLBACK_URL = `${PLAID_LOCAL_ORIGIN}/plaid/callback`;
const PLAID_CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(amount, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDateLong(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function getPreviousDateString(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);

  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  date.setDate(date.getDate() - 1);
  return formatDate(date);
}

function getPlaidCredentials(secrets = {}) {
  return {
    clientId: typeof secrets.plaidClientId === "string" ? secrets.plaidClientId.trim() : "",
    secret: typeof secrets.plaidSecret === "string" ? secrets.plaidSecret.trim() : "",
    environment: normalizePlaidEnvironment(secrets.plaidEnvironment)
  };
}

function hasPlaidCredentials(credentials) {
  return Boolean(credentials.clientId && credentials.secret);
}

function normalizePlaidItems(itemsLike = []) {
  return (Array.isArray(itemsLike) ? itemsLike : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      accessToken: typeof item.accessToken === "string" ? item.accessToken : "",
      connectedAt: typeof item.connectedAt === "string" ? item.connectedAt : "",
      institutionId: typeof item.institutionId === "string" ? item.institutionId : "",
      institutionName: typeof item.institutionName === "string" ? item.institutionName : "",
      itemId: typeof item.itemId === "string" ? item.itemId : ""
    }))
    .filter((item) => item.accessToken);
}

function getStoredPlaidItems(secrets = {}) {
  const items = normalizePlaidItems(secrets.plaidItems);

  if (typeof secrets.plaidAccessToken === "string" && secrets.plaidAccessToken) {
    items.push({
      accessToken: secrets.plaidAccessToken,
      connectedAt: "",
      institutionId: "",
      institutionName: "",
      itemId: typeof secrets.plaidItemId === "string" ? secrets.plaidItemId : ""
    });
  }

  const seen = new Set();

  return items.filter((item) => {
    const key = item.itemId || item.accessToken;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function upsertPlaidItem(items, nextItem) {
  const filteredItems = items.filter((item) => {
    if (nextItem.itemId && item.itemId === nextItem.itemId) {
      return false;
    }

    if (nextItem.institutionId && item.institutionId === nextItem.institutionId) {
      return false;
    }

    return true;
  });

  return [...filteredItems, nextItem];
}

function guessDefaultFinanceConfig(accounts = []) {
  const netWorthAccountIds = [];
  const spendingAccountIds = [];

  for (const account of accounts) {
    const name = account.name.toLowerCase();

    if (/(credit|visa|mastercard|amex|discover|card|freedom|sapphire|reserve|unlimited)/i.test(name)) {
      spendingAccountIds.push(account.id);
      continue;
    }

    if (/(check|checking|savings|cash|brokerage|investment|fidelity|ira|college)/i.test(name)) {
      netWorthAccountIds.push(account.id);
    }
  }

  if (!netWorthAccountIds.length && spendingAccountIds.length && accounts.length === 2) {
    const remainingAccount = accounts.find((account) => !spendingAccountIds.includes(account.id));

    if (remainingAccount) {
      netWorthAccountIds.push(remainingAccount.id);
    }
  }

  if (!netWorthAccountIds.length && !spendingAccountIds.length && accounts.length === 2) {
    netWorthAccountIds.push(accounts[0].id);
    spendingAccountIds.push(accounts[1].id);
  }

  if (!netWorthAccountIds.length && accounts[0]) {
    netWorthAccountIds.push(accounts[0].id);
  }

  if (!spendingAccountIds.length && accounts.length > 1) {
    for (const account of accounts) {
      if (!netWorthAccountIds.includes(account.id)) {
        spendingAccountIds.push(account.id);
      }
    }
  }

  return {
    netWorthAccountIds,
    spendingAccountIds
  };
}

function normalizeFinanceConfig(configLike = {}) {
  return {
    netWorthAccountIds: Array.isArray(configLike.netWorthAccountIds)
      ? configLike.netWorthAccountIds.filter((value) => typeof value === "string" && value)
      : [],
    spendingAccountIds: Array.isArray(configLike.spendingAccountIds)
      ? configLike.spendingAccountIds.filter((value) => typeof value === "string" && value)
      : []
  };
}

function filterFinanceConfigToAccounts(financeConfig, accounts = []) {
  const accountIds = new Set(accounts.map((account) => account.id));

  return {
    netWorthAccountIds: financeConfig.netWorthAccountIds.filter((id) => accountIds.has(id)),
    spendingAccountIds: financeConfig.spendingAccountIds.filter((id) => accountIds.has(id))
  };
}

function hasFinanceConfig(financeConfig) {
  return Boolean(financeConfig.netWorthAccountIds.length || financeConfig.spendingAccountIds.length);
}

function getConfiguredAccountIds(financeConfig) {
  return [...new Set([
    ...financeConfig.netWorthAccountIds,
    ...financeConfig.spendingAccountIds
  ])];
}

function getAccountCurrency(account) {
  return account?.balances?.iso_currency_code
    || account?.balances?.unofficial_currency_code
    || "USD";
}

function getAccountBalance(account) {
  const current = account?.balances?.current;
  const available = account?.balances?.available;
  const rawBalance = current === null || current === undefined ? available : current;
  const balance = toNumber(rawBalance);

  if (account?.type === "credit" || account?.type === "loan") {
    return -balance;
  }

  return balance;
}

function formatPlaidAccountName(account) {
  const name = account.official_name || account.name || "Unnamed account";
  return account.mask ? `${name} (${account.mask})` : name;
}

function summarizePlaidAccounts(accounts = [], item = {}, responseItem = {}) {
  const connectionName = responseItem.institution_name || item.institutionName || "";
  const balanceDate = Math.floor(Date.now() / 1000);

  return (Array.isArray(accounts) ? accounts : [])
    .filter((account) => account && typeof account.account_id === "string")
    .map((account) => ({
      id: account.account_id,
      name: formatPlaidAccountName(account),
      connectionName,
      currency: getAccountCurrency(account),
      balance: getAccountBalance(account),
      availableBalance: account?.balances?.available === null || account?.balances?.available === undefined
        ? null
        : toNumber(account.balances.available),
      balanceDate,
      itemId: item.itemId,
      transactionCount: 0,
      transactions: [],
      type: account.type || "",
      subtype: account.subtype || ""
    }));
}

function dateToEpoch(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000);
}

function summarizePlaidTransactions(transactions = []) {
  return (Array.isArray(transactions) ? transactions : [])
    .filter((transaction) => transaction && typeof transaction.transaction_id === "string")
    .map((transaction) => {
      const eventDate = transaction.authorized_date || transaction.date || "";
      const timestamp = transaction.authorized_datetime
        ? Math.floor(Date.parse(transaction.authorized_datetime) / 1000)
        : dateToEpoch(eventDate);

      return {
        id: transaction.transaction_id,
        accountId: transaction.account_id || "",
        description: transaction.merchant_name
          || transaction.name
          || transaction.original_description
          || "Unlabeled charge",
        amount: -Math.abs(toNumber(transaction.amount)),
        pending: Boolean(transaction.pending),
        eventDate,
        eventTimestamp: Number.isFinite(timestamp) ? timestamp : 0
      };
    });
}

function attachTransactions(accounts = [], transactions = []) {
  const transactionsByAccount = new Map();

  for (const transaction of transactions) {
    if (!transaction.accountId) {
      continue;
    }

    const current = transactionsByAccount.get(transaction.accountId) || [];
    current.push(transaction);
    transactionsByAccount.set(transaction.accountId, current);
  }

  return accounts.map((account) => {
    const accountTransactions = transactionsByAccount.get(account.id) || [];

    return {
      ...account,
      transactionCount: accountTransactions.length,
      transactions: accountTransactions
    };
  });
}

function selectTransactionsForDate(account, dateString) {
  const transactions = Array.isArray(account.transactions) ? account.transactions : [];

  return transactions
    .filter((transaction) => transaction && typeof transaction.id === "string")
    .filter((transaction) => transaction.pending === true)
    .filter((transaction) => toNumber(transaction.amount) < 0)
    .filter((transaction) => transaction.eventDate === dateString)
    .sort((left, right) => toNumber(left.eventTimestamp) - toNumber(right.eventTimestamp));
}

function renderNetWorthSection(accounts = [], dateString) {
  if (!accounts.length) {
    return "";
  }

  const groupedByCurrency = new Map();

  for (const account of accounts) {
    const currency = account.currency || "USD";
    const currentGroup = groupedByCurrency.get(currency) || 0;
    groupedByCurrency.set(currency, currentGroup + toNumber(account.balance));
  }

  const lines = ["Net Worth"];

  if (groupedByCurrency.size === 1) {
    const [[currency, total]] = groupedByCurrency.entries();
    lines.push(formatMoney(total, currency));
  } else {
    for (const account of accounts) {
      lines.push(`- ${account.name}: ${formatMoney(toNumber(account.balance), account.currency || "USD")}`);
    }
  }

  const balanceTimestamps = accounts
    .map((account) => Number(account.balanceDate || 0))
    .filter((timestamp) => timestamp > 0);
  const snapshotLabel = balanceTimestamps.length
    ? new Date(Math.max(...balanceTimestamps) * 1000).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric"
      })
    : formatDateLong(dateString);

  lines.push(`As of ${snapshotLabel}`);

  return lines.join("\n");
}

function renderSpendingSection(account, transactions = [], spendingDateString) {
  const lines = [account.name];
  lines.push(`Pending charges from ${formatDateLong(spendingDateString)}`);

  if (!transactions.length) {
    lines.push("- No pending charges captured.");
    return lines.join("\n");
  }

  let total = 0;

  for (const transaction of transactions) {
    const amount = Math.abs(toNumber(transaction.amount));
    const pendingLabel = transaction.pending ? " (pending)" : "";
    total += amount;
    lines.push(
      `- ${transaction.description || "Unlabeled charge"} - ${formatMoney(amount, account.currency || "USD")}${pendingLabel}`
    );
  }

  lines.push(`Total: ${formatMoney(total, account.currency || "USD")}`);
  return lines.join("\n");
}

function renderFinanceSection({ dateString, spendingDateString, accounts, financeConfig }) {
  const netWorthAccounts = accounts.filter((account) =>
    financeConfig.netWorthAccountIds.includes(account.id)
  );
  const spendingAccounts = accounts.filter((account) =>
    financeConfig.spendingAccountIds.includes(account.id)
  );
  const blocks = [];
  const netWorthBlock = renderNetWorthSection(netWorthAccounts, dateString);

  if (netWorthBlock) {
    blocks.push(netWorthBlock);
  }

  for (const account of spendingAccounts) {
    blocks.push(
      renderSpendingSection(
        account,
        selectTransactionsForDate(account, spendingDateString),
        spendingDateString
      )
    );
  }

  return blocks.join("\n\n");
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk.toString();

      if (body.length > 2 * 1024 * 1024) {
        reject(new Error("Plaid Link response was too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Plaid Link returned invalid JSON."));
      }
    });

    request.on("error", reject);
  });
}

function createPlaidLinkHtml({ linkToken, receivedRedirectUri = "", sessionId }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Connect Plaid - Billbook</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f7f5ef;
        color: #252321;
        font-family: Georgia, "Times New Roman", serif;
      }
      main {
        width: min(520px, calc(100vw - 48px));
      }
      p {
        color: #706a66;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        line-height: 1.5;
      }
      .eyebrow {
        margin: 0 0 14px;
        color: #8b817d;
        font-size: 12px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: 42px;
        line-height: 1.05;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Billbook</p>
      <h1>Opening Plaid...</h1>
      <p id="status">This window will finish the bank connection and hand the token back to Billbook.</p>
    </main>
    <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
    <script>
      const linkToken = ${JSON.stringify(linkToken)};
      const receivedRedirectUri = ${JSON.stringify(receivedRedirectUri)};
      const sessionId = ${JSON.stringify(sessionId)};
      const status = document.querySelector("#status");

      function postResult(path, payload) {
        return fetch(path + "?session=" + encodeURIComponent(sessionId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload || {})
        });
      }

      function launchPlaid() {
        if (!window.Plaid) {
          status.textContent = "Plaid Link did not load. Check your internet connection and try again.";
          return;
        }

        const config = {
          token: linkToken,
          onSuccess: async (publicToken, metadata) => {
            status.textContent = "Plaid connected. You can close this window.";
            await postResult("/plaid/success", { publicToken, metadata });
          },
          onExit: async (error, metadata) => {
            status.textContent = error?.display_message || error?.error_message || "Plaid connection closed.";
            await postResult("/plaid/exit", { error, metadata });
          }
        };

        if (receivedRedirectUri) {
          config.receivedRedirectUri = receivedRedirectUri;
        }

        window.Plaid.create(config).open();
      }

      window.addEventListener("load", launchPlaid);
    </script>
  </body>
</html>`;
}

function createPlaidLinkSession(linkToken) {
  const sessionId = crypto.randomBytes(18).toString("hex");
  let server;
  let timeout;
  let settled = false;
  let settleResult;

  const resultPromise = new Promise((resolve, reject) => {
    settleResult = (success, value) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (server) {
        server.close();
      }

      if (success) {
        resolve(value);
      } else {
        reject(value);
      }
    };

    timeout = setTimeout(() => {
      settleResult(false, new Error("Plaid connection timed out before Link completed."));
    }, PLAID_CONNECT_TIMEOUT_MS);
  });

  server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url || "/", PLAID_LOCAL_ORIGIN);

    if (requestUrl.searchParams.get("session") && requestUrl.searchParams.get("session") !== sessionId) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Invalid session.");
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === "GET" && ["/plaid/link", "/plaid/callback"].includes(requestUrl.pathname)) {
      const receivedRedirectUri = requestUrl.pathname === "/plaid/callback"
        ? `${PLAID_CALLBACK_URL}${requestUrl.search}`
        : "";
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(createPlaidLinkHtml({ linkToken, receivedRedirectUri, sessionId }));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/plaid/success") {
      try {
        const body = await readJsonBody(request);

        if (!body.publicToken) {
          throw new Error("Plaid did not return a public token.");
        }

        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true }));
        settleResult(true, {
          canceled: false,
          metadata: body.metadata || {},
          publicToken: body.publicToken
        });
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: false }));
        settleResult(false, error);
      }
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/plaid/exit") {
      const body = await readJsonBody(request).catch(() => ({}));
      const error = body.error || null;
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));

      if (error) {
        settleResult(
          false,
          new Error(error.display_message || error.error_message || "Plaid Link closed before connecting.")
        );
      } else {
        settleResult(true, {
          canceled: true
        });
      }
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  const readyPromise = new Promise((resolve, reject) => {
    server.once("error", (error) => {
      clearTimeout(timeout);
      settled = true;
      reject(error);
    });
    server.listen(PLAID_CALLBACK_PORT, "localhost", () => {
      resolve({
        resultPromise,
        startUrl: `${PLAID_LOCAL_ORIGIN}/plaid/link?session=${sessionId}`
      });
    });
  });

  return readyPromise;
}

function createFinanceService({ settingsStore, secureStore, shell }) {
  let statusCache = null;

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

  async function updateConnectionHint(connected) {
    const settings = await loadSettings();
    settings.integrations = {
      ...(settings.integrations || {}),
      plaidConnectedHint: Boolean(connected),
      simplefinConnectedHint: false
    };
    await settingsStore.save(settings);
  }

  function clearStatusCache() {
    statusCache = null;
  }

  function getConfiguredStatus(financeConfig, overrides = {}) {
    return {
      connected: false,
      configured: hasFinanceConfig(financeConfig),
      financeConfig,
      hasClientCredentials: false,
      itemCount: 0,
      requiresReconnect: false,
      statusMessage: "",
      warnings: [],
      ...overrides
    };
  }

  async function getCredentialsAndItems() {
    const secrets = await loadSecrets();
    return {
      credentials: getPlaidCredentials(secrets),
      items: getStoredPlaidItems(secrets),
      secrets
    };
  }

  async function fetchAccountsForItems({
    financeConfig = normalizeFinanceConfig(),
    includeTransactionsForDate = ""
  } = {}) {
    const { credentials, items } = await getCredentialsAndItems();

    if (!hasPlaidCredentials(credentials)) {
      throw new Error("Plaid client credentials are not configured on this Mac.");
    }

    if (!items.length) {
      throw new Error("Plaid is not connected yet.");
    }

    const accounts = [];
    const spendingAccountIds = new Set(financeConfig.spendingAccountIds);

    for (const item of items) {
      const accountResponse = await getAccounts(credentials, item.accessToken);
      let itemAccounts = summarizePlaidAccounts(accountResponse.accounts, item, accountResponse.item);
      const itemSpendingIds = itemAccounts
        .filter((account) => spendingAccountIds.has(account.id))
        .map((account) => account.id);

      if (includeTransactionsForDate && itemSpendingIds.length) {
        const transactionsResponse = await getTransactions(credentials, item.accessToken, {
          accountIds: itemSpendingIds,
          startDate: includeTransactionsForDate,
          endDate: includeTransactionsForDate
        });
        itemAccounts = attachTransactions(
          itemAccounts,
          summarizePlaidTransactions(transactionsResponse.transactions)
        );
      }

      accounts.push(...itemAccounts);
    }

    return accounts;
  }

  async function getStatus({ forceRefresh = false } = {}) {
    const settings = await loadSettings();
    const financeConfig = normalizeFinanceConfig(settings.finance || {});
    const { credentials, items } = await getCredentialsAndItems();
    const hasClientCredentials = hasPlaidCredentials(credentials);

    if (!hasClientCredentials) {
      const disconnectedStatus = getConfiguredStatus(financeConfig);
      await updateConnectionHint(false);
      return disconnectedStatus;
    }

    if (!items.length) {
      await updateConnectionHint(false);
      return getConfiguredStatus(financeConfig, {
        hasClientCredentials: true
      });
    }

    const now = Date.now();

    if (!forceRefresh && statusCache && statusCache.expiresAt > now) {
      return {
        ...statusCache.value,
        financeConfig
      };
    }

    try {
      await fetchAccountsForItems({ financeConfig });
      const status = getConfiguredStatus(financeConfig, {
        connected: true,
        hasClientCredentials: true,
        itemCount: items.length
      });

      await updateConnectionHint(true);
      statusCache = {
        value: status,
        expiresAt: now + STATUS_CACHE_MS
      };
      return status;
    } catch (error) {
      const status = getConfiguredStatus(financeConfig, {
        connected: false,
        hasClientCredentials: true,
        itemCount: items.length,
        requiresReconnect: isPlaidReconnectError(error),
        statusMessage: formatPlaidError(error, "Billbook could not reach Plaid.")
      });

      await updateConnectionHint(false);
      statusCache = {
        value: status,
        expiresAt: now + STATUS_CACHE_MS
      };
      return status;
    }
  }

  async function autoConnect() {
    return getStatus({ forceRefresh: true });
  }

  async function savePlaidCredentials(credentialsLike = {}) {
    const clientId = typeof credentialsLike.clientId === "string" ? credentialsLike.clientId.trim() : "";
    const secret = typeof credentialsLike.secret === "string" ? credentialsLike.secret.trim() : "";
    const environment = normalizePlaidEnvironment(credentialsLike.environment);

    if (!clientId || !secret) {
      throw new Error("Both the Plaid client ID and secret are required.");
    }

    const secrets = await loadSecrets();
    const existingCredentials = getPlaidCredentials(secrets);
    const credentialsMatch =
      existingCredentials.clientId === clientId
      && existingCredentials.secret === secret
      && existingCredentials.environment === environment;
    const nextSecrets = {
      ...secrets,
      plaidClientId: clientId,
      plaidEnvironment: environment,
      plaidItems: credentialsMatch ? getStoredPlaidItems(secrets) : [],
      plaidSecret: secret
    };

    delete nextSecrets.plaidAccessToken;
    delete nextSecrets.plaidItemId;

    await saveSecrets(nextSecrets);
    clearStatusCache();
    await updateConnectionHint(credentialsMatch && nextSecrets.plaidItems.length > 0);

    return {
      environment,
      saved: true
    };
  }

  async function connectPlaid() {
    const { credentials, items, secrets } = await getCredentialsAndItems();

    if (!hasPlaidCredentials(credentials)) {
      throw new Error("Plaid client credentials are not configured on this Mac.");
    }

    const linkTokenResponse = await createLinkToken(credentials);

    if (!linkTokenResponse.link_token) {
      throw new Error("Plaid returned an empty Link token.");
    }

    const linkSession = await createPlaidLinkSession(linkTokenResponse.link_token);
    await shell.openExternal(linkSession.startUrl);
    const linkResult = await linkSession.resultPromise;

    if (linkResult?.canceled) {
      return {
        canceled: true,
        accounts: [],
        financeConfig: normalizeFinanceConfig()
      };
    }

    const exchangeResponse = await exchangePublicToken(credentials, linkResult.publicToken);

    if (!exchangeResponse.access_token) {
      throw new Error("Plaid returned an empty access token.");
    }

    const institution = linkResult.metadata?.institution || {};
    const nextItem = {
      accessToken: exchangeResponse.access_token,
      connectedAt: new Date().toISOString(),
      institutionId: institution.institution_id || "",
      institutionName: institution.name || "",
      itemId: exchangeResponse.item_id || ""
    };
    const plaidItems = upsertPlaidItem(items, nextItem);
    await saveSecrets({
      ...secrets,
      plaidItems
    });
    clearStatusCache();

    const accounts = await fetchAccountsForItems();
    await updateConnectionHint(true);
    const settings = await loadSettings();
    const currentConfig = normalizeFinanceConfig(settings.finance || {});
    const validCurrentConfig = filterFinanceConfigToAccounts(currentConfig, accounts);
    const financeConfig = hasFinanceConfig(validCurrentConfig)
      ? validCurrentConfig
      : guessDefaultFinanceConfig(accounts);

    return {
      canceled: false,
      accounts,
      financeConfig,
      warnings: []
    };
  }

  async function listAccounts() {
    clearStatusCache();
    const settings = await loadSettings();
    const accounts = await fetchAccountsForItems();

    return {
      accounts,
      financeConfig: filterFinanceConfigToAccounts(
        normalizeFinanceConfig(settings.finance || {}),
        accounts
      ),
      warnings: []
    };
  }

  async function saveFinanceConfig(financeConfigLike) {
    const settings = await loadSettings();
    settings.finance = normalizeFinanceConfig(financeConfigLike);
    const savedSettings = await settingsStore.save(settings);
    clearStatusCache();

    return normalizeFinanceConfig(savedSettings.finance);
  }

  async function buildFinanceSnapshot(dateString) {
    const settings = await loadSettings();
    const financeConfig = normalizeFinanceConfig(settings.finance || {});

    if (!getConfiguredAccountIds(financeConfig).length) {
      return {
        content: "",
        warnings: []
      };
    }

    const spendingDateString = getPreviousDateString(dateString);
    const accounts = await fetchAccountsForItems({
      financeConfig,
      includeTransactionsForDate: spendingDateString
    });
    clearStatusCache();

    return {
      content: renderFinanceSection({
        dateString,
        spendingDateString,
        accounts,
        financeConfig
      }),
      warnings: []
    };
  }

  return {
    autoConnect,
    buildFinanceSnapshot,
    connectPlaid,
    getStatus,
    listAccounts,
    saveFinanceConfig,
    savePlaidCredentials
  };
}

module.exports = {
  createFinanceService,
  normalizeFinanceConfig,
  PLAID_CALLBACK_URL
};
