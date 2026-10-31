// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FirstRunSetup from "./live/FirstRunSetup";
import { acceptanceStation, validFirstRunReadback, verifyFirstRunSetup } from "./onboardingAcceptance";
afterEach(cleanup);
const generation = "00000000-0000-4000-8000-000000000001";
it("drives the rendered fresh wizard through Finish and independently verifies durable local settings", async () => {
  let persisted: Record<string, any> | null = null;
  const finish = vi.fn();
  function Harness() {
    const [complete, setComplete] = useState(false);
    return complete ? <input aria-label="Desk Callsign" /> : <FirstRunSetup loadCapabilities={async () => ({ platform_services: false })} onFinish={async values => {
      finish(values);
      persisted = { settings: { ...acceptanceStation, onboardingCompleted: true, logbookMode: "local", automaticSync: false }, revision: 2, generation };
      setComplete(true);
    }} />;
  }
  render(<Harness />);
  const worker = vi.fn(async (method: string) => {
    if (method === "settings_load") return { result: persisted ?? {} };
    if (method === "workspace_status") return { result: { workspace_exists: true, first_run_eligible: false, generation } };
    throw new Error(`Driver attempted mutation: ${method}`);
  });
  const report = await verifyFirstRunSetup({
    fill: async (selector, value) => { fireEvent.change(document.querySelector(selector)!, { target: { value } }); },
    click: async name => { fireEvent.click(screen.getByRole("button", { name })); },
    wait: async (_label, condition) => { await waitFor(() => expect(condition()).toBe(true)); },
    waitWorker: async (_label, condition) => { await waitFor(async () => expect(await condition()).toBe(true)); }, worker,
  });
  expect(report).toMatchObject({ completed: true, initialIdentityBlank: true, radioSkipped: true, rotatorSkipped: true, localMode: true, generation });
  expect(finish).toHaveBeenCalledOnce();
  expect(finish).toHaveBeenCalledWith(expect.objectContaining({ ...acceptanceStation, radio: "skip", rotor: "skip", logbookMode: "local" }));
  expect(worker.mock.calls.every(([method]) => ["settings_load", "workspace_status"].includes(method))).toBe(true);
});
it("does not accept a successful response with incomplete, mismatched or syncing setup", () => {
  const value = { settings: { ...acceptanceStation, onboardingCompleted: true, logbookMode: "local", automaticSync: false }, revision: 2, generation };
  expect(validFirstRunReadback(value)).toBe(true);
  for (const change of [{ onboardingCompleted: false }, { stationCall: "" }, { gridSquare: "FN31" }, { logbookMode: "wavelog" }, { automaticSync: true }])
    expect(validFirstRunReadback({ ...value, settings: { ...value.settings, ...change } })).toBe(false);
  expect(validFirstRunReadback({ ...value, revision: 0 })).toBe(false);
});
