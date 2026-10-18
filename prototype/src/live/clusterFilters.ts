export type ClusterFilter = { query: string; bands: string[]; modes: string[]; continents: string[];
  callStatuses: string[]; dxccStatuses: string[]; specials: string[];
  sources: string[]; worked: string[]; sort: string };

export const clusterFilterChoices = {
  bands: ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"],
  modes: ["CW", "SSB", "FT8", "FT4", "FT2", "RTTY", "JTTY", "PSK", "DIGI", "AM", "FM"],
  continents: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"],
  callStatuses: ["New Call", "New Band", "New Mode", "New Band+Mode", "Worked", "Confirmed", "Unknown"],
  dxccStatuses: ["ATNO", "C/New Band", "C/New Mode", "C/New Band+Mode", "W/New Band", "W/New Mode", "W/New Band+Mode", "Worked", "Confirmed", "Unknown"],
  sources: ["cluster", "rbl"],
  worked: ["Worked before", "Not worked"],
};

export const defaultClusterFilter = (): ClusterFilter => ({ query: "", bands: [], modes: [], continents: [], callStatuses: [], dxccStatuses: [],
  specials: [], sources: ["cluster", "rbl"], worked: [], sort: "newest" });
