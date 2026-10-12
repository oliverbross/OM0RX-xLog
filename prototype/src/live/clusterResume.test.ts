import { describe, expect, it } from "vitest";
import { shouldResumeCluster } from "./clusterResume";

describe("cluster restart policy", () => {
  const saved = { reconnect: true, servers: [{ enabled: true }] };
  it("resumes configured automatic reconnect independently of station hardware", () => {
    expect(shouldResumeCluster(null, saved)).toBe(true);
    expect(shouldResumeCluster("connected", saved)).toBe(true);
  });
  it("respects deliberate disconnect, disabled reconnect and disabled servers", () => {
    expect(shouldResumeCluster("disconnected", saved)).toBe(false);
    expect(shouldResumeCluster("connected", { ...saved, reconnect: false })).toBe(false);
    expect(shouldResumeCluster(null, { reconnect: true, servers: [{ enabled: false }] })).toBe(false);
    expect(shouldResumeCluster(null, undefined)).toBe(false);
  });
});
