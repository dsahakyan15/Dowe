import { getSettings, setSettings, addEntry, deleteEntry } from "../lib/storage.js";
import { t } from "../lib/strings.js";
import { findGlossaryMatch } from "./glossary-lookup.js";
import { buildPrompt } from "./prompt-builder.js";
import { callProvider as callAnthropic } from "./providers/anthropic.js";
import { callProvider as callOpenAI } from "./providers/openai.js";
import { callProvider as callGemini } from "./providers/gemini.js";
import { callProvider as callCustom } from "./providers/custom.js";
import { applyUpdateWhenIdle, setupUpdateManager } from "./update-manager.js";

const PROVIDERS = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  gemini: callGemini,
  custom: callCustom,
};

// Keyed by `${tabId}:${requestId}` so a cancel message from one tab never
// touches another tab's in-flight lookup.
const inFlight = new Map();

setupUpdateManager({ isBusy: () => inFlight.size > 0 });

const ERROR_MESSAGE_KEYS = {
  invalid_key: "errorInvalidKey",
  rate_limited: "errorRateLimited",
  network: "errorNetwork",
  provider_error: "errorUnknown",
  unknown: "errorUnknown",
};

function errorMessageForCode(code, provider) {
  if (provider === "custom" && (code === "network" || code === "provider_error")) {
    return t("errorCustomEndpoint");
  }
  return t(ERROR_MESSAGE_KEYS[code] || "errorUnknown");
}

async function handleLookup(message, sender) {
  const { requestId, text, mode, level, contextSentence, url, title } = message;
  const tabId = sender.tab?.id;
  const key = `${tabId}:${requestId}`;
  const controller = new AbortController();
  let settings;

  // Register the whole lookup, including local glossary/settings work, so an
  // available extension update cannot reload the worker halfway through it.
  inFlight.set(key, controller);
  try {
    const glossaryHit = message.skipGlossary ? null : await findGlossaryMatch(text);
    if (controller.signal.aborted) return null;
    if (glossaryHit) {
      return {
        status: "success",
        fromGlossary: true,
        answer: glossaryHit.definition,
        mode: glossaryHit.mode,
        level: glossaryHit.level,
      };
    }

    settings = await getSettings();
    if (controller.signal.aborted) return null;

    if (settings.provider === "custom") {
      if (!settings.customEndpoint) {
        return { status: "error", code: "no_api_key", message: t("errorCustomEndpoint") };
      }
    } else if (!settings.apiKey) {
      return { status: "error", code: "no_api_key", message: t("errorNoApiKey") };
    }

    const finalMode = mode || settings.defaultMode;
    const finalLevel = level || settings.defaultLevel;
    const { systemPrompt, userPrompt } = buildPrompt({
      mode: finalMode,
      level: finalLevel,
      targetLanguage: settings.targetLanguage,
      selectedText: text,
      contextSentence: settings.includeContext ? contextSentence : "",
    });

    const callFn = PROVIDERS[settings.provider] || PROVIDERS.anthropic;
    const { text: answer, model: usedModel } = await callFn({
      apiKey: settings.apiKey,
      model: settings.model,
      systemPrompt,
      userPrompt,
      customEndpoint: settings.customEndpoint,
      signal: controller.signal,
    });

    // The adapter auto-detected (or self-healed away from a stale/blocked)
    // model. Persist it so future lookups start from a known-working id
    // instead of re-discovering — or re-failing — every time.
    if (usedModel && usedModel !== settings.model) {
      setSettings({ model: usedModel }).catch(() => {});
    }

    let entryId = null;
    if (settings.autoSaveToDictionary) {
      const trimmed = text.trim();
      const entry = {
        id: crypto.randomUUID(),
        term: trimmed,
        normalizedTerm: trimmed.toLowerCase(),
        mode: finalMode,
        level: finalLevel,
        answer,
        contextSentence: contextSentence || "",
        sourceUrl: url || "",
        sourceTitle: title || "",
        createdAt: new Date().toISOString(),
        starred: false,
      };
      await addEntry(entry);
      entryId = entry.id;
    }

    return { status: "success", answer, mode: finalMode, level: finalLevel, entryId };
  } catch (err) {
    if (err.code === "cancelled" || controller.signal.aborted) return null;
    return {
      status: "error",
      code: err.code || "unknown",
      message: errorMessageForCode(err.code, settings?.provider),
    };
  } finally {
    inFlight.delete(key);
    applyUpdateWhenIdle();
  }
}

async function handleTestConnection({ provider, apiKey, model, customEndpoint }) {
  try {
    const { systemPrompt, userPrompt } = buildPrompt({
      mode: "define",
      level: "simple",
      targetLanguage: "en",
      selectedText: "hello",
      contextSentence: "",
    });
    const callFn = PROVIDERS[provider] || PROVIDERS.anthropic;
    const { model: usedModel } = await callFn({ apiKey, model, systemPrompt, userPrompt, customEndpoint });
    return { ok: true, model: usedModel };
  } catch (err) {
    return { ok: false, code: err.code || "unknown", message: err.message || t("errorUnknown") };
  }
}

function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "dowe-lookup",
      title: 'Ask Dowe about "%s"',
      contexts: ["selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
  setupContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "dowe-lookup") return;
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_LOOKUP_SHORTCUT" }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command, commandTab) => {
  if (command !== "trigger-lookup") return;
  let tab = commandTab;
  if (!tab?.id) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = activeTab;
  }
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: "TRIGGER_LOOKUP_SHORTCUT" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "LOOKUP") {
    handleLookup(message, sender)
      .then((response) => {
        if (response) sendResponse(response);
      })
      .catch(() => sendResponse({ status: "error", code: "unknown", message: t("errorUnknown") }));
    return true;
  }

  if (message?.type === "CANCEL_LOOKUP") {
    const tabId = sender.tab?.id;
    const key = `${tabId}:${message.requestId}`;
    inFlight.get(key)?.abort();
    return false;
  }

  if (message?.type === "TEST_CONNECTION") {
    handleTestConnection(message).then(sendResponse);
    return true;
  }

  if (message?.type === "SAVE_ENTRY") {
    const trimmed = (message.text || "").trim();
    const entry = {
      id: crypto.randomUUID(),
      term: trimmed,
      normalizedTerm: trimmed.toLowerCase(),
      mode: message.mode,
      level: message.level,
      answer: message.answer,
      contextSentence: message.contextSentence || "",
      sourceUrl: message.url || "",
      sourceTitle: message.title || "",
      createdAt: new Date().toISOString(),
      starred: false,
    };
    addEntry(entry)
      .then(() => sendResponse({ ok: true, entryId: entry.id }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "UNSAVE_ENTRY") {
    deleteEntry(message.entryId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    return false;
  }

  if (message?.type === "OPEN_DICTIONARY") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/dictionary/dictionary.html") });
    return false;
  }

  return false;
});
