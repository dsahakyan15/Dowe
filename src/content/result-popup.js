// Result popup in the selection icon's shadow root. Classic script.
(function () {
  const WIDTH = 320;
  const MARGIN = 8;
  const MODES = ["define", "translate", "simplify", "grammar"];
  const POPUP_STYLE = `
    .dowe-popup {
      all: initial; box-sizing: border-box; position: fixed; z-index: 2147483647;
      color-scheme: inherit;
      width: ${WIDTH}px; max-width: calc(100vw - 16px);
      max-height: min(420px, calc(100vh - 16px));
      display: flex; flex-direction: column; overflow: hidden;
      background: var(--dowe-bg, #fff); color: var(--dowe-text, #241f2e);
      border: 1px solid var(--dowe-border, #eae5f0); border-radius: var(--dowe-radius, 12px);
      box-shadow: var(--dowe-shadow, 0 8px 30px rgba(52,31,83,.09));
      font-family: var(--dowe-font, sans-serif); font-size: 14px;
    }
    .dowe-popup-header { display: flex; align-items: center; gap: 8px; padding: 14px 12px 14px 16px; flex-shrink: 0; }
    .dowe-popup-brand { font-size: 13px; font-weight: 650; letter-spacing: -.025em; }
    .dowe-popup-brand img { width: 20px; height: 20px; }
    .dowe-popup-mode { width: auto; max-width: 145px; margin-left: auto; padding: 5px 6px; border: 0; background: var(--dowe-bg-elevated); font-size: 11px; }
    .dowe-popup-selected-text {
      margin: 0 16px 12px; font-size: 23px; font-weight: 550; line-height: 1.3;
      letter-spacing: -.035em; overflow-wrap: anywhere; flex-shrink: 0;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }
    .dowe-popup-close { padding: 0; width: 28px; height: 28px; color: var(--dowe-text-muted); font-size: 19px; }
    .dowe-popup-body { padding: 0 16px; overflow-y: auto; min-height: 35px; }
    .dowe-popup-loading { display: flex; align-items: center; gap: 8px; color: var(--dowe-text-muted); }
    .dowe-popup-answer { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; }
    .dowe-popup-badges { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; align-items: center; }
    .dowe-popup-footer { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex-shrink: 0; padding-top: 12px; margin: 14px 16px 16px; border-top: 1px solid var(--dowe-border); }
    .dowe-popup-footer:empty { border: 0; padding: 0; margin-top: 0; }
    .dowe-popup-footer .dowe-btn { font-size: 11px; }
    .dowe-popup-level { color: var(--dowe-text-muted); padding: 6px 0; }
    .dowe-popup-spacer { flex: 1; }
    .dowe-popup-more { position: relative; margin-left: auto; }
    .dowe-popup-more summary { font-size: 11px; color: var(--dowe-text-muted); list-style: none; cursor: pointer; padding: 7px 4px; border-radius: 4px; }
    .dowe-popup-more summary::-webkit-details-marker { display: none; }
    .dowe-popup-menu { position: absolute; bottom: calc(100% + 6px); right: 0; width: 156px; padding: 5px; border: 1px solid var(--dowe-border); border-radius: 8px; background: var(--dowe-bg); box-shadow: var(--dowe-shadow); z-index: 1; }
    .dowe-popup-menu .dowe-btn { width: 100%; text-align: left; }
    .dowe-popup-link { color: var(--dowe-accent); background: none; border: 0; font: inherit; padding: 0; text-decoration: underline; }
    .dowe-popup-status { font-size: 11px; color: var(--dowe-text-muted); padding: 0 16px 12px; }
    .dowe-popup-status:empty { display: none; }
    .dowe-popup :focus-visible { outline: 2px solid var(--dowe-accent); outline-offset: 2px; }
  `;

  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [key, value] of Object.entries(attrs || {}))
      node.setAttribute(key, value);
    return node;
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function createResultPopup(shadowRoot, callbacks, strings) {
    const t = (key) => (strings && strings[key]) || key;
    const style = el("style");
    style.textContent = POPUP_STYLE;
    shadowRoot.appendChild(style);
    const root = el("section", "dowe-popup", { "aria-label": t("appName") });
    root.style.display = "none";
    const header = el("div", "dowe-popup-header");
    const brand = el("span", "dowe-brand dowe-popup-brand");
    const logo = el("img", "", {
      src: chrome.runtime.getURL("icons/logo.svg"),
      alt: "",
    });
    brand.append(logo, document.createTextNode("dowe"));
    const modeSelect = el("select", "dowe-select dowe-popup-mode", {
      "aria-label": t("settingsDefaultMode"),
    });
    for (const mode of MODES) {
      const option = el("option", "", { value: mode });
      option.textContent = t(`mode${capitalize(mode)}`);
      modeSelect.appendChild(option);
    }
    const closeBtn = el("button", "dowe-btn dowe-btn-icon dowe-popup-close", {
      type: "button",
      "aria-label": t("close"),
    });
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => callbacks.onClose?.());
    header.append(brand, modeSelect, closeBtn);
    const selectedText = el("h2", "dowe-popup-selected-text");
    const body = el("div", "dowe-popup-body");
    const footer = el("div", "dowe-popup-footer");
    const status = el("div", "dowe-popup-status", { role: "status" });
    root.append(header, selectedText, body, footer, status);
    shadowRoot.appendChild(root);
    root.addEventListener("mousedown", (event) => event.stopPropagation());
    root.addEventListener("keydown", (event) => {
      const more = footer.querySelector("details[open]");
      if (event.key === "Escape" && more) {
        event.stopPropagation();
        more.open = false;
        more.querySelector("summary").focus();
      }
    });

    let currentAnswerText = "";
    let currentMode = MODES[0];
    let currentLevel = "simple";
    let selectionRect = null;
    modeSelect.addEventListener("change", () => {
      currentMode = modeSelect.value;
      callbacks.onModeChange?.(currentMode);
    });

    function button(label, className, onClick) {
      const node = el("button", `dowe-btn ${className || ""}`, {
        type: "button",
      });
      node.textContent = label;
      node.addEventListener("click", onClick);
      return node;
    }
    function reset() {
      body.replaceChildren();
      footer.replaceChildren();
      status.textContent = "";
      modeSelect.hidden = true;
    }
    function show() {
      root.style.display = "flex";
      if (selectionRect) position(selectionRect);
    }
    function buildActionRow({
      showModeLevel,
      showSave,
      saved,
      showRegenerate = true,
    }) {
      modeSelect.hidden = !showModeLevel;
      modeSelect.value = currentMode;
      if (showModeLevel) {
        const levelBtn = button(
          t(currentLevel === "simple" ? "levelSimple" : "levelTechnical") +
            " ▾",
          "dowe-popup-level",
          () => {
            currentLevel = currentLevel === "simple" ? "technical" : "simple";
            callbacks.onLevelChange?.(currentLevel);
          },
        );
        levelBtn.setAttribute("aria-label", t("settingsDefaultLevel"));
        footer.appendChild(levelBtn);
      }
      footer.appendChild(el("span", "dowe-popup-spacer"));
      if (showSave) {
        const saveBtn = button(
          (saved ? "✓ " : "☆ ") + t(saved ? "saved" : "save"),
          saved ? "dowe-btn-saved" : "dowe-btn-primary",
          () => callbacks.onToggleSave?.(),
        );
        saveBtn.setAttribute("aria-pressed", String(saved));
        footer.appendChild(saveBtn);
      }
      const more = el("details", "dowe-popup-more");
      const summary = el("summary");
      summary.textContent = t("more");
      const menu = el("div", "dowe-popup-menu");
      menu.appendChild(
        button(t("copy"), "", async () => {
          more.open = false;
          try {
            await navigator.clipboard.writeText(currentAnswerText);
            status.textContent = t("copied");
            callbacks.onCopy?.(currentAnswerText);
          } catch {
            status.textContent = t("copyFailed");
          }
          if (isVisible()) show();
        }),
      );
      if (showRegenerate)
        menu.appendChild(
          button(t("regenerate"), "", () => {
            more.open = false;
            callbacks.onRegenerate?.({
              mode: currentMode,
              level: currentLevel,
            });
          }),
        );
      if (callbacks.onOpenDictionary)
        menu.appendChild(
          button(t("openDictionary"), "", () => {
            more.open = false;
            callbacks.onOpenDictionary();
          }),
        );
      more.append(summary, menu);
      footer.appendChild(more);
    }
    function showLoading({ text }) {
      selectedText.textContent = text;
      selectedText.title = text;
      reset();
      root.setAttribute("aria-busy", "true");
      const wrap = el("div", "dowe-popup-loading", { role: "status" });
      const label = el("span");
      label.textContent = t("loading");
      wrap.append(el("div", "dowe-spinner", { "aria-hidden": "true" }), label);
      body.appendChild(wrap);
      show();
    }
    function renderAnswer({
      answer,
      mode,
      level,
      badgeText,
      showAskAiAnyway,
      saved,
      showSave,
      showModeLevel = true,
      showRegenerate = true,
    }) {
      currentAnswerText = answer;
      currentMode = mode || currentMode;
      currentLevel = level || currentLevel;
      reset();
      root.setAttribute("aria-busy", "false");
      if (badgeText) {
        const badges = el("div", "dowe-popup-badges");
        const badge = el("span", "dowe-badge dowe-badge-accent");
        badge.textContent = badgeText;
        badges.appendChild(badge);
        if (showAskAiAnyway)
          badges.appendChild(
            button(t("askAiAnyway"), "dowe-popup-link", () =>
              callbacks.onAskAiAnyway?.(),
            ),
          );
        body.appendChild(badges);
      }
      const answerEl = el("div", "dowe-popup-answer");
      answerEl.textContent = answer;
      body.appendChild(answerEl);
      buildActionRow({ showModeLevel, showSave, saved, showRegenerate });
      show();
    }
    function showSuccess({ answer, mode, level, saved = true }) {
      renderAnswer({ answer, mode, level, showSave: true, saved });
    }
    function showFromGlossary({ answer, mode, level }) {
      renderAnswer({
        answer,
        mode,
        level,
        badgeText: t("fromGlossary"),
        showAskAiAnyway: true,
        showSave: false,
        showModeLevel: false,
        showRegenerate: false,
      });
    }
    function showError({ message, showRetry, showOpenSettings }) {
      reset();
      root.setAttribute("aria-busy", "false");
      const msg = el("div", "dowe-error-text dowe-popup-answer", {
        role: "alert",
      });
      msg.textContent = message;
      body.appendChild(msg);
      if (showRetry)
        footer.appendChild(
          button(t("retry"), "dowe-btn-primary", () => callbacks.onRetry?.()),
        );
      if (showOpenSettings)
        footer.appendChild(
          button(t("openSettings"), "dowe-btn-primary", () =>
            callbacks.onOpenSettings?.(),
          ),
        );
      show();
    }
    function showNoApiKey(message) {
      showError({
        message: message || t("errorNoApiKey"),
        showOpenSettings: true,
      });
    }
    function hide() {
      root.style.display = "none";
      const more = footer.querySelector("details");
      if (more) more.open = false;
    }
    function isVisible() {
      return root.style.display !== "none";
    }
    function position(rect) {
      selectionRect = rect;
      const height = root.offsetHeight || 200;
      const width = root.offsetWidth || WIDTH;
      let top = rect.bottom + 8;
      if (window.innerHeight - rect.bottom < height + MARGIN)
        top = rect.top - height - 8;
      top = Math.max(
        MARGIN,
        Math.min(top, window.innerHeight - height - MARGIN),
      );
      const left = Math.max(
        MARGIN,
        Math.min(rect.left, window.innerWidth - width - MARGIN),
      );
      root.style.top = `${top}px`;
      root.style.left = `${left}px`;
    }
    return {
      element: root,
      showLoading,
      showSuccess,
      showFromGlossary,
      showError,
      showNoApiKey,
      hide,
      isVisible,
      position,
    };
  }
  window.__DowePopup = { createResultPopup };
})();
