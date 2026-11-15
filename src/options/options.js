import { getSettings, setSettings, mergeTeamGlossary } from "../lib/storage.js";
import { t } from "../lib/strings.js";

const PROVIDER_INFO = {
  anthropic: { label: "Anthropic (Claude)", keyUrl: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys" },
  gemini: { label: "Google Gemini", keyUrl: "https://aistudio.google.com/app/apikey" },
  custom: { label: "Custom endpoint", keyUrl: null },
};

const LANGUAGES = [
  ["en", "English"],
  ["ru", "Russian"],
  ["hy", "Armenian"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["zh", "Chinese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["ar", "Arabic"],
];

const MODES = ["define", "translate", "simplify", "grammar"];
const LEVELS = ["simple", "technical"];

function populateOptions(selectEl, items) {
  selectEl.innerHTML = "";
  for (const [value, label] of items) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    selectEl.appendChild(opt);
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") {
    root.setAttribute("data-theme", theme);
  } else {
    root.removeAttribute("data-theme");
  }
}

async function ensureHostPermission(url) {
  try {
    const origin = new URL(url).origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    return granted;
  } catch {
    return false;
  }
}

function toggleCustomEndpointField(fieldEl, provider) {
  fieldEl.hidden = provider !== "custom";
}

async function testConnection({ provider, apiKey, model, customEndpoint }) {
  if (provider === "custom" && customEndpoint) {
    const granted = await ensureHostPermission(customEndpoint);
    if (!granted) return { ok: false, message: "Permission to access that endpoint was denied." };
  }
  return chrome.runtime.sendMessage({ type: "TEST_CONNECTION", provider, apiKey, model, customEndpoint });
}

// ---------------- Onboarding ----------------

function initOnboardingStrings() {
  document.getElementById("onboarding-welcome-title").textContent = t("onboardingWelcomeTitle");
  document.getElementById("onboarding-welcome-body").textContent = t("onboardingWelcomeBody");
  document.getElementById("onboarding-step1-label").textContent = t("onboardingStep1");
  document.getElementById("onboarding-step2-label").textContent = t("onboardingStep2");
  document.getElementById("ob-test-btn").textContent = t("onboardingTestConnection");
  document.getElementById("ob-skip-btn").textContent = t("onboardingSkip");
  document.getElementById("ob-finish-btn").textContent = t("onboardingFinish");
  document.getElementById("ob-skip-warning").textContent = t("onboardingSkipWarning");
  document.getElementById("ob-skip-warning").hidden = false;
  document.getElementById("ob-hint").textContent = t("onboardingHint");
}

async function showOnboarding(settings) {
  initOnboardingStrings();

  const providerSelect = document.getElementById("ob-provider");
  const apiKeyInput = document.getElementById("ob-api-key");
  const endpointField = document.getElementById("ob-endpoint-field");
  const endpointInput = document.getElementById("ob-custom-endpoint");
  const keyLink = document.getElementById("ob-key-link");
  const testBtn = document.getElementById("ob-test-btn");
  const testStatus = document.getElementById("ob-test-status");
  const finishBtn = document.getElementById("ob-finish-btn");
  const skipBtn = document.getElementById("ob-skip-btn");
  const targetLangSelect = document.getElementById("ob-target-language");
  const defaultModeSelect = document.getElementById("ob-default-mode");
  const defaultLevelSelect = document.getElementById("ob-default-level");
  const shortcutDisplay = document.getElementById("ob-shortcut-display");
  const hint = document.getElementById("ob-hint");

  populateOptions(targetLangSelect, LANGUAGES);
  populateOptions(defaultModeSelect, MODES.map((m) => [m, t(`mode${capitalize(m)}`)]));
  populateOptions(defaultLevelSelect, LEVELS.map((l) => [l, t(`level${capitalize(l)}`)]));

  providerSelect.value = settings.provider;
  targetLangSelect.value = settings.targetLanguage;
  defaultModeSelect.value = settings.defaultMode;
  defaultLevelSelect.value = settings.defaultLevel;

  toggleCustomEndpointField(endpointField, providerSelect.value);
  updateKeyLink();

  const commands = await chrome.commands.getAll();
  const lookupCmd = commands.find((c) => c.name === "trigger-lookup");
  shortcutDisplay.textContent = lookupCmd?.shortcut || "Alt+E";

  function updateKeyLink() {
    const info = PROVIDER_INFO[providerSelect.value];
    if (info.keyUrl) {
      keyLink.hidden = false;
      keyLink.href = info.keyUrl;
    } else {
      keyLink.hidden = true;
    }
  }

  providerSelect.addEventListener("change", () => {
    toggleCustomEndpointField(endpointField, providerSelect.value);
    updateKeyLink();
    finishBtn.disabled = true;
    testStatus.textContent = "";
  });

  testBtn.addEventListener("click", async () => {
    testStatus.textContent = "…";
    testStatus.className = "dowe-small";
    const result = await testConnection({
      provider: providerSelect.value,
      apiKey: apiKeyInput.value.trim(),
      model: "",
      customEndpoint: endpointInput.value.trim(),
    });
    if (result?.ok) {
      testStatus.textContent = result.model
        ? `${t("onboardingTestSuccess")} (${result.model})`
        : t("onboardingTestSuccess");
      testStatus.className = "dowe-small dowe-test-ok";
      finishBtn.disabled = false;
    } else {
      testStatus.textContent = result?.message || t("onboardingTestFailed");
      testStatus.className = "dowe-small dowe-test-fail";
      finishBtn.disabled = true;
    }
  });

  async function finishOnboarding() {
    await setSettings({
      provider: providerSelect.value,
      apiKey: apiKeyInput.value.trim(),
      customEndpoint: endpointInput.value.trim(),
      targetLanguage: targetLangSelect.value,
      defaultMode: defaultModeSelect.value,
      defaultLevel: defaultLevelSelect.value,
      onboardingComplete: true,
    });
    document.getElementById("onboarding").hidden = true;
    hint.hidden = false;
    setTimeout(async () => {
      hint.hidden = true;
      const fresh = await getSettings();
      await showSettingsView(fresh);
    }, 2500);
  }

  finishBtn.addEventListener("click", finishOnboarding);
  skipBtn.addEventListener("click", finishOnboarding);

  document.getElementById("onboarding").hidden = false;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------- Settings view ----------------

function renderDisabledSites(list, sites, onRemove) {
  list.innerHTML = "";
  for (const site of sites) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = site;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Remove ${site}`);
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => onRemove(site));
    li.appendChild(span);
    li.appendChild(removeBtn);
    list.appendChild(li);
  }
}

async function showSettingsView(settings) {
  document.getElementById("settings").hidden = false;
  document.getElementById("onboarding").hidden = true;

  const providerSelect = document.getElementById("set-provider");
  const apiKeyInput = document.getElementById("set-api-key");
  const modelInput = document.getElementById("set-model");
  const endpointField = document.getElementById("set-endpoint-field");
  const endpointInput = document.getElementById("set-custom-endpoint");
  const testBtn = document.getElementById("set-test-btn");
  const testStatus = document.getElementById("set-test-status");
  const targetLangSelect = document.getElementById("set-target-language");
  const defaultModeSelect = document.getElementById("set-default-mode");
  const defaultLevelSelect = document.getElementById("set-default-level");
  const includeContextCheckbox = document.getElementById("set-include-context");
  const autoSaveCheckbox = document.getElementById("set-auto-save");
  const themeSelect = document.getElementById("set-theme");
  const shortcutDisplay = document.getElementById("set-shortcut-display");
  const changeShortcutBtn = document.getElementById("set-change-shortcut-btn");
  const disabledSiteInput = document.getElementById("set-disabled-site-input");
  const addDisabledSiteBtn = document.getElementById("set-add-disabled-site-btn");
  const disabledSitesList = document.getElementById("set-disabled-sites-list");
  const glossaryFileInput = document.getElementById("set-glossary-file");
  const importGlossaryBtn = document.getElementById("set-import-glossary-btn");
  const glossaryStatus = document.getElementById("set-glossary-status");
  const savedToast = document.getElementById("set-saved-toast");

  populateOptions(targetLangSelect, LANGUAGES);
  populateOptions(defaultModeSelect, MODES.map((m) => [m, t(`mode${capitalize(m)}`)]));
  populateOptions(defaultLevelSelect, LEVELS.map((l) => [l, t(`level${capitalize(l)}`)]));

  providerSelect.value = settings.provider;
  apiKeyInput.value = settings.apiKey || "";
  modelInput.value = settings.model || "";
  endpointInput.value = settings.customEndpoint || "";
  targetLangSelect.value = settings.targetLanguage;
  defaultModeSelect.value = settings.defaultMode;
  defaultLevelSelect.value = settings.defaultLevel;
  includeContextCheckbox.checked = !!settings.includeContext;
  autoSaveCheckbox.checked = !!settings.autoSaveToDictionary;
  themeSelect.value = settings.theme;
  toggleCustomEndpointField(endpointField, settings.provider);
  applyTheme(settings.theme);

  savedToast.textContent = t("settingsSaved");

  let disabledSites = [...(settings.disabledSites || [])];

  const commands = await chrome.commands.getAll();
  const lookupCmd = commands.find((c) => c.name === "trigger-lookup");
  shortcutDisplay.textContent = lookupCmd?.shortcut || "Not set";

  let toastTimer = null;
  async function persist(patch) {
    await setSettings(patch);
    savedToast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (savedToast.hidden = true), 1800);
  }

  providerSelect.addEventListener("change", () => {
    toggleCustomEndpointField(endpointField, providerSelect.value);
    persist({ provider: providerSelect.value });
  });
  apiKeyInput.addEventListener("change", () => persist({ apiKey: apiKeyInput.value.trim() }));
  modelInput.addEventListener("change", () => persist({ model: modelInput.value.trim() }));
  endpointInput.addEventListener("change", async () => {
    const url = endpointInput.value.trim();
    if (url) await ensureHostPermission(url);
    persist({ customEndpoint: url });
  });
  targetLangSelect.addEventListener("change", () => persist({ targetLanguage: targetLangSelect.value }));
  defaultModeSelect.addEventListener("change", () => persist({ defaultMode: defaultModeSelect.value }));
  defaultLevelSelect.addEventListener("change", () => persist({ defaultLevel: defaultLevelSelect.value }));
  includeContextCheckbox.addEventListener("change", () =>
    persist({ includeContext: includeContextCheckbox.checked })
  );
  autoSaveCheckbox.addEventListener("change", () => persist({ autoSaveToDictionary: autoSaveCheckbox.checked }));
  themeSelect.addEventListener("change", () => {
    applyTheme(themeSelect.value);
    persist({ theme: themeSelect.value });
  });

  changeShortcutBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });

  testBtn.addEventListener("click", async () => {
    testStatus.textContent = "…";
    testStatus.className = "dowe-small";
    const result = await testConnection({
      provider: providerSelect.value,
      apiKey: apiKeyInput.value.trim(),
      model: modelInput.value.trim(),
      customEndpoint: endpointInput.value.trim(),
    });
    if (result?.ok) {
      testStatus.textContent = result.model
        ? `${t("onboardingTestSuccess")} (${result.model})`
        : t("onboardingTestSuccess");
      testStatus.className = "dowe-small dowe-test-ok";
      if (!modelInput.value.trim() && result.model) {
        modelInput.value = result.model;
        await persist({ model: result.model });
      }
    } else {
      testStatus.textContent = result?.message || t("onboardingTestFailed");
      testStatus.className = "dowe-small dowe-test-fail";
    }
  });

  addDisabledSiteBtn.addEventListener("click", async () => {
    const raw = disabledSiteInput.value.trim().toLowerCase();
    if (!raw) return;
    const site = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!disabledSites.includes(site)) {
      disabledSites.push(site);
      await persist({ disabledSites });
      renderDisabledSites(disabledSitesList, disabledSites, removeDisabledSite);
    }
    disabledSiteInput.value = "";
  });

  async function removeDisabledSite(site) {
    disabledSites = disabledSites.filter((s) => s !== site);
    await persist({ disabledSites });
    renderDisabledSites(disabledSitesList, disabledSites, removeDisabledSite);
  }
  renderDisabledSites(disabledSitesList, disabledSites, removeDisabledSite);

  importGlossaryBtn.addEventListener("click", async () => {
    const file = glossaryFileInput.files?.[0];
    if (!file) {
      glossaryStatus.textContent = "Choose a dowe-glossary.json file first.";
      glossaryStatus.className = "dowe-small dowe-test-fail";
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const entries = Array.isArray(parsed) ? parsed : parsed.entries;
      if (!Array.isArray(entries)) throw new Error("Invalid glossary file format.");
      const merged = await mergeTeamGlossary(entries);
      glossaryStatus.textContent = `Imported. Team glossary now has ${merged.length} term(s).`;
      glossaryStatus.className = "dowe-small dowe-test-ok";
    } catch (err) {
      glossaryStatus.textContent = "Couldn't import that file — check it's a valid Dowe glossary export.";
      glossaryStatus.className = "dowe-small dowe-test-fail";
    }
  });
}

// ---------------- Init ----------------

async function init() {
  const settings = await getSettings();
  applyTheme(settings.theme);

  if (!settings.onboardingComplete) {
    await showOnboarding(settings);
  } else {
    await showSettingsView(settings);
  }
}

init();
