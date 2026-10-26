import { workerRequest } from "../worker";

export type CWIQSource = { id: string; radioID: "radio1" | "radio2"; provider: "tci_iq" | "flex_dax_iq"; receiverID: string; sampleRate: number };
export type CWDecodeConfiguration = { version: 1; revision: string; sources: CWIQSource[]; listenerEnabled: boolean; listenerPort: number; automaticSpots: boolean };
export type CWDescriptor = { sessionID: string; sourceID: string; radioID: string; receiverID: string; streamToken: string; epoch: string;
  provider: string; centreHz: number; sampleRate: number; mappingQualified: boolean; replay: boolean; usableLowerHz?: number; usableUpperHz?: number };
export type CWTrackReference = { sessionID: string; sourceID: string; streamToken: string; epoch: string; trackID: string; revision: string; selectionID: string };
export type CWTrackSelection = { reference: CWTrackReference; callsign: string; activation?: { sourceEpoch: string; spotVersion: string } };
export type CWDecodeTrack = { sourceID: string; trackID: string; descriptor: CWDescriptor; revision: string; offsetHz: number; frequencyHz?: number;
  committed: string; provisional: string; ambiguous: boolean; inferenceMilliseconds?: number; spotRejection?: string;
  estimatedWPM?: number; estimatedSNRDB?: number; snrReferenceHz?: number; selection?: CWTrackSelection; controlReference?: CWTrackReference;
  controlActivation?: { sourceEpoch: string; spotVersion: string }; muted?: boolean;
  opportunity?: { callStatus: string; dxccStatus: string } };
export type CWCapability = { radioID: string; provider: string; ready: boolean; device?: string; protocolVersion?: string;
  receivers: { receiver: number; enabled?: boolean; centreHz?: number }[]; requestableSampleRates: number[]; transmitStateKnownOff?: boolean;
  inventoryRevision?: string; identity?: { serial: string; model: string; address: string; controlPort: number }; stationHandle?: number;
  panadapters?: { id: string; clientHandle?: number; channel?: number; centreHz?: number; receiveAntenna?: string }[]; handoffPanadapters?: string[] };
export type CWDecodeSnapshot = { sessionID?: string; state: string; failure?: string; automaticSpotsQualified: boolean; resourcesAvailable: boolean;
  operatingModule?: "normal_logging" | "contesting";
  operatingContext?: string;
  activeRadioID?: "radio1" | "radio2";
  spotOutputFailure?: string;
  featureEnabled?: boolean;
  load?: { sources: number; tracks: number; pending: number; inFlight: number; coalesced: string; droppedEvents: string };
  configuration: CWDecodeConfiguration; sources: { configuration: CWIQSource; state: string; descriptor?: CWDescriptor; retryCount: number; failure?: string }[];
  tracks: CWDecodeTrack[]; capabilities: CWCapability[];
  listener: { state: string; address: string; port?: number; clients: number; authenticatedClients: number; retainedSpots: number;
    acceptedConnections: number; refusedConnections: number; slowDisconnects: number; protocolDisconnects: number } };
export const cwDecodeMethods = ["cw_decode_snapshot", "cw_decode_configuration_save", "cw_decode_start", "cw_decode_stop", "cw_decode_listener_start", "cw_decode_listener_stop", "cw_decode_flex_handoff", "cw_decode_track_mute"] as const;
export type CWDecodeMethod = typeof cwDecodeMethods[number];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const counter = /^(0|[1-9][0-9]{0,19})$/;
const panID = /^[0-9a-f]{8}$/;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const source = (value: unknown): value is CWIQSource => object(value) && uuid.test(value.id) && ["radio1", "radio2"].includes(value.radioID) &&
  ["tci_iq", "flex_dax_iq"].includes(value.provider) && typeof value.receiverID === "string" && /^[A-Za-z0-9-]{1,64}$/.test(value.receiverID) && [48000, 96000, 192000].includes(value.sampleRate);
