// Thin storage adapter. Callers never touch chrome.storage / IndexedDB
// directly — if the backing store changes later, only this file changes.
//
// - Settings + team glossary: chrome.storage.local (small, simple objects).
// - Dictionary entries: IndexedDB (expected to grow large with heavy use).

const DB_NAME = "dowe";
const DB_VERSION = 1;
const ENTRIES_STORE = "entries";

const SETTINGS_KEY = "settings";
const TEAM_GLOSSARY_KEY = "teamGlossary";
const UPDATE_NOTICE_KEY = "updateNotice";

export const DEFAULT_SETTINGS = {
  provider: "anthropic",
  apiKey: "",
  model: "",
  customEndpoint: "",
  targetLanguage: "en",
  defaultMode: "define",
  defaultLevel: "simple",
  includeContext: true,
  autoSaveToDictionary: true,
  theme: "auto",
  disabledSites: [],
  onboardingComplete: false,
};

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
        const store = db.createObjectStore(ENTRIES_STORE, { keyPath: "id" });
        store.createIndex("normalizedTerm", "normalizedTerm", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function withStore(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(ENTRIES_STORE, mode);
        const store = tx.objectStore(ENTRIES_STORE);
        const result = fn(store);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------- Settings ----------

export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

// ---------- Update notice ----------

export async function getUpdateNotice() {
  const stored = await chrome.storage.local.get(UPDATE_NOTICE_KEY);
  return stored[UPDATE_NOTICE_KEY] || null;
}

export async function setUpdateNotice(notice) {
  await chrome.storage.local.set({ [UPDATE_NOTICE_KEY]: notice });
  return notice;
}

export async function clearUpdateNotice() {
  await chrome.storage.local.remove(UPDATE_NOTICE_KEY);
}

// ---------- Dictionary entries (IndexedDB) ----------

export async function addEntry(entry) {
  await withStore("readwrite", (store) => store.put(entry));
  return entry;
}

export async function updateEntry(id, patch) {
  return withStore("readwrite", async (store) => {
    const existing = await requestToPromise(store.get(id));
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    store.put(updated);
    return updated;
  }).then((result) => result);
}

export async function deleteEntry(id) {
  await withStore("readwrite", (store) => store.delete(id));
}

export async function clearEntries() {
  await withStore("readwrite", (store) => store.clear());
}

export async function getAllEntries() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRIES_STORE, "readonly");
    const store = tx.objectStore(ENTRIES_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = req.result || [];
      rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

// ---------- Team glossary (chrome.storage.local) ----------

export async function getTeamGlossary() {
  const stored = await chrome.storage.local.get(TEAM_GLOSSARY_KEY);
  return stored[TEAM_GLOSSARY_KEY] || [];
}

export async function setTeamGlossary(entries) {
  await chrome.storage.local.set({ [TEAM_GLOSSARY_KEY]: entries });
  return entries;
}

export async function mergeTeamGlossary(newEntries) {
  const existing = await getTeamGlossary();
  const byTerm = new Map(existing.map((e) => [e.term.trim().toLowerCase(), e]));
  for (const entry of newEntries) {
    if (!entry || typeof entry.term !== "string") continue;
    byTerm.set(entry.term.trim().toLowerCase(), entry);
  }
  const merged = Array.from(byTerm.values());
  await setTeamGlossary(merged);
  return merged;
}
