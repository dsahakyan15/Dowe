// Orchestrates selection detection, the floating icon, and the result
// popup. Classic (non-module) script — selection-icon.js and
// result-popup.js run first in the same content-script scope and expose
// window.__DoweIcon / window.__DowePopup.

(function () {
  const DEBOUNCE_MS = 150;
  const MAX_SELECTION_LENGTH = 1000;

  let settings = null;
  let STRINGS = null;

  let hostEl = null;
  let shadowRoot = null;
  let icon = null;
  let popup = null;

  let currentSelection = null; // { text, contextSentence, rect, tooLong }
  let activeRequestId = null;
  let lastLookupParams = null; // for retry/regenerate

  function log(...args) {
    // Uncomment during development:
    // console.debug("[Dowe]", ...args);
  }

  async function importModule(path) {
    const url = chrome.runtime.getURL(path);
    return import(url);
  }

  async function init() {
    const { getSettings } = await importModule("src/lib/storage.js");
    settings = await getSettings();

    if (isSiteDisabled(settings.disabledSites)) return;

    const stringsModule = await importModule("src/lib/strings.js");
    STRINGS = stringsModule.STRINGS;

    await mountShadowRoot();
    attachListeners();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings) {
        settings = { ...settings, ...changes.settings.newValue };
        applyTheme();
      }
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "TRIGGER_LOOKUP_SHORTCUT") {
        onShortcutTriggered();
      }
    });
  }

  function isSiteDisabled(disabledSites) {
    if (!Array.isArray(disabledSites) || disabledSites.length === 0)
      return false;
    const host = window.location.hostname;
    return disabledSites.some(
      (site) => host === site || host.endsWith(`.${site}`),
    );
  }

  async function mountShadowRoot() {
    hostEl = document.createElement("div");
    hostEl.id = "dowe-host";
    hostEl.style.all = "initial";
    document.documentElement.appendChild(hostEl);
    shadowRoot = hostEl.attachShadow({ mode: "closed" });
    applyTheme();

    try {
      const cssUrl = chrome.runtime.getURL("src/styles/shared.css");
      const cssText = await fetch(cssUrl).then((r) => r.text());
      const sharedStyle = document.createElement("style");
      sharedStyle.textContent = cssText;
      shadowRoot.appendChild(sharedStyle);
    } catch {
      /* shared tokens are cosmetic fallback only */
    }

    icon = window.__DoweIcon.createSelectionIcon(shadowRoot, onIconClick);
    popup = window.__DowePopup.createResultPopup(
      shadowRoot,
      {
        onClose: () => {
          popup.hide();
          if (currentSelection) icon.show(currentSelection.rect);
        },
        onRegenerate: ({ mode, level }) =>
          runLookup({ mode, level, skipGlossary: false }),
        onToggleSave: onToggleSave,
        onModeChange: (mode) =>
          runLookup({
            mode,
            level: lastLookupParams?.level,
            skipGlossary: false,
          }),
        onLevelChange: (level) =>
          runLookup({
            mode: lastLookupParams?.mode,
            level,
            skipGlossary: false,
          }),
        onAskAiAnyway: () =>
          runLookup({ ...lastLookupParams, skipGlossary: true }),
        onRetry: () => runLookup(lastLookupParams),
        onOpenSettings: () =>
          chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" }),
        onOpenDictionary: () =>
          chrome.runtime.sendMessage({ type: "OPEN_DICTIONARY" }),
        onCopy: () => {},
      },
      STRINGS,
    );
  }

  function applyTheme() {
    if (!hostEl) return;
    const theme = settings.theme;
    if (theme === "light" || theme === "dark")
      hostEl.setAttribute("data-theme", theme);
    else hostEl.removeAttribute("data-theme");
    hostEl.style.colorScheme =
      theme === "light" || theme === "dark" ? theme : "light dark";
  }

  function attachListeners() {
    let debounceTimer = null;
    const scheduleSelectionCheck = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(handleSelectionChange, DEBOUNCE_MS);
    };

    document.addEventListener("mouseup", scheduleSelectionCheck, true);
    document.addEventListener("selectionchange", scheduleSelectionCheck);

    window.addEventListener(
      "scroll",
      () => {
        hideAll();
      },
      true,
    );

    document.addEventListener(
      "mousedown",
      (e) => {
        if (hostEl && e.composedPath().includes(hostEl)) return;
        hideAll();
      },
      true,
    );

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideAll();
    });
  }

  function handleSelectionChange() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      currentSelection = null;
      icon.hide();
      return;
    }

    const rawText = selection.toString();
    const text = rawText.trim();
    if (!text) {
      currentSelection = null;
      icon.hide();
      return;
    }

    const range = selection.getRangeAt(0);
    if (
      hostEl &&
      range.commonAncestorContainer &&
      hostEl.contains(range.commonAncestorContainer)
    ) {
      return; // selection lives inside Dowe's own UI
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      icon.hide();
      return;
    }

    currentSelection = {
      text,
      rect,
      tooLong: text.length > MAX_SELECTION_LENGTH,
      contextSentence: extractContextSentence(range, text),
    };

    icon.show(rect);
  }

  function extractContextSentence(range, selectedText) {
    try {
      const container = range.commonAncestorContainer;
      const fullText =
        container.nodeType === Node.TEXT_NODE
          ? container.textContent
          : container.textContent || "";
      const idx = fullText.indexOf(selectedText);
      if (idx === -1) return selectedText;

      const before = fullText.slice(0, idx);
      const after = fullText.slice(idx + selectedText.length);
      const sentenceStart = Math.max(
        before.lastIndexOf("."),
        before.lastIndexOf("!"),
        before.lastIndexOf("?"),
      );
      const afterMatch = after.match(/[.!?]/);
      const sentenceEnd = afterMatch
        ? idx + selectedText.length + afterMatch.index + 1
        : fullText.length;

      return fullText
        .slice(sentenceStart + 1, sentenceEnd)
        .trim()
        .slice(0, 400);
    } catch {
      return selectedText;
    }
  }

  function onIconClick() {
    if (!currentSelection) return;
    runLookup({
      mode: settings.defaultMode,
      level: settings.defaultLevel,
      skipGlossary: false,
    });
  }

  function onShortcutTriggered() {
    if (!currentSelection) return; // silent no-op, per spec
    runLookup({
      mode: settings.defaultMode,
      level: settings.defaultLevel,
      skipGlossary: false,
      focus: true,
    });
  }

  async function runLookup({ mode, level, skipGlossary, focus = false }) {
    if (!currentSelection) return;
    const selection = currentSelection;
    lastLookupParams = { mode, level, skipGlossary };

    icon.hide();
    popup.showLoading({ text: selection.text, focus, mode: mode || settings.defaultMode });
    popup.position(selection.rect);

    if (selection.tooLong) {
      popup.showError({ message: STRINGS.errorSelectionTooLong });
      popup.position(selection.rect);
      return;
    }

    cancelInFlight();
    const requestId = crypto.randomUUID();
    activeRequestId = requestId;

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "LOOKUP",
        requestId,
        text: selection.text,
        mode,
        level,
        contextSentence: selection.contextSentence,
        url: window.location.href,
        title: document.title,
        skipGlossary,
      });
    } catch (err) {
      if (activeRequestId !== requestId) return; // superseded
      popup.showError({ message: STRINGS.errorNetwork, showRetry: true });
      return;
    }

    if (activeRequestId !== requestId) return; // selection changed / cancelled meanwhile
    if (!response) return; // cancelled

    handleLookupResponse(response, selection);
    popup.position(selection.rect);
  }

  function handleLookupResponse(response, selection) {
    if (response.status === "success") {
      if (response.fromGlossary) {
        popup.showFromGlossary({
          answer: response.answer,
          mode: response.mode,
          level: response.level,
        });
        lastAnswerData = null;
        lastEntryId = null;
      } else {
        lastLookupParams = {
          ...lastLookupParams,
          mode: response.mode,
          level: response.level,
          skipGlossary: false,
        };
        lastAnswerData = {
          term: selection.text,
          answer: response.answer,
          mode: response.mode,
          level: response.level,
          contextSentence: selection.contextSentence,
        };
        lastEntryId = response.entryId || null;
        popup.showSuccess({
          answer: response.answer,
          mode: response.mode,
          level: response.level,
          saved: !!lastEntryId,
        });
      }
      return;
    }

    // error
    if (response.code === "no_api_key") {
      popup.showNoApiKey(response.message);
    } else {
      popup.showError({
        message: response.message,
        showOpenSettings: response.code === "invalid_key",
        showRetry:
          response.code === "rate_limited" ||
          response.code === "network" ||
          response.code === "unknown",
      });
    }
  }

  let lastEntryId = null;
  let lastAnswerData = null;
  let savePending = false;

  async function onToggleSave() {
    if (!lastAnswerData || savePending) return;
    const answerData = lastAnswerData;
    const entryId = lastEntryId;
    const lookupId = activeRequestId;
    savePending = true;
    popup.setStatus(STRINGS[entryId ? "removing" : "saving"]);
    try {
      let nextEntryId = null;
      if (entryId) {
        const res = await chrome.runtime.sendMessage({ type: "UNSAVE_ENTRY", entryId });
        if (!res?.ok) throw new Error("unsave failed");
      } else {
        const res = await chrome.runtime.sendMessage({
          type: "SAVE_ENTRY",
          text: answerData.term,
          mode: answerData.mode,
          level: answerData.level,
          answer: answerData.answer,
          contextSentence: answerData.contextSentence,
          url: window.location.href,
          title: document.title,
        });
        if (!res?.ok || !res.entryId) throw new Error("save failed");
        nextEntryId = res.entryId;
      }
      if (lastAnswerData !== answerData || activeRequestId !== lookupId) return;
      lastEntryId = nextEntryId;
      if (popup.isVisible()) {
        popup.showSuccess({ ...answerData, saved: !!lastEntryId });
        popup.setStatus(STRINGS[entryId ? "removed" : "saved"]);
      }
    } catch {
      if (lastAnswerData === answerData && activeRequestId === lookupId && popup.isVisible())
        popup.setStatus(STRINGS[entryId ? "unsaveFailed" : "saveFailed"]);
    } finally {
      savePending = false;
    }
  }

  function cancelInFlight() {
    if (activeRequestId) {
      chrome.runtime
        .sendMessage({ type: "CANCEL_LOOKUP", requestId: activeRequestId })
        .catch(() => {});
      activeRequestId = null;
    }
  }

  function hideAll() {
    cancelInFlight();
    icon?.hide();
    popup?.hide();
  }

  init().catch((err) => log("init failed", err));
})();
