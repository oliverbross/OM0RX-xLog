// @vitest-environment jsdom
import { expect, it } from "vitest";
import { contestingRuntimeAvailable, contestingRuntimeKind } from "./LiveApp";

it("selects the Python desktop in normal and active production modes while preserving isolated practice", () => {
  const python = { mode: "integrated", isolated_workspace: false, contesting_engine: "not1mm-python", contesting_available: true };
  expect(contestingRuntimeKind(python)).toBe("python");
  expect(contestingRuntimeKind({ ...python, mode: "contesting" })).toBe("python");
  expect(contestingRuntimeKind({ mode: "contesting_test", isolated_workspace: true })).toBe("legacy");
  expect(contestingRuntimeAvailable({ ...python, contesting_available: false })).toBe(false);
  expect(contestingRuntimeKind({ mode: "contesting", isolated_workspace: false, contesting_engine: "legacy-swift", contesting_available: true })).toBeNull();
});
