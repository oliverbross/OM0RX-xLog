import type { ContestSetupDocument } from "./ContestSetupPanel";

/** A preview only: the host must enforce the durable practice-session boundary. */
export function practiceContestSetup(source: ContestSetupDocument): ContestSetupDocument {
  const preferences = structuredClone(source.preferences);
  for (const key of Object.keys(preferences)) {
    if (/password|secret|token|username|credential|voiceProfilePath|soundDevice|rtcURL/i.test(key)) delete preferences[key];
  }
  return { ...structuredClone(source), name: `Practice: ${source.name}`.slice(0, 128),
    preferences: { ...preferences, rtcEnabled: false, autoCQ: false },
    network: { n1mmEnabled: false, n1mmRadio: false, n1mmContact: false, n1mmLookup: false,
      n1mmScore: false, multiEnabled: false, multiMaster: false } };
}
