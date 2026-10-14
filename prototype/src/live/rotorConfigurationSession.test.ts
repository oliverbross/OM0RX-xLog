// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearLegacyRotorConfiguration, defaultRotorConfiguration, legacyRotorConfiguration,
  readRotorConfigurationJournal, RotorConfigurationSession, rotorConfigurationDirty } from "./rotorConfigurationSession";

const generation = "12345678-1234-4234-8234-123456789abc";
const operationID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const snapshot = () => ({ revision: 0, generation, configuration: defaultRotorConfiguration() });

function backend() {
  let current = snapshot(), receipt: any = null, loseReply = false;
  const request = vi.fn(async (method: string, params: any = {}) => {
    if (method === "workspace_rotor_configuration_load") return structuredClone(current);
    if (method === "workspace_rotor_configuration_receipt") return { receipt: structuredClone(receipt) };
    if (method === "workspace_rotor_configuration_save") {
      if (receipt) {
        if (JSON.stringify(receipt.mutation) !== JSON.stringify(params)) throw new Error("operation reused");
        return { status: "applied", ...structuredClone(receipt.snapshot), receipt: structuredClone(receipt) };
      }
      if (params.expectedRevision !== current.revision) return { status: "conflict", ...structuredClone(current) };
      current = { revision: current.revision + (JSON.stringify(current.configuration) === JSON.stringify(params.configuration) ? 0 : 1),
        generation, configuration: structuredClone(params.configuration) };
      receipt = { mutation: structuredClone(params), snapshot: structuredClone(current) };
      if (loseReply) throw new Error("reply lost");
      return { status: "applied", ...structuredClone(current), receipt: structuredClone(receipt) };
    }
    throw new Error(`Unexpected ${method}`);
  });
  return { request, current: () => current, change: (value: any) => { current = value; }, lose: () => { loseReply = true; },
    resetUncommitted: () => { current = snapshot(); receipt = null; loseReply = false; } };
}

beforeEach(() => localStorage.clear());

describe("shared rotor configuration session", () => {
  it("migrates bounded legacy values once and preserves the radio configuration", () => {
    localStorage.setItem("xlog.integration.rotor", "hamlib");
    localStorage.setItem("xlog.rotor.host", "rotor.example.invalid");
    localStorage.setItem("xlog.hamlib.rotor", JSON.stringify({ mode: "external", host: "127.0.0.1", port: 4533 }));
    localStorage.setItem("xlog.hamlib.radio", "keep-radio");
    const value = legacyRotorConfiguration(localStorage);
    expect(value.owner).toBe("hamlib"); expect(value.native_dcu1.host).toBe("rotor.example.invalid");
    expect(value.hamlib.mode).toBe("external");
    clearLegacyRotorConfiguration(localStorage);
    expect(localStorage.getItem("xlog.integration.rotor")).toBeNull();
    expect(localStorage.getItem("xlog.hamlib.radio")).toBe("keep-radio");
  });

  it("saves an exact revisioned passive configuration and clears its journal", async () => {
    const service = backend(), journals: any[] = [];
    const session = new RotorConfigurationSession(service.request, value => journals.push(value), null, () => operationID);
    await session.load();
    const edited = structuredClone(session.getSnapshot().draft!); edited.native_dcu1.host = "tower.invalid";
    session.edit(edited); expect(rotorConfigurationDirty(session.getSnapshot().base, session.getSnapshot().draft)).toBe(true);
    await session.save(edited);
    expect(session.getSnapshot().base?.revision).toBe(1);
    expect(service.request.mock.calls.map(([method]) => method)).toEqual([
      "workspace_rotor_configuration_load", "workspace_rotor_configuration_save",
    ]);
    expect(journals.at(-1)).toBeNull();
  });

  it("retains local values when another editor advances the revision", async () => {
    const service = backend(), session = new RotorConfigurationSession(service.request, () => {}, null, () => operationID);
    await session.load();
    const draft = structuredClone(session.getSnapshot().draft!); draft.native_dcu1.name = "Local"; session.edit(draft);
    const remote = snapshot(); remote.revision = 1; remote.configuration.native_dcu1.name = "Remote"; service.change(remote);
    await session.load();
    expect(session.getSnapshot().draft?.native_dcu1.name).toBe("Local");
    expect(session.getSnapshot().conflict?.configuration.native_dcu1.name).toBe("Remote");
  });

  it("recovers a committed save after its acknowledgement is lost", async () => {
    const service = backend(), written: any[] = [];
    const session = new RotorConfigurationSession(service.request, value => written.push(value), null, () => operationID);
    await session.load();
    const draft = structuredClone(session.getSnapshot().draft!); draft.owner = "hamlib"; session.edit(draft); service.lose();
    await expect(session.save(draft)).rejects.toThrow("reply lost");
    expect(session.getSnapshot().pending?.operationID).toBe(operationID);
    await session.reconcile();
    expect(session.getSnapshot().base?.configuration.owner).toBe("hamlib");
    expect(session.getSnapshot().pending).toBeNull(); expect(written.at(-1)).toBeNull();
  });

  it("retries the same operation ID when no receipt exists", async () => {
    const service = backend(), session = new RotorConfigurationSession(service.request, () => {}, null, () => operationID);
    await session.load();
    const draft = structuredClone(session.getSnapshot().draft!); draft.native_dcu1.name = "Retry"; session.edit(draft);
    service.lose(); await expect(session.save(draft)).rejects.toThrow();
    service.resetUncommitted();
    await session.reconcile(); expect(session.getSnapshot().pending?.operationID).toBe(operationID);
    await session.retry();
    const saves = service.request.mock.calls.filter(([method]) => method === "workspace_rotor_configuration_save");
    expect(saves[0][1].operationID).toBe(saves[1][1].operationID);
  });

  it("keeps unsaved values fenced across workspace replacement and restores a journal", async () => {
    const service = backend(), written: any[] = [];
    const session = new RotorConfigurationSession(service.request, value => written.push(value), null, () => operationID);
    await session.load();
    const draft = structuredClone(session.getSnapshot().draft!); draft.native_dcu1.name = "Unsaved"; session.edit(draft);
    const replacement = snapshot(); replacement.generation = "87654321-4321-4321-8321-cba987654321"; service.change(replacement);
    await session.load();
    expect(session.getSnapshot().workspaceChanged).toBe(true);
    expect(session.getSnapshot().draft?.native_dcu1.name).toBe("Unsaved");
    const journal = readRotorConfigurationJournal(JSON.stringify(written.find(Boolean)));
    expect(journal?.draft.native_dcu1.name).toBe("Unsaved");
  });
});
