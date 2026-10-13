// Synthetic memory-only context shared by isolated tests/previews, never a
// runtime fallback for unavailable native observations.
import type { MapContext } from "./mapContext";
export function syntheticMapContext(now = Date.now()): MapContext {
  return { epoch: "00000000-0000-4000-8000-000000000001", revision: 1,
    metadata: { generation: "00000000-0000-4000-8000-000000000002", revision: 0, stored: true,
      preferences: { deskBandMapBands: ["20m"], detachedBandMapBands: ["20m", "40m"], deskBandMapFollowsRadio: true,
        detachedBandMapFollowsRadio: false, detachedBandMapLayout: "Adaptive grid", bandMapFontScale: 1,
        intelligenceBands: ["20m"], clusterSpotOpensFullEditor: false, detachedBandMapModes: ["cw", "data", "phone"] },
      home: { call: "TESTHOME", lat: -12.4, lon: 130.8 }, dxccStatuses: { 291: "needed" } },
    cluster: { revision: 1, available: true, selected: null, received_at_ms: now, response: { snapshot: { spots: [{ id: "synthetic-report", callsign: "TEST0/P",
      receivedAt: now / 1000, frequencyKHz: 14025, band: "20m", mode: "CW", latitude: 37, longitude: -6,
      spotter: "TEST1", comment: "Synthetic report", country: "Synthetic", callStatus: "New Call", adif: 291 }] }, configuration: { palette: {} } } },
    selection: { provider: "direct_agent", generation: 0 }, radio: { revision: 1, provider: "direct_agent", available: true,
      received_at_ms: now, snapshot: { source: "direct_agent", radio: { observed: true, connected: true, frequency_hz: 14025000 } } },
  };
}
