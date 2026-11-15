import {
  clearEntries,
  clearUpdateNotice,
  deleteEntry,
  getAllEntries,
  getSettings,
  getUpdateNotice,
  updateEntry,
} from "../lib/storage.js";
import { t } from "../lib/strings.js";
import { renderDashboard } from "./dashboard.js";

const MODES = ["define", "translate", "simplify", "grammar"];

let allEntries = [];
let filterMode = "all";
let searchQuery = "";
let sortMode = "date-desc";
let expandedId = null;
const rerunResults = new Map();

const entriesList = document.getElementById("entries-list");
const emptyState = document.getElementById("empty-state");
const searchInput = document.getElementById("search-input");
const sortSelect = document.getElementById("sort-select");
const modeFilterChips = document.getElementById("mode-filter-chips");
const entryTemplate = document.getElementById("entry-template");
const dashboardRoot = document.getElementById("dashboard-root");
const dictionaryStatus = document.getElementById("dictionary-status");
const clearFiltersBtn = document.getElementById("clear-filters-btn");

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function computeFrequency(entries) {
  const counts = new Map();
  for (const e of entries) {
    const key = e.normalizedTerm || e.term.trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function getFilteredSortedEntries() {
  let result = allEntries;

  if (filterMode !== "all") {
    result = result.filter((e) => e.mode === filterMode);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    result = result.filter(
      (e) =>
        e.term.toLowerCase().includes(q) ||
        (e.answer || "").toLowerCase().includes(q),
    );
  }

  result = [...result];
  if (sortMode === "date-desc") {
    result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else if (sortMode === "date-asc") {
    result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } else if (sortMode === "frequency") {
    const freq = computeFrequency(allEntries);
    result.sort((a, b) => {
      const fa = freq.get(a.normalizedTerm) || 0;
      const fb = freq.get(b.normalizedTerm) || 0;
      if (fb !== fa) return fb - fa;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  return result;
}

function renderModeChips() {
  modeFilterChips.innerHTML = "";
  const options = [
    ["all", "All"],
    ...MODES.map((m) => [m, t(`mode${capitalize(m)}`)]),
  ];
  for (const [value, label] of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.className = value === filterMode ? "active" : "";
    btn.setAttribute("aria-pressed", String(value === filterMode));
    btn.dataset.mode = value;
    btn.addEventListener("click", () => {
      filterMode = value;
      for (const chip of modeFilterChips.children) {
        const active = chip.dataset.mode === value;
        chip.classList.toggle("active", active);
        chip.setAttribute("aria-pressed", String(active));
      }
      renderList();
    });
    modeFilterChips.appendChild(btn);
  }
}

function renderList() {
  const active = document.activeElement;
  const focusedEntry = active?.closest(".dowe-entry");
  const focusedId = focusedEntry?.dataset.entryId;
  const focusedAction = active?.dataset.action;
  const filtered = getFilteredSortedEntries();
  entriesList.innerHTML = "";
  emptyState.hidden = filtered.length > 0;
  emptyState.textContent = t(allEntries.length ? "dictionaryNoMatches" : "dictionaryEmpty");
  clearFiltersBtn.hidden = filtered.length > 0 || !allEntries.length;
  document.getElementById("export-glossary-btn").textContent = searchQuery || filterMode !== "all"
    ? "Export filtered entries" : t("dictionaryExport");

  for (const entry of filtered) {
    entriesList.appendChild(renderEntryNode(entry));
  }
  if (focusedId && focusedAction) {
    const row = Array.from(entriesList.children).find(n => n.dataset.entryId === focusedId);
    (row?.querySelector(`[data-action="${focusedAction}"]`) || searchInput).focus({ preventScroll: true });
  }
}

function renderEntryNode(entry) {
  const node = entryTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.entryId = entry.id;
  const summaryBtn = node.querySelector(".dowe-entry-summary");
  const termEl = node.querySelector(".dowe-entry-term");
  const snippetEl = node.querySelector(".dowe-entry-snippet");
  const modeBadge = node.querySelector(".dowe-entry-mode");
  const dateEl = node.querySelector(".dowe-entry-date");
  const starEl = node.querySelector(".dowe-entry-star");
  const detail = node.querySelector(".dowe-entry-detail");
  const answerEl = node.querySelector(".dowe-entry-answer");
  const sourceEl = node.querySelector(".dowe-entry-source");
  const starBtn = node.querySelector(".dowe-entry-star-btn");
  const rerunBtn = node.querySelector(".dowe-entry-rerun-btn");
  const deleteBtn = node.querySelector(".dowe-entry-delete-btn");
  for (const [button, action] of [[summaryBtn, "summary"], [starBtn, "star"], [rerunBtn, "rerun"], [deleteBtn, "delete"]]) button.dataset.action = action;

  termEl.textContent = entry.term;
  snippetEl.textContent = entry.answer;
  modeBadge.textContent = `${t(`mode${capitalize(entry.mode)}`)} · ${t(`level${capitalize(entry.level)}`)}`;
  dateEl.textContent = formatDate(entry.createdAt);
  starEl.textContent = entry.starred ? "★" : "";
  starEl.classList.toggle("starred", !!entry.starred);
  if (entry.starred) {
    const label = document.createElement("span");
    label.className = "dowe-sr-only";
    label.textContent = "Starred";
    summaryBtn.appendChild(label);
  }

  answerEl.textContent = entry.answer;
  sourceEl.textContent = entry.sourceUrl
    ? `${entry.sourceTitle || entry.sourceUrl} — ${formatDate(entry.createdAt)}`
    : formatDate(entry.createdAt);

  starBtn.textContent = entry.starred
    ? t("dictionaryUnstar")
    : t("dictionaryStar");
  rerunBtn.textContent = t("dictionaryRerun");
  deleteBtn.textContent = t("dictionaryDelete");
  const result = rerunResults.get(entry.id);
  if (result?.answer) answerEl.textContent = result.answer;
  if (result) {
    const feedback = document.createElement("p");
    feedback.className = "dowe-small dowe-muted";
    feedback.textContent = result.message;
    detail.appendChild(feedback);
    if (result.code === "invalid_key" || result.code === "no_api_key") {
      const settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = "dowe-btn";
      settingsBtn.textContent = t("openSettings");
      settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
      detail.appendChild(settingsBtn);
    }
    if (result.pending) {
      rerunBtn.textContent = t("dictionaryRerunning");
      rerunBtn.setAttribute("aria-disabled", "true");
    }
  }

  const isExpanded = expandedId === entry.id;
  detail.hidden = !isExpanded;
  detail.id = `entry-detail-${entry.id}`;
  summaryBtn.setAttribute("aria-expanded", String(isExpanded));
  summaryBtn.setAttribute("aria-controls", detail.id);

  summaryBtn.addEventListener("click", () => {
    expandedId = expandedId === entry.id ? null : entry.id;
    renderList();
    Array.from(entriesList.querySelectorAll(".dowe-entry-summary"))
      .find((button) => button.getAttribute("aria-controls") === detail.id)
      ?.focus();
  });

  starBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await updateEntry(entry.id, { starred: !entry.starred });
      await reloadEntries();
    } catch { dictionaryStatus.textContent = t("errorUnknown"); }
  });

  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(t("dictionaryDeleteConfirm"))) return;
    const index = Array.from(entriesList.children).indexOf(node);
    try {
      await deleteEntry(entry.id);
      if (expandedId === entry.id) expandedId = null;
      rerunResults.delete(entry.id);
      await reloadEntries();
      const next = entriesList.children[Math.min(index, entriesList.children.length - 1)];
      (next?.querySelector(".dowe-entry-summary") || searchInput).focus({ preventScroll: true });
      dictionaryStatus.textContent = "Entry deleted.";
    } catch { dictionaryStatus.textContent = t("errorUnknown"); }
  });

  rerunBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (rerunResults.get(entry.id)?.pending) return;
    const previous = rerunResults.get(entry.id);
    rerunResults.set(entry.id, { ...previous, pending: true, message: t("dictionaryRerunning") });
    dictionaryStatus.textContent = t("dictionaryRerunning");
    renderList();
    try {
      const response = await chrome.runtime.sendMessage({
        type: "LOOKUP",
        requestId: crypto.randomUUID(),
        text: entry.term,
        mode: entry.mode,
        level: entry.level,
        contextSentence: entry.contextSentence,
        url: entry.sourceUrl,
        title: entry.sourceTitle,
        skipGlossary: false,
      });
      if (response?.status !== "success") {
        rerunResults.set(entry.id, { ...previous, message: response?.message || t("errorUnknown"), code: response?.code });
      } else {
        rerunResults.set(entry.id, {
          answer: response.answer,
          message: t(response.fromGlossary ? "dictionaryRerunGlossary" : response.entryId ? "dictionaryRerunSaved" : "dictionaryRerunUnsaved"),
        });
      }
    } catch {
      rerunResults.set(entry.id, { ...previous, message: t("errorNetwork") });
    } finally {
      // A filtered or collapsed row must not be reopened by a late response.
      dictionaryStatus.textContent = rerunResults.get(entry.id)?.message || "";
      await reloadEntries();
    }
  });

  return node;
}

