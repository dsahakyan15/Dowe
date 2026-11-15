// Google Gemini generateContent API adapter.
// Contract: returns { text, model } or throws an Error with a typed `.code`.
//
// Model ids get retired or restricted ("no longer available to new users")
// over time — including ones the ListModels endpoint still lists as
// supporting generateContent. So instead of trusting a single "best guess"
// model, we rank several candidates and actually try them in order against
// the real API until one succeeds, then cache that one.
//
// Preferred model for all Gemini requests is `gemini-3.5-flash-lite` (aka
// Gemini 3.5 Flash Lite). It is tried first; if it 404s we fall back to
// other lite/flash models.

const LIST_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_LITE_MODELS = ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite"];

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

function versionOf(id) {
  const match = id.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function rankModels(models) {
  const usable = models
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => (m.name || "").replace(/^models\//, ""))
    .filter((id) => id && !/vision|embed/i.test(id));

  // Always prefer the configured Flash Lite variants first if the API lists them.
  const preferredLite = FALLBACK_LITE_MODELS.filter((id) => usable.includes(id));
  const remaining = usable.filter((id) => !preferredLite.includes(id));

  const flash = remaining.filter((id) => /flash/i.test(id)).sort((a, b) => versionOf(b) - versionOf(a));
  const pro = remaining.filter((id) => /pro/i.test(id) && !/flash/i.test(id)).sort((a, b) => versionOf(b) - versionOf(a));
  const rest = remaining.filter((id) => !flash.includes(id) && !pro.includes(id));

  return [...preferredLite, ...flash, ...pro, ...rest];
}

async function fetchRankedModels(apiKey) {
  let response;
  try {
    response = await fetch(`${LIST_MODELS_URL}?key=${encodeURIComponent(apiKey)}`);
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

  return rankModels(data.models || []);
}

async function requestGenerateContent({ apiKey, model, systemPrompt, userPrompt, signal }) {
  const url = `${LIST_MODELS_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  try {
    const response = await fetch(url, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
      }),
    });
    return response;
  } catch (err) {
    if (err?.name === "AbortError") throw typedError("cancelled", "Request cancelled.");
    throw typedError("network", "Could not reach the Gemini API.");
  }
}

export async function callProvider({ apiKey, model, systemPrompt, userPrompt, signal }) {
  const tried = new Set();
  const candidates = [];

  // User explicitly chose a model -> respect it. Otherwise always start with
  // Gemini 3.5 Flash Lite (and its known fallbacks) before any cached value.
  if (model) {
    candidates.push(model);
  } else {
    for (const m of FALLBACK_LITE_MODELS) {
      if (!candidates.includes(m)) candidates.push(m);
    }
  }
  const cached = modelCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now() && !candidates.includes(cached.model)) {
    candidates.push(cached.model);
  }

  let response = null;
  let resolvedModel = null;

  for (const candidate of candidates) {
    if (tried.size >= MAX_ATTEMPTS) break;
    tried.add(candidate);
    response = await requestGenerateContent({ apiKey, model: candidate, systemPrompt, userPrompt, signal });
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
      response = await requestGenerateContent({ apiKey, model: candidate, systemPrompt, userPrompt, signal });
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
    throw typedError("provider_error", "Couldn't find a working Gemini model for this API key.");
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
    throw typedError("unknown", "Unexpected response from Gemini.");
  }

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim();
  if (!text) throw typedError("unknown", "Empty response from Gemini.");
  return { text, model: resolvedModel };
}
