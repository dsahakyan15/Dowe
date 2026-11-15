// Floating icon shown near a text selection. Classic (non-module) script,
// shares the page's content-script scope with result-popup.js and
// content-script.js via the window.__DoweIcon namespace.

(function () {
  const ICON_SIZE = 28;
  const VIEWPORT_MARGIN = 8;

  const ICON_STYLE = `
    .dowe-icon-btn {
      all: initial;
      position: fixed;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      width: ${ICON_SIZE}px;
      height: ${ICON_SIZE}px;
      border-radius: 9px;
      box-shadow: var(--dowe-shadow, 0 4px 14px rgba(0,0,0,0.25));
      cursor: pointer;
      font-family: var(--dowe-font, sans-serif);
      transition: transform 0.08s ease;
      overflow: hidden;
    }
    .dowe-icon-btn:hover { transform: scale(1.08); }
    .dowe-icon-btn:active { transform: scale(0.96); }
    .dowe-icon-btn img {
      width: 100%;
      height: 100%;
      display: block;
      pointer-events: none;
    }
  `;

  function createSelectionIcon(shadowRoot, onClick) {
    const styleEl = document.createElement("style");
    styleEl.textContent = ICON_STYLE;
    shadowRoot.appendChild(styleEl);

    const btn = document.createElement("button");
    btn.className = "dowe-icon-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Ask Dowe");
    btn.style.display = "none";

    const img = document.createElement("img");
    img.src = chrome.runtime.getURL("icons/logo.svg");
    img.alt = "";
    btn.appendChild(img);

    shadowRoot.appendChild(btn);

    btn.addEventListener("mousedown", (e) => {
      // Prevent the host page from losing/clearing the text selection.
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });

    function show(rect) {
      const top = clamp(
        rect.top - ICON_SIZE - 6,
        VIEWPORT_MARGIN,
        window.innerHeight - ICON_SIZE - VIEWPORT_MARGIN,
      );
      const left = clamp(
        rect.right - ICON_SIZE / 2,
        VIEWPORT_MARGIN,
        window.innerWidth - ICON_SIZE - VIEWPORT_MARGIN,
      );
      btn.style.top = `${top}px`;
      btn.style.left = `${left}px`;
      btn.style.display = "flex";
    }

    function hide() {
      btn.style.display = "none";
    }

    function isVisible() {
      return btn.style.display !== "none";
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    return { element: btn, show, hide, isVisible };
  }

  window.__DoweIcon = { createSelectionIcon };
})();