async function reloadEntries() {
  allEntries = await getAllEntries();
  renderList();
  if (!document.getElementById("panel-dashboard").hidden) {
    renderDashboard(dashboardRoot, allEntries);
  }
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function initTabs() {
  const tabList = document.getElementById("tab-list");
  const tabDashboard = document.getElementById("tab-dashboard");
  const panelList = document.getElementById("panel-list");
  const panelDashboard = document.getElementById("panel-dashboard");

  function activate(tab) {
    const isList = tab === "list";
    tabList.classList.toggle("dowe-tab-active", isList);
    tabDashboard.classList.toggle("dowe-tab-active", !isList);
    tabList.setAttribute("aria-selected", String(isList));
    tabDashboard.setAttribute("aria-selected", String(!isList));
    tabList.tabIndex = isList ? 0 : -1;
    tabDashboard.tabIndex = isList ? -1 : 0;
    panelList.hidden = !isList;
    panelDashboard.hidden = isList;
    if (!isList) renderDashboard(dashboardRoot, allEntries);
  }

  tabList.addEventListener("click", () => activate("list"));
  tabDashboard.addEventListener("click", () => activate("dashboard"));
  tabDashboard.tabIndex = -1;
  for (const tab of [tabList, tabDashboard]) {
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const showList =
        event.key === "Home" || (event.key !== "End" && tab === tabDashboard);
      activate(showList ? "list" : "dashboard");
      (showList ? tabList : tabDashboard).focus();
    });
  }
}

