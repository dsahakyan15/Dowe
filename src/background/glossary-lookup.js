import { getTeamGlossary } from "../lib/storage.js";

// Case-insensitive exact match on trimmed selected text.
// TODO: fuzzy match (Levenshtein distance <= 1 for short terms) — exact-match only for MVP.
export async function findGlossaryMatch(text) {
  const needle = (text || "").trim().toLowerCase();
  if (!needle) return null;
  const glossary = await getTeamGlossary();
  return glossary.find((entry) => entry.term.trim().toLowerCase() === needle) || null;
}
