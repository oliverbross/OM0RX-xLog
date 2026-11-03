import type { BandMapGuide, GuideRange } from "./bandMapGuides";
// Reduced visual segments transcribed from the separately reviewed official
// tables. No emergency frequencies, regulatory permissions or mode inference.
const color = { CW: "#12a88a", NB: "#8f79cf", All: "#338eb8", Beacon: "#d4a538" };
type Segment = [number, number, keyof typeof color, string?];
const ranges = (rows: Segment[]): GuideRange[] => rows.map(([a, b, kind, label]) => ({ startHz: Math.round(a * 1000), endHz: Math.round(b * 1000), color: color[kind], label: label ?? (kind === "NB" ? "Narrowband modes" : kind === "All" ? "All modes" : kind) }));
const common: Segment[] = [[5351.5,5354,"NB"],[5354,5366,"All"],[5366,5366.5,"NB"]];
const r1: Segment[] = [[1810,1838,"CW"],[1838,1840,"NB"],[1840,2000,"All"],[3500,3570,"CW"],[3570,3600,"NB"],[3600,3800,"All"],...common,[7000,7040,"CW"],[7040,7050,"NB"],[7050,7200,"All"],[10100,10130,"CW"],[10130,10150,"NB"],[14000,14070,"CW"],[14070,14099,"NB"],[14099,14101,"Beacon"],[14101,14350,"All"],[18068,18095,"CW"],[18095,18109,"NB"],[18109,18111,"Beacon"],[18111,18168,"All"],[21000,21070,"CW"],[21070,21110,"NB"],[21110,21120,"All"],[21120,21149,"NB"],[21149,21151,"Beacon"],[21151,21450,"All"],[24890,24915,"CW"],[24915,24929,"NB"],[24929,24931,"Beacon"],[24931,24990,"All"],[28000,28070,"CW"],[28070,28190,"NB"],[28190,28225,"Beacon"],[28225,29300,"All"],[29300,29510,"All"],[29520,29700,"All"]];
const r3: Segment[] = [
  [1800,1830,"CW"],[1830,1840,"NB"],[1840,2000,"All"],
  [3500,3535,"CW"],[3535,3900,"All","CW, phone, digital"],...common,
  [7000,7030,"CW"],[7030,7040,"All","CW, narrowband, phone"],[7040,7200,"All"],
  [10110,10130,"CW"],[10130,10150,"NB"],
  [14000,14070,"CW"],[14070,14110,"NB"],[14100,14112,"All","CW, digital, phone"],[14112,14350,"All","CW, phone"],
  [18068,18095,"CW"],[18095,18110,"NB","CW, narrowband digital"],[18110,18120,"All","CW, narrowband, phone"],[18120,18168,"All","CW, phone"],
  [21000,21070,"CW"],[21070,21110,"NB"],[21110,21125,"NB","CW, narrowband digital"],[21125,21150,"NB","Digital, satellite uplink"],[21150,21450,"All","CW, phone, satellite uplink"],
  [24890,24915,"CW"],[24915,24930,"NB"],[24930,24940,"All","CW, narrowband, DX, phone"],[24940,24990,"All","CW, phone"],
  [28000,28070,"CW"],[28070,28190,"NB"],[28190,28225,"Beacon"],[28225,29300,"All"],[29300,29510,"All","Satellite"],[29510,29590,"All","FM repeater input"],[29520,29620,"All","FM simplex"],[29620,29700,"All","FM repeater output"],
  [50000,50100,"CW"],[50100,50500,"All","CW, phone, narrowband, digital"],[50500,54000,"All"],
  [144000,144025,"NB","Digital, satellite, terrestrial"],[144025,144035,"NB","EME, weak signal"],[144035,145800,"All"],[145800,146000,"All","Satellite"],[146000,148000,"All"],
  [430000,431900,"All"],[431900,432240,"NB","EME, weak signal"],[432240,435000,"All"],[435000,438000,"All","Satellite"],[438000,440000,"All"],
];
const hf = ["160m","80m","60m","40m","30m","20m","17m","15m","12m","10m"];
export const builtinGuides: BandMapGuide[] = [
  { version: 1, units: "Hz", id: "builtin-r1-hf-2020", name: "IARU Region 1 HF (2020)", region: "Region 1 · HF only; VHF/UHF unsupported", origin: "built-in", sourceURL: "https://www.iaru-r1.org/wp-content/uploads/2021/06/hf_r1_bandplan.pdf", reviewed: "2026-11-03", supportedBands: hf, ranges: ranges(r1), markers: [] },
  { version: 1, units: "Hz", id: "builtin-r3-2024", name: "IARU Region 3 (2024 rev. 2)", region: "Region 3", origin: "built-in", sourceURL: "https://www.iaru-r3.org/wp-content/uploads/2025/01/R3-004-Band-Plans-IARU-Region-3.pdf", reviewed: "2026-11-03", supportedBands: [...hf,"6m","2m","70cm"], ranges: ranges(r3), markers: [] },
];
