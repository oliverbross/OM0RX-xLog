import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cwSourceFailureMessages, parseCWDecodeSnapshot } from "./cwDecode";
import { cwDecodeFixture, cwDecodeTrackFixture } from "./cwDecode.fixtures";

describe("native CW Decode projection", () => {
  it("keeps native source failure codes and the operator projection in agreement", () => {
    const source=readFileSync(new URL("../../../Sources/XCWCore/CWIQSourceFailure.swift",import.meta.url),"utf8");
    const codes=[...source.matchAll(/"(iq_[a-z_]+)"/g)].map(match=>match[1]).sort();
    expect(Object.keys(cwSourceFailureMessages).sort()).toEqual(codes);
  });
  it("accepts only bounded source reasons and preserves unknown diagnostics as unavailable", () => {
    const fixture=cwDecodeFixture();fixture.sources=[{configuration:fixture.configuration.sources[0],state:"blocked",retryCount:0}];
    expect(parseCWDecodeSnapshot(fixture).sources[0].failure).toBeUndefined();
    for(const failure of Object.keys(cwSourceFailureMessages)) {
      fixture.sources[0].failure=failure;expect(parseCWDecodeSnapshot(fixture).sources[0].failure).toBe(failure);
    }
    for(const failure of ["private endpoint text","toString","__proto__",true]) {
      (fixture.sources[0] as any).failure=failure;expect(()=>parseCWDecodeSnapshot(fixture)).toThrow();
    }
  });
  it("preserves unknown ages and rejects invalid or contradictory measured ages", () => {
    const fixture=cwDecodeTrackFixture(),track=fixture.tracks[0];
    expect(parseCWDecodeSnapshot(fixture).tracks[0].decodeAgeMilliseconds).toBeUndefined();
    track.decodeAgeMilliseconds=188;track.carrierAgeMilliseconds=198;
    expect(parseCWDecodeSnapshot(fixture).tracks[0].carrierAgeMilliseconds).toBe(198);
    for(const invalid of [-1,NaN,Infinity,true,"0"]) {
      const bad=structuredClone(fixture);(bad.tracks[0] as any).decodeAgeMilliseconds=invalid;
      expect(()=>parseCWDecodeSnapshot(bad)).toThrow();
    }
    track.descriptor.mappingQualified=true;track.frequencyHz=14031200;track.carrierAgeMilliseconds=2000;
    expect(()=>parseCWDecodeSnapshot(fixture)).not.toThrow();
    track.carrierAgeMilliseconds=2000.001;expect(()=>parseCWDecodeSnapshot(fixture)).toThrow();
    delete track.frequencyHz;expect(()=>parseCWDecodeSnapshot(fixture)).not.toThrow();
  });
  it("keeps load counters lossless and bounded", () => {
    const fixture = cwDecodeFixture(); fixture.load = { sources: 2, tracks: 32, pending: 16, inFlight: 4, coalesced: "18446744073709551615", droppedEvents: "0" };
    expect(parseCWDecodeSnapshot(fixture).load?.coalesced).toBe("18446744073709551615");
    fixture.load.coalesced = "18446744073709551616"; expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
    fixture.load.coalesced = "0"; fixture.load.inFlight = 5; expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
  });
  it("validates adapter-reported usable coverage against the actual sample rate", () => {
    const fixture = cwDecodeTrackFixture(), descriptor = fixture.tracks[0].descriptor;
    descriptor.sampleRate = 24000; descriptor.usableLowerHz = descriptor.centreHz - 10000; descriptor.usableUpperHz = descriptor.centreHz + 10000;
    expect(parseCWDecodeSnapshot(fixture).tracks[0].descriptor.sampleRate).toBe(24000);
    descriptor.usableUpperHz = descriptor.centreHz + 13000; expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
    delete descriptor.usableUpperHz; expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
  });
  it("accepts passive and active native-shaped snapshots", () => {
    expect(parseCWDecodeSnapshot(cwDecodeFixture()).state).toBe("stopped");
    expect(parseCWDecodeSnapshot(cwDecodeTrackFixture()).tracks).toHaveLength(1);
  });
  it("keeps a verified continuity interruption visible without admitting unknown withholding reasons", () => {
    const fixture=cwDecodeTrackFixture();
    for(const reason of ["continuity_interrupted","frequency_evidence_unavailable"]) {
      fixture.tracks[0].spotRejection=reason;
      expect(parseCWDecodeSnapshot(fixture).tracks[0].spotRejection).toBe(reason);
    }
    fixture.tracks[0].spotRejection="pretend_qualified";
    expect(()=>parseCWDecodeSnapshot(fixture)).toThrow();
  });
  it("pins mute control to the current track even without a callsign", () => {
    const fixture = cwDecodeTrackFixture(), track = fixture.tracks[0];
    track.controlReference = { sessionID: track.descriptor.sessionID, sourceID: track.sourceID, streamToken: track.descriptor.streamToken,
      epoch: track.descriptor.epoch, trackID: track.trackID, revision: track.revision, selectionID: "60000000-0000-0000-0000-000000000001" };
    track.muted = true; expect(parseCWDecodeSnapshot(fixture).tracks[0].muted).toBe(true);
    track.controlReference.revision = "2"; expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
  });
  it("admits native RF activation tokens only on an eligible qualified signal", () => {
    const fixture = cwDecodeTrackFixture(), track = fixture.tracks[0];
    track.controlReference = { sessionID: track.descriptor.sessionID, sourceID: track.sourceID, streamToken: track.descriptor.streamToken,
      epoch: track.descriptor.epoch, trackID: track.trackID, revision: track.revision, selectionID: "60000000-0000-0000-0000-000000000001" };
    track.controlActivation = { sourceEpoch: "80000000-0000-0000-0000-000000000001", spotVersion: "90000000-0000-0000-0000-000000000001" };
    expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
    track.descriptor.mappingQualified = true; track.frequencyHz = 14031200;
    expect(parseCWDecodeSnapshot(fixture).tracks[0].controlActivation).toEqual(track.controlActivation);
    track.muted = true; expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
  });
  it("accepts only existing logbook status annotations on a qualified callsign row", () => {
    const fixture=cwDecodeTrackFixture(),track=fixture.tracks[0];track.descriptor.mappingQualified=true;track.frequencyHz=14025000;
    track.selection={callsign:"K1ABC",reference:{sessionID:track.descriptor.sessionID,sourceID:track.sourceID,streamToken:track.descriptor.streamToken,
      epoch:track.descriptor.epoch,trackID:track.trackID,revision:track.revision,selectionID:crypto.randomUUID()}};
    track.opportunity={callStatus:"New Call",dxccStatus:"ATNO"};expect(parseCWDecodeSnapshot(fixture).tracks[0].opportunity).toEqual(track.opportunity);
    const malformed=structuredClone(fixture);malformed.tracks[0].opportunity!.callStatus="Guessed call";expect(()=>parseCWDecodeSnapshot(malformed)).toThrow();
    delete track.selection;expect(()=>parseCWDecodeSnapshot(fixture)).toThrow();
  });
  it("rejects lossy capture identity, unqualified RF and unbounded arrays", () => {
    const numericEpoch = cwDecodeTrackFixture(); (numericEpoch.tracks[0].descriptor as any).epoch = 12;
    expect(() => parseCWDecodeSnapshot(numericEpoch)).toThrow();
    const frequency = cwDecodeTrackFixture(); frequency.tracks[0].frequencyHz = 14031200;
    expect(() => parseCWDecodeSnapshot(frequency)).toThrow();
    const count = cwDecodeTrackFixture(); count.tracks = Array.from({ length: 33 }, () => count.tracks[0]);
    expect(() => parseCWDecodeSnapshot(count)).toThrow();
    const local = cwDecodeFixture(); local.listener.address = "0.0.0.0";
    expect(() => parseCWDecodeSnapshot(local)).toThrow();
  });
  it("bounds observed FLEX resource metadata and rejects duplicate capabilities", () => {
    const fixture = cwDecodeFixture(); fixture.capabilities = [{ radioID: "radio1", provider: "flex_dax_iq", ready: true, receivers: [], requestableSampleRates: [96000],
      inventoryRevision: "9", stationHandle: 0x1234, panadapters: [{ id: "40000000", channel: 1, clientHandle: 0x1234, centreHz: 14025000 }], handoffPanadapters: [] }];
    expect(parseCWDecodeSnapshot(fixture).capabilities[0].panadapters?.[0].id).toBe("40000000");
    fixture.capabilities[0].panadapters![0].id = "not-a-pan";
    expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
    fixture.capabilities[0].panadapters![0].id = "40000000";
    fixture.capabilities.push(structuredClone(fixture.capabilities[0]));
    expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
  });
  it("accepts only a callsign selection pinned to the same unambiguous track and capture", () => {
    const fixture = cwDecodeTrackFixture(), track = fixture.tracks[0];
    track.selection = { callsign: "K1ABC", reference: { sessionID: track.descriptor.sessionID, sourceID: track.sourceID,
      streamToken: track.descriptor.streamToken, epoch: track.descriptor.epoch, trackID: track.trackID,
      revision: track.revision, selectionID: "60000000-0000-0000-0000-000000000001" } };
    expect(parseCWDecodeSnapshot(fixture).tracks[0].selection?.callsign).toBe("K1ABC");
    track.selection.activation = { sourceEpoch: "80000000-0000-0000-0000-000000000001", spotVersion: "90000000-0000-0000-0000-000000000001" };
    expect(parseCWDecodeSnapshot(fixture).tracks[0].selection?.activation).toEqual(track.selection.activation);
    const badActivation = structuredClone(fixture); badActivation.tracks[0].selection!.activation!.spotVersion = "unknown";
    expect(() => parseCWDecodeSnapshot(badActivation)).toThrow();
    for (const [key, value] of [["streamToken", "70000000-0000-0000-0000-000000000001"], ["revision", "2"], ["epoch", "13"]] as const) {
      const changed = structuredClone(fixture); changed.tracks[0].selection!.reference[key] = value;
      expect(() => parseCWDecodeSnapshot(changed)).toThrow();
    }
    track.ambiguous = true;
    expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
    track.ambiguous = false; track.selection.callsign = "CQ";
    expect(() => parseCWDecodeSnapshot(fixture)).toThrow();
  });
});
