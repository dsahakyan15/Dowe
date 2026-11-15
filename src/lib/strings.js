// Single source of truth for all Dowe interface strings (not AI answers).
// Keeping every UI string here means the extension's own interface can be
// localized later without touching component logic.

export const STRINGS = {
  appName: "Dowe",
  slogan: "Dowe — understanding, delivered instantly.",

  // Popup states
  loading: "Asking Dowe…",
  fromGlossary: "From team glossary",
  askAiAnyway: "Ask AI anyway",
  copy: "Copy",
  copied: "Copied",
  regenerate: "Regenerate",
  save: "Save",
  saved: "Saved",
  openSettings: "Open settings",
  retry: "Retry",
  close: "Close",
  more: "More",
  openDictionary: "Open dictionary",
  copyFailed: "Couldn't copy. Select the answer to copy it manually.",

  // Errors
  errorNoApiKey: "Add an API key to start using Dowe.",
  errorInvalidKey: "Your API key looks invalid or expired.",
  errorRateLimited:
    "You've hit your provider's rate limit — try again shortly.",
  errorNetwork: "Couldn't reach the AI provider. Check your connection.",
  errorSelectionTooLong: "That selection's a bit long — try a shorter passage.",
  errorCustomEndpoint:
    "Couldn't reach your custom endpoint — check the URL in settings.",
  errorUnknown: "Something went wrong. Try again.",

  // Modes
  modeDefine: "Define",
  modeTranslate: "Translate",
  modeSimplify: "Simplify",
  modeGrammar: "Grammar",

  // Levels
  levelSimple: "Simple",
  levelTechnical: "Technical",

  // Onboarding
  onboardingWelcomeTitle: "Welcome to Dowe",
  onboardingWelcomeBody:
    "Select any text on a webpage and Dowe gives you an instant AI-powered definition, translation, simplification, or grammar breakdown.",
  onboardingStep1: "Choose your AI provider",
  onboardingStep2: "Paste your API key",
  onboardingStep3: "Preferences (optional)",
  onboardingTestConnection: "Test connection",
  onboardingTestSuccess: "Connection works.",
  onboardingTestFailed: "Couldn't connect — check your key and try again.",
  onboardingSkipWarning: "Lookups won't work until you add a valid API key.",
  onboardingFinish: "Finish setup",
  onboardingSkip: "Skip for now",
  onboardingHint: "Try selecting some text on this page.",

  // Dictionary
  dictionaryTitle: "Dictionary",
  dictionarySearchPlaceholder: "Search terms…",
  dictionaryEmpty:
    "No lookups saved yet. Select text on any page to get started.",
  dictionaryClearAll: "Clear all",
  dictionaryExport: "Export as team glossary",
  dictionaryStar: "Star",
  dictionaryUnstar: "Unstar",
  dictionaryDelete: "Delete",
  dictionaryRerun: "Re-run",

  // Dashboard
  dashboardTitle: "Frequency",
  dashboardShowMore: "Show more",
  dashboardShowLess: "Show less",

  // Settings
  settingsTitle: "Settings",
  settingsProvider: "AI provider",
  settingsApiKey: "API key",
  settingsModel: "Model",
  settingsCustomEndpoint: "Custom endpoint URL",
  settingsTargetLanguage: "Target language",
  settingsDefaultMode: "Default mode",
  settingsDefaultLevel: "Default level",
  settingsIncludeContext: "Include surrounding sentence as context",
  settingsAutoSave: "Auto-save lookups to dictionary",
  settingsTheme: "Theme",
  settingsShortcut: "Keyboard shortcut",
  settingsChangeShortcut: "Change shortcut",
  settingsShortcutNote:
    "Chrome doesn't let extensions rebind shortcuts from their own settings page — this opens Chrome's shortcut manager.",
  settingsDisabledSites: "Disabled sites",
  settingsTeamGlossaryImport: "Import team glossary",
  settingsSaved: "Settings saved",
};

export function t(key, vars) {
  let str = STRINGS[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{${k}}`, String(v));
    }
  }
  return str;
}
