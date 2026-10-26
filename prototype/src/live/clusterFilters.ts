export type ClusterFilter = { query: string; bands: string[]; modes: string[]; continents: string[]; spotterContinents: string[];
  callStatuses: string[]; dxccStatuses: string[]; specials: string[]; excludedSpecials?: string[];
  sources: string[]; worked: string[]; sort: string };

export const clusterFilterChoices = {
  bands: ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"],
  modes: ["CW", "SSB", "FT8", "FT4", "FT2", "RTTY", "JTTY", "PSK", "DIGI", "AM", "FM"],
  continents: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"],
  spotterContinents: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"],
  callStatuses: ["New Call", "New Band", "New Mode", "New Band+Mode", "Worked", "Confirmed", "Unknown"],
  dxccStatuses: ["ATNO", "C/New Band", "C/New Mode", "C/New Band+Mode", "W/New Band", "W/New Mode", "W/New Band+Mode", "Worked", "Confirmed", "Unknown"],
  sources: ["cluster", "rbl", "local_cw"],
  worked: ["Worked before", "Not worked"],
};

export const defaultClusterFilter = (): ClusterFilter => ({ query: "", bands: [], modes: [], continents: [], spotterContinents: [], callStatuses: [], dxccStatuses: [],
  specials: [], excludedSpecials: [], sources: ["cluster", "rbl", "local_cw"], worked: [], sort: "newest" });

export function normalizeClusterFilter(value?: Partial<ClusterFilter> | null): ClusterFilter {
  const defaults = defaultClusterFilter();
  const list = <K extends keyof ClusterFilter>(key: K): string[] => Array.isArray(value?.[key]) ? [...value[key] as string[]] : [...defaults[key] as string[]];
  return {
    query: typeof value?.query === "string" ? value.query : defaults.query,
    bands: list("bands"), modes: list("modes"), continents: list("continents"), spotterContinents: list("spotterContinents"),
    // Retire the old "Show only" whitelist when reading saved or detached state.
    callStatuses: list("callStatuses"), dxccStatuses: list("dxccStatuses"), specials: [],
    excludedSpecials: list("excludedSpecials"), sources: list("sources"), worked: list("worked"),
    sort: typeof value?.sort === "string" ? value.sort : defaults.sort,
  };
}

export function setSpecialShown(filter: ClusterFilter, option: string, shown: boolean): ClusterFilter {
  const excludedSpecials = (filter.excludedSpecials ?? []).filter(value => value !== option);
  if (!shown) excludedSpecials.push(option);
  return { ...filter, specials: [], excludedSpecials };
}

export type ClusterFilterSpot = {
  callsign: string; country: string; comment: string; band: string; mode: string; continent: string;
  spotterContinent?: string | null; callStatus: string; dxccStatus: string; specialTags: string[];
  source: string; workedBefore?: number | null; receivedAt: number; score: number; frequencyKHz: number;
};

export function filterClusterSpots<T extends ClusterFilterSpot>(spots: readonly T[], filter: ClusterFilter): T[] {
  const query = filter.query.toLocaleLowerCase();
  const visible = spots.filter(spot => {
    const rbn = ["rbl", "rbn"].includes(spot.source.trim().toLocaleLowerCase());
    const source = rbn ? "rbl" : spot.source.trim().toLocaleLowerCase() === "local_cw" ? "local_cw" : "cluster";
    const specialTags = rbn ? [...spot.specialTags, "RBN"] : spot.specialTags;
    return (!query || [spot.callsign, spot.country, spot.comment].some(value => value.toLocaleLowerCase().includes(query))) &&
      (!filter.bands.length || filter.bands.includes(spot.band)) &&
      (!filter.modes.length || filter.modes.includes(spot.mode)) &&
      (!filter.continents.length || filter.continents.includes(spot.continent)) &&
      (!filter.spotterContinents.length || filter.spotterContinents.includes(spot.spotterContinent ?? "")) &&
      (!filter.callStatuses.length || filter.callStatuses.includes(spot.callStatus)) &&
      (!filter.dxccStatuses.length || filter.dxccStatuses.includes(spot.dxccStatus)) &&
      !(filter.excludedSpecials ?? []).some(value => specialTags.includes(value)) &&
      filter.sources.includes(source) &&
      (!filter.worked.length || filter.worked.includes(spot.workedBefore == null ? "Not worked" : "Worked before"));
  });
  return visible.sort((left, right) => filter.sort === "score" ? right.score - left.score || right.receivedAt - left.receivedAt
    : filter.sort === "frequency" ? left.frequencyKHz - right.frequencyKHz
    : filter.sort === "callsign" ? left.callsign.localeCompare(right.callsign)
    : right.receivedAt - left.receivedAt);
}
