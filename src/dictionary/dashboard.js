// Frequency dashboard: groups dictionary entries by normalized term and
// renders a plain-HTML horizontal bar list (no charting library).

import { t } from "../lib/strings.js";

const DEFAULT_VISIBLE = 20;

function groupByFrequency(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = entry.normalizedTerm || entry.term.trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count);
}

export function renderDashboard(container, entries) {
  const grouped = groupByFrequency(entries);
  let visibleCount = DEFAULT_VISIBLE;

  function draw() {
    container.innerHTML = "";

    if (grouped.length === 0) {
      const empty = document.createElement("p");
      empty.className = "dowe-muted dowe-small dowe-empty";
      empty.textContent = t("dictionaryEmpty");
      container.appendChild(empty);
      return;
    }

    const max = grouped[0].count;
    const visible = grouped.slice(0, visibleCount);

    for (const { term, count } of visible) {
      const row = document.createElement("div");
      row.className = "dowe-bar-row";

      const label = document.createElement("span");
      label.className = "dowe-bar-label";
      label.textContent = term;
      label.title = term;

      const track = document.createElement("span");
      track.className = "dowe-bar-track";
      const fill = document.createElement("span");
      fill.className = "dowe-bar-fill";
      fill.style.width = `${Math.max(4, Math.round((count / max) * 100))}%`;
      track.appendChild(fill);

      const countEl = document.createElement("span");
      countEl.className = "dowe-bar-count";
      countEl.textContent = String(count);

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(countEl);
      container.appendChild(row);
    }

    if (grouped.length > DEFAULT_VISIBLE) {
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "dowe-btn";
      toggleBtn.textContent = visibleCount < grouped.length ? t("dashboardShowMore") : t("dashboardShowLess");
      toggleBtn.addEventListener("click", () => {
        visibleCount = visibleCount < grouped.length ? grouped.length : DEFAULT_VISIBLE;
        draw();
      });
      container.appendChild(toggleBtn);
    }
  }

  draw();
}
