import { describe, expect, it } from "vitest";
import { shouldResumeCluster } from "./clusterResume";

describe("cluster restart policy", () => {
  const saved = { connectOnStartup: true, servers: [{ enabled: true }] };
  it("resumes configured automatic reconnect independently of station hardware", () => {
    expect(shouldResumeCluster(saved)).toBe(true);
  });
  it("respects the startup opt-out and disabled servers", () => {
    expect(shouldResumeCluster({ ...saved, connectOnStartup: false })).toBe(false);
    expect(shouldResumeCluster({ connectOnStartup: true, servers: [{ enabled: false }] })).toBe(false);
    expect(shouldResumeCluster(undefined)).toBe(false);
  });
});
