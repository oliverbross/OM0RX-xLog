import type { CWDecodeSnapshot } from "./cwDecode";

/** Synthetic UI fixture only. Never used as a production fallback or IQ source. */
export function cwDecodeFixture(): CWDecodeSnapshot {
  return {
    state: "stopped", resourcesAvailable: true, automaticSpotsQualified: false,
    configuration: { version: 1, revision: "10000000-0000-0000-0000-000000000001", sources: [
      { id: "20000000-0000-0000-0000-000000000001", radioID: "radio1", provider: "tci_iq", receiverID: "0", sampleRate: 96000 },
    ], listenerEnabled: false, listenerPort: 7300, automaticSpots: false }, sources: [], tracks: [],
    capabilities: [{ radioID: "radio1", provider: "tci_iq", ready: true, device: "Synthetic SunSDR fixture", protocolVersion: "2.1", transmitStateKnownOff: true,
      receivers: [{ receiver: 0, enabled: true, centreHz: 14025000 }, { receiver: 1, enabled: true, centreHz: 7025000 }], requestableSampleRates: [48000, 96000, 192000] }],
    listener: { state: "off", address: "127.0.0.1", clients: 0, authenticatedClients: 0, retainedSpots: 0, acceptedConnections: 0, refusedConnections: 0, slowDisconnects: 0, protocolDisconnects: 0 },
  };
}
export function cwDecodeTrackFixture(): CWDecodeSnapshot {
  const value = cwDecodeFixture(), source = value.configuration.sources[0];
  const descriptor = { sessionID: "30000000-0000-0000-0000-000000000001", sourceID: source.id, radioID: "radio1", receiverID: "0", provider: "tci_iq",
    streamToken: "40000000-0000-0000-0000-000000000001", epoch: "12", centreHz: 14025000, sampleRate: 96000, mappingQualified: false, replay: false };
  return { ...value, state: "running", sessionID: descriptor.sessionID,
    sources: [{ configuration: source, state: "running", descriptor, retryCount: 0 }],
    tracks: [{ sourceID: source.id, trackID: "50000000-0000-0000-0000-000000000001", descriptor, revision: "1", offsetHz: 6200,
      committed: "CQ TEST K1ABC K1ABC ", provisional: "CQ TE", ambiguous: false, inferenceMilliseconds: 72 }] };
}
