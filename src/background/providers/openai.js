// OpenAI Chat Completions API adapter.
// Contract: returns { text, model } or throws an Error with a typed `.code`.
//
// Model ids get retired or restricted over time — including ones the
// /v1/models endpoint still lists. So instead of trusting a single "best
// guess" model, we rank several candidates and actually try them in order
// against the real API until one succeeds, then cache that one.

const LIST_MODELS_URL = "https://api.openai.com/v1/models";
const CHAT_URL = "https://api.openai.com/v1/chat/completions";
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

function isChatCapable(id) {
  return (
    /^(gpt-4|gpt-3\.5|o[134])/i.test(id) &&
    !/audio|realtime|embedding|whisper|tts|dall-e|moderation|transcribe|search|instruct/i.test(id)
  );
}

function rankModels(models) {
  const ids = models.map((m) => m.id).filter(Boolean).filter(isChatCapable);
  const mini = ids.filter((id) => /^gpt-4o-mini/i.test(id));
  const fourO = ids.filter((id) => /^gpt-4o/i.test(id) && !mini.includes(id));
  const fourX = ids.filter((id) => /^gpt-4/i.test(id) && !mini.includes(id) && !fourO.includes(id)).sort();
  const rest = ids.filter((id) => !mini.includes(id) && !fourO.includes(id) && !fourX.includes(id));
  return [...mini, ...fourO, ...fourX, ...rest];
}

async function fetchRankedModels(apiKey) {
  let response;
  try {
    response = await fetch(LIST_MODELS_URL, { headers: { authorization: `Bearer ${apiKey}` } });
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

async function requestChatCompletion({ apiKey, model, systemPrompt, userPrompt, signal }) {
  try {
    return await fetch(CHAT_URL, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch (err) {
    if (err?.name === "AbortError") throw typedError("cancelled", "Request cancelled.");
    throw typedError("network", "Could not reach the OpenAI API.");
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
    response = await requestChatCompletion({ apiKey, model: candidate, systemPrompt, userPrompt, signal });
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
      response = await requestChatCompletion({ apiKey, model: candidate, systemPrompt, userPrompt, signal });
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
    throw typedError("provider_error", "Couldn't find a working OpenAI model for this API key.");
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
    throw typedError("unknown", "Unexpected response from OpenAI.");
  }

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw typedError("unknown", "Empty response from OpenAI.");
  return { text, model: resolvedModel };
}
