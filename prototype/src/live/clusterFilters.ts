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
  sources: ["cluster", "rbl"],
  worked: ["Worked before", "Not worked"],
};

export const defaultClusterFilter = (): ClusterFilter => ({ query: "", bands: [], modes: [], continents: [], spotterContinents: [], callStatuses: [], dxccStatuses: [],
  specials: [], excludedSpecials: [], sources: ["cluster", "rbl"], worked: [], sort: "newest" });

export type SpecialFilterState = "neutral" | "include" | "exclude";

export function setSpecialFilterState(filter: ClusterFilter, option: string, state: SpecialFilterState): ClusterFilter {
  const specials = filter.specials.filter(value => value !== option);
  const excludedSpecials = (filter.excludedSpecials ?? []).filter(value => value !== option);
  if (state === "include") specials.push(option);
  if (state === "exclude") excludedSpecials.push(option);
  return { ...filter, specials, excludedSpecials };
}
