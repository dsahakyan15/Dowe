// Builds the system/user prompt sent to the AI provider, per the templates
// in the product spec (§7). Kept separate from the provider adapters so the
// prompt shape can change without touching request/transport code.

const MODE_INSTRUCTIONS = {
  define:
    "Give a definition of the selected text. If it's a single word, define that word; if it's a phrase, define the phrase as used.",
  translate:
    "Translate the selected text into {targetLanguage}, preserving meaning and tone.",
  simplify: "Explain in plain language what the selected text means in this context.",
  grammar:
    "Give a short grammar breakdown: part of speech, and if applicable conjugation/declension form, plus its role in the surrounding sentence.",
};

const LEVEL_REGISTER = {
  simple: "plain, one or two sentences, no jargon",
  technical: "fuller and more technical, precise terminology is fine",
};

const LEVEL_WORD_CAP = {
  simple: "under 60 words",
  technical: "under 120 words",
};

// Mirrors the codes in src/options/options.js's LANGUAGES list. Spelling
// the language out (not just "hy") makes the target-language instruction
// unambiguous for the model instead of relying on it recognizing a bare
// ISO 639-1 code.
const LANGUAGE_NAMES = {
  en: "English",
  ru: "Russian",
  hy: "Armenian",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
};

function resolveLanguageLabel(code) {
  return LANGUAGE_NAMES[code] || code || "English";
}

export function buildPrompt({ mode, level, targetLanguage, selectedText, contextSentence }) {
  const register = LEVEL_REGISTER[level] || LEVEL_REGISTER.simple;
  const wordCap = LEVEL_WORD_CAP[level] || LEVEL_WORD_CAP.simple;
  const languageLabel = resolveLanguageLabel(targetLanguage);
  const instructionTemplate = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.define;
  const instruction = instructionTemplate.replaceAll("{targetLanguage}", languageLabel);

  const systemPrompt = [
    `You are Dowe, a fast, precise reading-assistant. Respond in ${languageLabel}.`,
    `Register: ${register}.`,
    `Keep responses ${wordCap} to keep the popup compact and API costs predictable.`,
  ].join(" ");

  const userPrompt = [
    `Task: ${instruction}`,
    "",
    `Selected text: "${selectedText}"`,
    `Surrounding sentence (context, may be partial): "${contextSentence || ""}"`,
    "",
    "Respond with only the answer text, no preamble, no restating the question.",
  ].join("\n");

  return { systemPrompt, userPrompt };
}
