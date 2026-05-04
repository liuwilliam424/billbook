const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const { claimAccessUrl, extractSetupToken, fetchAccounts } = require("./simplefin-client");

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

function toEpochRange(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);

  return {
    startDate: Math.floor(start.getTime() / 1000),
    endDate: Math.floor(end.getTime() / 1000)
  };
}

function summarizeErrors(errlist = []) {
  return Array.isArray(errlist)
    ? errlist
        .map((error) => (error && typeof error.msg === "string" ? error.msg.trim() : ""))
        .filter(Boolean)
    : [];
}

function buildConnectionsById(connections = []) {
  return new Map(
    (Array.isArray(connections) ? connections : [])
      .filter((connection) => connection && typeof connection.conn_id === "string")
      .map((connection) => [connection.conn_id, connection])
  );
}

function summarizeAccounts(accounts = [], connectionsById = new Map()) {
  return (Array.isArray(accounts) ? accounts : [])
    .filter((account) => account && typeof account.id === "string")
    .map((account) => {
      const connection = connectionsById.get(account.conn_id) || {};
      return {
        id: account.id,
        name: String(account.name || "Unnamed account"),
        connectionName: typeof connection.name === "string" ? connection.name : "",
        currency: typeof account.currency === "string" ? account.currency : "USD",
        balance: toNumber(account.balance),
        availableBalance: account["available-balance"] !== undefined
          ? toNumber(account["available-balance"])
          : null,
        balanceDate: typeof account["balance-date"] === "number" ? account["balance-date"] : 0,
        transactionCount: Array.isArray(account.transactions) ? account.transactions.length : 0
      };
    });
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

function selectTransactionsForDate(account, dateString) {
  const transactions = Array.isArray(account.transactions) ? account.transactions : [];

  return transactions
    .filter((transaction) => transaction && typeof transaction.id === "string")
    .filter((transaction) => {
      const amount = toNumber(transaction.amount);

      if (amount >= 0) {
        return false;
      }

      const eventTimestamp = transaction.transacted_at || transaction.posted || 0;

      if (!eventTimestamp) {
        return false;
      }

      const txDate = new Date(eventTimestamp * 1000);
      const normalizedDate = [
        txDate.getFullYear(),
        String(txDate.getMonth() + 1).padStart(2, "0"),
        String(txDate.getDate()).padStart(2, "0")
      ].join("-");

      return normalizedDate === dateString;
    })
    .sort((left, right) => {
      const leftTimestamp = left.transacted_at || left.posted || 0;
      const rightTimestamp = right.transacted_at || right.posted || 0;
      return leftTimestamp - rightTimestamp;
    });
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

  const lines = ["### Net Worth"];

  if (groupedByCurrency.size === 1) {
    const [[currency, total]] = groupedByCurrency.entries();
    lines.push(formatMoney(total, currency));
  } else {
    for (const account of accounts) {
      lines.push(`- ${account.name}: ${formatMoney(toNumber(account.balance), account.currency || "USD")}`);
    }
  }

  const balanceTimestamps = accounts
    .map((account) => Number(account["balance-date"] || account.balanceDate || 0))
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

function renderSpendingSection(account, transactions = []) {
  const lines = [`### ${account.name}`];

  if (!transactions.length) {
    lines.push("- No charges captured for this day.");
    return lines.join("\n");
  }

  let total = 0;

  for (const transaction of transactions) {
    const amount = Math.abs(toNumber(transaction.amount));
    total += amount;
    lines.push(`- ${transaction.description || "Unlabeled charge"} — ${formatMoney(amount, account.currency || "USD")}`);
  }

  lines.push(`Total: ${formatMoney(total, account.currency || "USD")}`);
  return lines.join("\n");
}

function renderFinanceSection({ dateString, accounts, financeConfig }) {
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
    blocks.push(renderSpendingSection(account, selectTransactionsForDate(account, dateString)));
  }

  return blocks.join("\n\n");
}

function createFinanceService({ app, dialog, settingsStore, secureStore }) {
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

  async function chooseSetupTokenFile() {
    const defaultCandidates = [
      path.join(process.cwd(), ".env.dev"),
      path.join(app.getAppPath(), ".env.dev"),
      path.join(app.getPath("home"), "Downloads")
    ];
    const defaultPath = defaultCandidates.find((candidate) => fsSync.existsSync(candidate))
      || app.getPath("home");

    return dialog.showOpenDialog({
      title: "Choose SimpleFIN Token File",
      defaultPath,
      properties: ["openFile"]
    });
  }

  async function getAccessUrl() {
    const secrets = await loadSecrets();
    return typeof secrets.simplefinAccessUrl === "string" ? secrets.simplefinAccessUrl : "";
  }

  async function fetchSimplefinAccounts(query = {}) {
    const accessUrl = await getAccessUrl();

    if (!accessUrl) {
      throw new Error("SimpleFIN is not connected yet.");
    }

    return fetchAccounts(accessUrl, query);
  }

  async function getStatus() {
    const settings = await loadSettings();
    const accessUrl = await getAccessUrl();
    const financeConfig = normalizeFinanceConfig(settings.finance || {});

    return {
      connected: Boolean(accessUrl),
      configured: financeConfig.netWorthAccountIds.length > 0 || financeConfig.spendingAccountIds.length > 0,
      financeConfig
    };
  }

  async function connectFromFile() {
    const result = await chooseSetupTokenFile();

    if (result.canceled || !result.filePaths[0]) {
      return {
        canceled: true,
        accounts: [],
        financeConfig: normalizeFinanceConfig()
      };
    }

    const rawTokenFile = await fs.readFile(result.filePaths[0], "utf8");
    const setupToken = extractSetupToken(rawTokenFile);
    const accessUrl = await claimAccessUrl(setupToken);
    const secrets = await loadSecrets();
    await saveSecrets({
      ...secrets,
      simplefinAccessUrl: accessUrl
    });
    const response = await fetchAccounts(accessUrl, {
      "balances-only": 1
    });
    const connectionsById = buildConnectionsById(response.connections);
    const accounts = summarizeAccounts(response.accounts, connectionsById);
    const settings = await loadSettings();
    const currentConfig = normalizeFinanceConfig(settings.finance || {});
    const financeConfig =
      currentConfig.netWorthAccountIds.length || currentConfig.spendingAccountIds.length
        ? currentConfig
        : guessDefaultFinanceConfig(accounts);

    return {
      canceled: false,
      accounts,
      financeConfig,
      warnings: summarizeErrors(response.errlist)
    };
  }

  async function listAccounts() {
    const response = await fetchSimplefinAccounts({
      "balances-only": 1
    });
    const connectionsById = buildConnectionsById(response.connections);
    const settings = await loadSettings();

    return {
      accounts: summarizeAccounts(response.accounts, connectionsById),
      financeConfig: normalizeFinanceConfig(settings.finance || {}),
      warnings: summarizeErrors(response.errlist)
    };
  }

  async function saveFinanceConfig(financeConfigLike) {
    const settings = await loadSettings();
    settings.finance = normalizeFinanceConfig(financeConfigLike);
    const savedSettings = await settingsStore.save(settings);

    return normalizeFinanceConfig(savedSettings.finance);
  }

  async function buildFinanceSnapshot(dateString) {
    const settings = await loadSettings();
    const financeConfig = normalizeFinanceConfig(settings.finance || {});

    if (!financeConfig.netWorthAccountIds.length && !financeConfig.spendingAccountIds.length) {
      return {
        content: "",
        warnings: []
      };
    }

    const { startDate, endDate } = toEpochRange(dateString);
    const response = await fetchSimplefinAccounts({
      "start-date": startDate,
      "end-date": endDate
    });

    return {
      content: renderFinanceSection({
        dateString,
        accounts: Array.isArray(response.accounts) ? response.accounts : [],
        financeConfig
      }),
      warnings: summarizeErrors(response.errlist)
    };
  }

  return {
    buildFinanceSnapshot,
    connectFromFile,
    getStatus,
    listAccounts,
    saveFinanceConfig
  };
}

module.exports = {
  createFinanceService,
  normalizeFinanceConfig
};