const descriptor = (value: unknown): value is CWDescriptor => object(value) && ["sessionID", "sourceID", "streamToken"].every(key => typeof value[key] === "string" && uuid.test(value[key])) &&
  ["radio1", "radio2"].includes(value.radioID) && typeof value.receiverID === "string" && value.receiverID.length <= 128 &&
  typeof value.epoch === "string" && counter.test(value.epoch) && ["tci_iq", "flex_dax_iq"].includes(value.provider) &&
  integer(value.centreHz, 100000, 1e9) && [24000, 48000, 96000, 192000, 384000].includes(value.sampleRate) && typeof value.mappingQualified === "boolean" && value.replay === false &&
  (value.usableLowerHz === undefined && value.usableUpperHz === undefined ||
    integer(value.usableLowerHz, 1, 1e9) && integer(value.usableUpperHz, 1, 1e9) && value.usableLowerHz < value.usableUpperHz &&
    value.usableLowerHz >= value.centreHz - value.sampleRate / 2 && value.usableUpperHz <= value.centreHz + value.sampleRate / 2);
const trackSelection = (track: Record<string, any>): boolean => {
  if (track.selection === undefined) return true;
  const selection = track.selection, reference = selection?.reference;
  return !track.ambiguous && object(selection) && object(reference) && Object.keys(reference).length === 7 &&
    ["sessionID", "sourceID", "streamToken", "trackID", "selectionID"].every(key => typeof reference[key] === "string" && uuid.test(reference[key])) &&
    ["sessionID", "sourceID", "streamToken"].every(key => reference[key].toLowerCase() === track.descriptor[key].toLowerCase()) &&
    reference.trackID.toLowerCase() === track.trackID.toLowerCase() && reference.epoch === track.descriptor.epoch && reference.revision === track.revision &&
    typeof selection.callsign === "string" && selection.callsign.length >= 3 && selection.callsign.length <= 20 &&
    /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(selection.callsign) &&
    (selection.activation === undefined || object(selection.activation) && Object.keys(selection.activation).length === 2 &&
      ["sourceEpoch", "spotVersion"].every(key => typeof selection.activation[key] === "string" && uuid.test(selection.activation[key])));
};
const trackControl = (track: Record<string, any>): boolean => {
  const reference = track.controlReference;
  return (track.muted === undefined || typeof track.muted === "boolean") && (!track.muted || track.selection === undefined) &&
    (track.controlActivation === undefined || reference !== undefined && !track.muted && !track.ambiguous && track.frequencyHz !== undefined &&
      object(track.controlActivation) && Object.keys(track.controlActivation).length === 2 &&
      ["sourceEpoch", "spotVersion"].every(key => typeof track.controlActivation[key] === "string" && uuid.test(track.controlActivation[key]))) &&
    (reference === undefined || object(reference) && Object.keys(reference).length === 7 &&
      ["sessionID", "sourceID", "streamToken", "trackID", "selectionID"].every(key => typeof reference[key] === "string" && uuid.test(reference[key])) &&
      ["sessionID", "sourceID", "streamToken"].every(key => reference[key].toLowerCase() === track.descriptor[key].toLowerCase()) &&
      reference.trackID.toLowerCase() === track.trackID.toLowerCase() && reference.epoch === track.descriptor.epoch && reference.revision === track.revision);
};
const trackOpportunity = (track: Record<string, any>): boolean => {
  const value = track.opportunity;
  return value === undefined || object(value) && Object.keys(value).length === 2 && track.selection !== undefined &&
    track.frequencyHz !== undefined && !track.muted && !track.ambiguous && !track.descriptor.replay &&
    ["Unknown", "New Call", "New Band+Mode", "New Band", "New Mode", "Worked", "Confirmed"].includes(value.callStatus) &&
    ["Unknown", "ATNO", "Worked", "Confirmed", "C/New Band+Mode", "C/New Band", "C/New Mode", "W/New Band+Mode", "W/New Band", "W/New Mode"].includes(value.dxccStatus);
};

