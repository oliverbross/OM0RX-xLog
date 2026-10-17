const PARTICLES = new Set(["and", "d", "de", "del", "der", "di", "du", "la", "le", "of", "the", "van", "von"]);
const ABBREVIATIONS: Record<string, string> = { usa: "USA", uk: "UK", uae: "UAE", us: "US" };

/** Display-only title casing for country/entity labels. Never use for matching or persistence. */
export function countryDisplay(value: unknown): string {
  if (typeof value !== "string") return "";
  const source = value.trim();
  if (!source) return "";
  let firstWord = true;
  return source.replace(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu, (word) => {
    const lower = word.toLocaleLowerCase();
    const abbreviation = ABBREVIATIONS[lower];
    if (abbreviation) { firstWord = false; return abbreviation; }
    const parts = word.split(/([’'])/);
    const formatted = parts.map((part, index) => {
      if (part === "'" || part === "’") return part;
      const normalized = part.toLocaleLowerCase();
      const isInitial = firstWord && index === 0;
      const result = !isInitial && PARTICLES.has(normalized)
        ? normalized
        : normalized.charAt(0).toLocaleUpperCase() + normalized.slice(1);
      if (part) firstWord = false;
      return result;
    }).join("");
    return formatted;
  });
}
