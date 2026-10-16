export type SavedLogbookFilter = { name: string; query: string };
export type SavedLogbookFilterSnapshot = {
  filters: SavedLogbookFilter[];
  revision: number;
  generation: string;
};

const controlCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const bytes = (value: string) => new TextEncoder().encode(value).length;

export function validateSavedLogbookFilterName(value: string) {
  if (value !== value.trim() || Array.from(value).length < 1 || Array.from(value).length > 48 ||
      bytes(value) > 128 || controlCharacters.test(value))
    throw new Error("Filter name must be 1–48 characters without leading, trailing or control whitespace.");
  return value;
}

export function validateSavedLogbookFilterQuery(value: string) {
  if (value !== value.trim() || Array.from(value).length < 1 || Array.from(value).length > 128 ||
      bytes(value) > 512 || controlCharacters.test(value))
    throw new Error("Save a non-empty Logbook search of at most 128 characters.");
  return value;
}

export const savedLogbookFilterKey = (value: string) => value.toLowerCase();

export function duplicateSavedLogbookFilter(filters: SavedLogbookFilter[], name: string, except?: string) {
  const key = savedLogbookFilterKey(name), excluded = except ? savedLogbookFilterKey(except) : "";
  return filters.some(filter => savedLogbookFilterKey(filter.name) === key && savedLogbookFilterKey(filter.name) !== excluded);
}

export function parseSavedLogbookFilterSnapshot(value: unknown): SavedLogbookFilterSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Saved Logbook filters are unavailable.");
  const raw = value as Record<string, unknown>, preferences = raw.preferences;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences) ||
      !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 0 ||
      typeof raw.generation !== "string" || !raw.generation || raw.generation.length > 64)
    throw new Error("Saved Logbook filters are unavailable.");
  const filters = (preferences as Record<string, unknown>).savedLogbookFilters;
  if (!Array.isArray(filters) || filters.length > 32) throw new Error("Saved Logbook filters are unavailable.");
  const parsed: SavedLogbookFilter[] = [], names = new Set<string>();
  for (const item of filters) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Saved Logbook filters are unavailable.");
    const { name, query } = item as Record<string, unknown>;
    if (typeof name !== "string" || typeof query !== "string") throw new Error("Saved Logbook filters are unavailable.");
    validateSavedLogbookFilterName(name); validateSavedLogbookFilterQuery(query);
    if (!names.add(savedLogbookFilterKey(name))) throw new Error("Saved Logbook filters are unavailable.");
    parsed.push({ name, query });
  }
  return { filters: parsed, revision: raw.revision as number, generation: raw.generation };
}
