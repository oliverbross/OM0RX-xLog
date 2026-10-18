import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fixture = JSON.parse(readFileSync(new URL(
  "../../../docs/contesting/fixtures/sst-worker-preactivation-wire.json", import.meta.url), "utf8"));

describe("historical SST pre-activation worker fixture", () => {
  it("retains the reviewed injected-definition checkpoint without presenting it as current catalog evidence", () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.scope).toBe("pre-activation injected immutable definition; SST is not in the built-in catalog");
    const rule = fixture.catalog.result.rules.find((candidate: any) => candidate.identity.id === "k1usn-sst");
    expect(rule.identity.sourceRevision).toBe("ee468901349dd947eeb053b15f6d0ede002724d7760982291e78583a1cb28c27");
    expect(rule.declarativeDefinition.submissionReady).toBe(false);
  });
});
