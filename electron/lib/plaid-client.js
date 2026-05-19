const PLAID_REQUEST_TIMEOUT_MS = 20000;
const PLAID_ENVIRONMENTS = new Map([
  ["sandbox", "https://sandbox.plaid.com"],
  ["development", "https://development.plaid.com"],
  ["production", "https://production.plaid.com"]
]);

const RECONNECT_ERROR_CODES = new Set([
  "ACCESS_NOT_GRANTED",
  "INVALID_ACCESS_TOKEN",
  "ITEM_LOCKED",
  "ITEM_LOGIN_REQUIRED",
  "USER_PERMISSION_REVOKED"
]);

function normalizePlaidEnvironment(value) {
  const normalized = String(value || "development").trim().toLowerCase();

  if (normalized === "prod") {
    return "production";
  }

  if (PLAID_ENVIRONMENTS.has(normalized)) {
    return normalized;
  }

  return "development";
}

function getPlaidBaseUrl(environment) {
  return PLAID_ENVIRONMENTS.get(normalizePlaidEnvironment(environment));
}

function getTimeoutSignal() {
  return AbortSignal.timeout(PLAID_REQUEST_TIMEOUT_MS);
}

function createPlaidError(payload, status, fallbackMessage) {
  const message = payload?.display_message
    || payload?.error_message
    || payload?.error_code
    || fallbackMessage;
  const error = new Error(message);
  error.name = "PlaidApiError";
  error.status = status;
  error.errorCode = payload?.error_code || "";
  error.errorType = payload?.error_type || "";
  error.requestId = payload?.request_id || "";
  error.plaid = payload || {};

  return error;
}

function formatPlaidError(error, fallbackMessage = "Billbook could not reach Plaid.") {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return "Plaid took too long to respond.";
  }

  if (error?.errorCode === "PRODUCT_NOT_READY") {
    return "Plaid is still preparing transactions. Try refreshing Finances in a few minutes.";
  }

  if (error?.errorCode === "ITEM_LOGIN_REQUIRED") {
    return "Plaid needs you to reconnect this bank.";
  }

  return error?.message || fallbackMessage;
}

function isPlaidReconnectError(error) {
  return RECONNECT_ERROR_CODES.has(error?.errorCode || "");
}

async function postPlaid(credentials, endpoint, body = {}) {
  const clientId = String(credentials?.clientId || "").trim();
  const secret = String(credentials?.secret || "").trim();

  if (!clientId || !secret) {
    throw new Error("Plaid client credentials are not configured on this Mac.");
  }

  let response;

  try {
    response = await fetch(`${getPlaidBaseUrl(credentials.environment)}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: clientId,
        secret,
        ...body
      }),
      signal: getTimeoutSignal()
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("Plaid took too long to respond.");
    }

    throw error;
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw createPlaidError(payload, response.status, "Plaid rejected the request.");
  }

  return payload;
}

async function createLinkToken(credentials, { redirectUri } = {}) {
  const request = {
    client_name: "Billbook",
    country_codes: ["US"],
    language: "en",
    products: ["transactions"],
    transactions: {
      days_requested: 730
    },
    user: {
      client_user_id: "billbook-local-user"
    }
  };

  if (redirectUri) {
    request.redirect_uri = redirectUri;
  }

  return postPlaid(credentials, "/link/token/create", request);
}

async function exchangePublicToken(credentials, publicToken) {
  return postPlaid(credentials, "/item/public_token/exchange", {
    public_token: publicToken
  });
}

async function getAccounts(credentials, accessToken) {
  return postPlaid(credentials, "/accounts/get", {
    access_token: accessToken
  });
}

async function getTransactions(credentials, accessToken, {
  accountIds = [],
  endDate,
  startDate
}) {
  const transactions = [];
  let totalTransactions = Infinity;
  let offset = 0;

  while (transactions.length < totalTransactions) {
    const payload = await postPlaid(credentials, "/transactions/get", {
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: {
        account_ids: accountIds,
        count: 500,
        include_original_description: true,
        offset
      }
    });

    const page = Array.isArray(payload.transactions) ? payload.transactions : [];
    transactions.push(...page);
    totalTransactions = Number(payload.total_transactions || transactions.length);

    if (!page.length) {
      break;
    }

    offset += page.length;
  }

  return {
    transactions
  };
}

module.exports = {
  createLinkToken,
  exchangePublicToken,
  formatPlaidError,
  getAccounts,
  getTransactions,
  isPlaidReconnectError,
  normalizePlaidEnvironment
};