export function parseCWDecodeSnapshot(value: unknown): CWDecodeSnapshot {
  if (!object(value) || !["stopped", "preparing", "running", "recovering", "blocked", "stopping"].includes(value.state) ||
    typeof value.resourcesAvailable !== "boolean" || typeof value.automaticSpotsQualified !== "boolean" ||
    value.featureEnabled !== undefined && typeof value.featureEnabled !== "boolean" ||
    value.operatingModule !== undefined && !["normal_logging", "contesting"].includes(value.operatingModule) ||
    value.operatingContext !== undefined && (typeof value.operatingContext !== "string" || !uuid.test(value.operatingContext)) ||
    value.activeRadioID !== undefined && !["radio1", "radio2"].includes(value.activeRadioID) ||
    value.load !== undefined && (!object(value.load) || !integer(value.load.sources, 0, 2) || !integer(value.load.tracks, 0, 32) ||
      !integer(value.load.pending, 0, 32) || !integer(value.load.inFlight, 0, 4) ||
      ![value.load.coalesced, value.load.droppedEvents].every(number => typeof number === "string" && counter.test(number) && BigInt(number) <= 18446744073709551615n)) ||
    value.spotOutputFailure !== undefined && value.spotOutputFailure !== "local_cw_output_unavailable" ||
    value.sessionID !== undefined && (typeof value.sessionID !== "string" || !uuid.test(value.sessionID))) throw new Error("CW Decode returned an invalid session state.");
  const config = value.configuration;
  if (!object(config) || config.version !== 1 || typeof config.revision !== "string" || !uuid.test(config.revision) ||
    !Array.isArray(config.sources) || config.sources.length > 2 || !config.sources.every(source) ||
    new Set(config.sources.map(item => item.id)).size !== config.sources.length || typeof config.listenerEnabled !== "boolean" ||
    typeof config.automaticSpots !== "boolean" || !integer(config.listenerPort, 1024, 65535)) throw new Error("CW Decode settings could not be verified.");
  if (!Array.isArray(value.sources) || value.sources.length > 2 || !value.sources.every(row => object(row) && source(row.configuration) &&
    ["stopped", "preparing", "acquiring", "running", "quarantined", "muted", "recovering", "blocked"].includes(row.state) && integer(row.retryCount, 0, 3) &&
    (row.descriptor === undefined || descriptor(row.descriptor)))) throw new Error("CW Decode source state could not be verified.");
  if (!Array.isArray(value.tracks) || value.tracks.length > 32 || !value.tracks.every(track => object(track) && descriptor(track.descriptor) &&
    track.sourceID === track.descriptor.sourceID && typeof track.trackID === "string" && uuid.test(track.trackID) &&
    typeof track.revision === "string" && counter.test(track.revision) && typeof track.offsetHz === "number" && Number.isFinite(track.offsetHz) &&
    Math.abs(track.offsetHz) <= track.descriptor.sampleRate / 2 && typeof track.committed === "string" && track.committed.length <= 1024 &&
    typeof track.provisional === "string" && track.provisional.length <= 1024 && typeof track.ambiguous === "boolean" &&
    trackSelection(track) && trackControl(track) && trackOpportunity(track) &&
    (track.frequencyHz === undefined || track.descriptor.mappingQualified && integer(track.frequencyHz, 100000, 1e9)) &&
    (track.spotRejection === undefined || ["quality_not_qualified", "replay", "stale_source", "unmapped_frequency", "contaminated", "ambiguous", "insufficient_occurrences", "cooldown", "invalid_evidence"].includes(track.spotRejection)) &&
    (track.estimatedWPM === undefined || Number.isFinite(track.estimatedWPM) && track.estimatedWPM >= 5 && track.estimatedWPM <= 80) &&
    (track.estimatedSNRDB === undefined ? track.snrReferenceHz === undefined : Number.isFinite(track.estimatedSNRDB) && track.estimatedSNRDB >= -100 && track.estimatedSNRDB <= 150 && track.snrReferenceHz === 2500) &&
    (track.inferenceMilliseconds === undefined || Number.isFinite(track.inferenceMilliseconds) && track.inferenceMilliseconds >= 0))) throw new Error("CW Decode track state could not be verified.");
  const listener = value.listener;
  if (!object(listener) || !["off", "starting", "listening", "occupied", "failed", "loop_blocked"].includes(listener.state) || listener.address !== "127.0.0.1" ||
    !integer(listener.clients, 0, 8) || !integer(listener.authenticatedClients, 0, listener.clients) || !integer(listener.retainedSpots, 0, 100) ||
    listener.port !== undefined && !integer(listener.port, 0, 65535)) throw new Error("The Local CW server state could not be verified.");
  if (!Array.isArray(value.capabilities) || value.capabilities.length > 4 || !value.capabilities.every(row => object(row) &&
    ["radio1", "radio2"].includes(row.radioID) && ["tci_iq", "flex_dax_iq"].includes(row.provider) && typeof row.ready === "boolean" &&
    Array.isArray(row.receivers) && row.receivers.length <= 2 && row.receivers.every(receiver => object(receiver) && integer(receiver.receiver, 0, 1) &&
      (receiver.enabled === undefined || typeof receiver.enabled === "boolean") && (receiver.centreHz === undefined || integer(receiver.centreHz, 0, 1e9))) &&
    Array.isArray(row.requestableSampleRates) && row.requestableSampleRates.length <= 5 && row.requestableSampleRates.every(rate => integer(rate, 24000, 384000)) &&
    (row.provider !== "flex_dax_iq" || flexCapability(row)))) throw new Error("CW Decode capabilities could not be verified.");
  if (new Set(value.capabilities.map(row => `${row.radioID}:${row.provider}`)).size !== value.capabilities.length) throw new Error("CW Decode returned duplicate radio capabilities.");
  return value as CWDecodeSnapshot;
}
function flexCapability(row: Record<string, any>): boolean {
  return (row.inventoryRevision === undefined && !row.ready || typeof row.inventoryRevision === "string" && counter.test(row.inventoryRevision)) &&
    (row.stationHandle === undefined || integer(row.stationHandle, 0, 0xffffffff)) &&
    (row.identity === undefined || object(row.identity) && ["serial", "model", "address"].every(key => typeof row.identity[key] === "string" && row.identity[key].length > 0 && row.identity[key].length <= 64) && integer(row.identity.controlPort, 1, 65535)) &&
    Array.isArray(row.panadapters) && row.panadapters.length <= 16 && row.panadapters.every(pan => object(pan) && typeof pan.id === "string" && panID.test(pan.id) &&
      (pan.clientHandle === undefined || integer(pan.clientHandle, 0, 0xffffffff)) && (pan.channel === undefined || integer(pan.channel, 0, 8)) &&
      (pan.centreHz === undefined || integer(pan.centreHz, 100000, 1e9)) && (pan.receiveAntenna === undefined || typeof pan.receiveAntenna === "string" && pan.receiveAntenna.length <= 64)) &&
    (row.handoffPanadapters === undefined || Array.isArray(row.handoffPanadapters) && row.handoffPanadapters.length <= 2 && row.handoffPanadapters.every(id => typeof id === "string" && panID.test(id)));
}
export async function requestCWDecode(method: CWDecodeMethod, params: Record<string, unknown> = {}): Promise<CWDecodeSnapshot> {
  if (!cwDecodeMethods.includes(method)) throw new Error("This window can only use CW Decode controls.");
  return parseCWDecodeSnapshot((await workerRequest(method, params)).result);
}
export const cwRadioName = (id: string) => id === "radio1" ? "Radio 1" : "Radio 2";
export const cwSourceName = (source: CWIQSource | CWDescriptor) => `${cwRadioName(source.radioID)} · ${source.provider === "tci_iq" ? `TCI RX ${Number(source.receiverID) + 1}` : `FLEX ${source.receiverID}`}`;
