// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { loadReadRadioJournal } from "./readRadioJournal";
const key = "read-radio", operationId = "00000000-0000-4000-8000-000000000001", generation = "00000000-0000-4000-8000-000000000002";
beforeEach(() => localStorage.clear());
it("retains the original workspace generation without substituting a current workspace", () => {
  localStorage.setItem(key, JSON.stringify({ operationId, generation }));
  expect(loadReadRadioJournal(key)).toEqual({ operationId, generation });
});
it("retains legacy operation identity without inventing its workspace", () => {
  localStorage.setItem(key, operationId);
  expect(loadReadRadioJournal(key)).toEqual({ operationId, generation: null });
});
it("lets a corrupt journal request canonical review without claiming a receipt identity", () => {
  localStorage.setItem(key, "invalid");
  expect(loadReadRadioJournal(key)).toEqual({ operationId: expect.stringMatching(/^[a-f0-9-]{36}$/), generation: null });
  expect(localStorage.getItem(key)).toBe("invalid");
});
