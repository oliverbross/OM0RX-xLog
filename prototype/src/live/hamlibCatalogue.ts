export type HamlibModel = { id: number; manufacturer: string; model: string; maturity: string; backend_version?: string; search: string };
export function normalizeHamlibModels(value: unknown): HamlibModel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  return value.flatMap(row => {
    if (!row || typeof row !== "object" || !Number.isSafeInteger(row.id) || row.id < 1 || seen.has(row.id) ||
      typeof row.manufacturer !== "string" || !row.manufacturer.trim() || typeof row.model !== "string" || !row.model.trim()) return [];
    seen.add(row.id);
    const manufacturer = row.manufacturer.trim(), model = row.model.trim(), maturity = typeof row.maturity === "string" ? row.maturity : "Not reported";
    return [{ id: row.id, manufacturer, model, maturity, backend_version: typeof row.backend_version === "string" ? row.backend_version : undefined,
      search: `${manufacturer} ${model} ${row.id} ${maturity}`.toLowerCase() }];
  }).sort((a, b) => a.manufacturer.localeCompare(b.manufacturer, undefined, { sensitivity: "base" }) || a.model.localeCompare(b.model, undefined, { numeric: true }) || a.id - b.id);
}
export function hamlibManufacturers(models: HamlibModel[]) {
  const groups = new Map<string, { key: string; name: string; count: number }>();
  for (const model of models) {
    const key = model.manufacturer.toLowerCase(), prior = groups.get(key);
    if (prior) prior.count++; else groups.set(key, { key, name: model.manufacturer, count: 1 });
  }
  return [...groups.values()];
}
// Cache only the bundled, read-only catalogue, never device state or capabilities.
const catalogues = new WeakMap<object, Map<string, Promise<HamlibModel[]>>>();
export function loadHamlibCatalogue(request: (method: string, params: Record<string, unknown>) => Promise<any>, device: "radio" | "rotor", retry = false) {
  let cache = catalogues.get(request); if (!cache) { cache = new Map(); catalogues.set(request, cache); }
  if (retry) cache.delete(device);
  let promise = cache.get(device);
  if (!promise) {
    promise = request("hamlib_models", { device }).then(result => normalizeHamlibModels(result?.models));
    cache.set(device, promise);
    const attempted = promise;
    void promise.catch(() => { if (cache?.get(device) === attempted) cache.delete(device); });
  }
  return promise;
}