function initControls() {
  clearFiltersBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchQuery = "";
    filterMode = "all";
    renderModeChips();
    renderList();
    searchInput.focus();
  });
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim();
    renderList();
  });

  sortSelect.addEventListener("change", () => {
    sortMode = sortSelect.value;
    renderList();
  });

  document
    .getElementById("open-full-view-btn")
    .addEventListener("click", () => {
      chrome.tabs.create({
        url: chrome.runtime.getURL("src/dictionary/dictionary.html"),
      });
    });

  document.getElementById("open-settings-btn").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  document
    .getElementById("export-glossary-btn")
    .addEventListener("click", () => {
      const subset = getFilteredSortedEntries();
      const glossary = subset.map((e) => ({
        term: e.term,
        definition: e.answer,
        mode: e.mode,
        level: e.level,
        note: e.contextSentence || undefined,
        addedAt: e.createdAt,
      }));
      downloadJson("dowe-glossary.json", glossary);
    });

  document
    .getElementById("clear-all-btn")
    .addEventListener("click", async () => {
      if (!confirm("Delete all dictionary entries? This cannot be undone."))
        return;
      await clearEntries();
      expandedId = null;
      await reloadEntries();
    });
}

async function applyTheme() {
  const settings = await getSettings();
  if (settings.theme === "light" || settings.theme === "dark") {
    document.documentElement.setAttribute("data-theme", settings.theme);
  }
}

async function initUpdateNotice() {
  const notice = await getUpdateNotice();
  if (!notice) return;

  const container = document.getElementById("update-notice");
  document.getElementById("update-notice-title").textContent =
    `Dowe ${notice.version} is ready`;
  container.hidden = false;
  chrome.action.setBadgeText({ text: "" }).catch(() => {});

  document
    .getElementById("open-release-btn")
    .addEventListener("click", async () => {
      await clearUpdateNotice();
      container.hidden = true;
      chrome.tabs.create({ url: notice.releaseUrl });
    });

  document
    .getElementById("dismiss-update-btn")
    .addEventListener("click", async () => {
      await clearUpdateNotice();
      container.hidden = true;
    });
}

async function init() {
  await applyTheme();
  await initUpdateNotice();
  renderModeChips();
  initTabs();
  initControls();
  await reloadEntries();
}

init();
