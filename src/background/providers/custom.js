// Custom / self-hosted endpoint adapter. Assumes an OpenAI-compatible
// /chat/completions schema, since that's what most local and proxy
// servers implement.

const MAX_TOKENS = 400;

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

export async function callProvider({ apiKey, model, systemPrompt, userPrompt, customEndpoint, signal }) {
  if (!customEndpoint) {
    throw typedError("provider_error", "No custom endpoint configured.");
  }

  let response;
  try {
    response = await fetch(customEndpoint, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model || "default",
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
  } catch (err) {
    if (err?.name === "AbortError") throw typedError("cancelled", "Request cancelled.");
    throw typedError("network", "Couldn't reach your custom endpoint — check the URL in settings.");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw typedError("invalid_key", "Invalid or expired API key.");
    }
    if (response.status === 429) {
      throw typedError("rate_limited", "Rate limited by provider.");
    }
    throw typedError("provider_error", "Couldn't reach your custom endpoint — check the URL in settings.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw typedError("unknown", "Unexpected response from custom endpoint.");
  }

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw typedError("unknown", "Empty response from custom endpoint.");
  return { text };
}
