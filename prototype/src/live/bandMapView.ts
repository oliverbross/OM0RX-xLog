// Dependency-free persisted view shape; importing preferences does not load the map UI.
export const BAND_MAP_MODES = ["cw", "data", "phone"] as const;
export type BandMapMode = typeof BAND_MAP_MODES[number];
export type BandMapViewPreferences = { bands: string[]; followRadio: boolean; layout: "row" | "grid"; fontScale: number; modes?: BandMapMode[] };
