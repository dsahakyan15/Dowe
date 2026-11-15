// Anthropic Messages API adapter.
// Contract: returns { text, model } or throws an Error with a typed `.code`
// ("invalid_key" | "rate_limited" | "network" | "provider_error" | "unknown").
//
// Model ids get retired or restricted over time — including ones the
// ListModels endpoint still lists. So instead of trusting a single "best
// guess" model, we rank several candidates and actually try them in order
// against the real API until one succeeds, then cache that one.

const LIST_MODELS_URL = "https://api.anthropic.com/v1/models";
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 400;
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 4;

// Keyed by apiKey — cleared on service worker restart, refreshed on 404.
const modelCache = new Map();

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function mapStatusToError(status, bodyText) {
  if (status === 401 || status === 403) return typedError("invalid_key", "Invalid or expired API key.");
  if (status === 429) return typedError("rate_limited", "Rate limited by provider.");
  if (status >= 500) return typedError("provider_error", "Provider returned a server error.");
  return typedError("provider_error", `Provider error (${status}): ${bodyText || "unknown"}`);
}

function anthropicHeaders(apiKey) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

function rankModels(models) {
  // Anthropic returns models newest-first; prefer a cheap/fast tier for
  // these short lookup-style requests, then everything else in list order.
  const ids = models.map((m) => m.id).filter(Boolean);
  const haiku = ids.filter((id) => /haiku/i.test(id));
  const rest = ids.filter((id) => !haiku.includes(id));
  return [...haiku, ...rest];
}

async function fetchRankedModels(apiKey) {
  let response;
  try {
    response = await fetch(LIST_MODELS_URL, { headers: anthropicHeaders(apiKey) });
  } catch {
    return [];
  }
  if (!response.ok) return [];

  let data;
  try {
    data = await response.json();
  } catch {
    return [];
  }

  return rankModels(data.data || []);
}

async function requestMessage({ apiKey, model, systemPrompt, userPrompt, signal }) {
  try {
    return await fetch(MESSAGES_URL, {
      method: "POST",
      signal,
      headers: anthropicHeaders(apiKey),
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch (err) {
    if (err?.name === "AbortError") throw typedError("cancelled", "Request cancelled.");
    throw typedError("network", "Could not reach the Anthropic API.");
  }
}

export async function callProvider({ apiKey, model, systemPrompt, userPrompt, signal }) {
  const tried = new Set();
  const candidates = [];

  if (model) candidates.push(model);
  const cached = modelCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now() && !candidates.includes(cached.model)) {
    candidates.push(cached.model);
  }

  let response = null;
  let resolvedModel = null;

  for (const candidate of candidates) {
    if (tried.size >= MAX_ATTEMPTS) break;
    tried.add(candidate);
    response = await requestMessage({ apiKey, model: candidate, systemPrompt, userPrompt, signal });
    if (response.status !== 404) {
      resolvedModel = candidate;
      break;
    }
  }

  if (!resolvedModel) {
    const ranked = await fetchRankedModels(apiKey);
    for (const candidate of ranked) {
      if (tried.has(candidate) || tried.size >= MAX_ATTEMPTS) continue;
      tried.add(candidate);
      response = await requestMessage({ apiKey, model: candidate, systemPrompt, userPrompt, signal });
      if (response.status !== 404) {
        resolvedModel = candidate;
        break;
      }
    }
  }

  if (!resolvedModel) {
    if (response) {
      const bodyText = await response.text().catch(() => "");
      throw mapStatusToError(response.status, bodyText);
    }
    throw typedError("provider_error", "Couldn't find a working Anthropic model for this API key.");
  }

  modelCache.set(apiKey, { model: resolvedModel, expiresAt: Date.now() + CACHE_TTL_MS });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw mapStatusToError(response.status, bodyText);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw typedError("unknown", "Unexpected response from Anthropic.");
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) throw typedError("unknown", "Empty response from Anthropic.");
  return { text, model: resolvedModel };
}
