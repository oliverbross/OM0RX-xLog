// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FirstRunSetup from "./FirstRunSetup";
import { loadHamlibCatalogue } from "./hamlibCatalogue";
import { stationSessionRequest } from "./stationSession";
import { workerRequest } from "../worker";

vi.mock("./stationSession", () => ({ stationSessionRequest: vi.fn() }));
vi.mock("../worker", () => ({ workerRequest: vi.fn() }));
afterEach(cleanup);

it("browses the station radio result and retries the framed rotor result using the production wizard adapters", async () => {
  const rig = { id: 1, manufacturer: "Hamlib", model: "Rig fixture", maturity: "Stable" };
  const rotor = { ...rig, model: "Rotor fixture" };
  vi.mocked(stationSessionRequest).mockResolvedValue({ models: [rig] });
  vi.mocked(workerRequest)
    .mockResolvedValueOnce({ id: "list-1", ok: true, result: { models: [] } })
    .mockResolvedValueOnce({ id: "list-2", ok: true, result: { models: [rotor] } });
  render(<FirstRunSetup initialSettings={{ operatorCall: "K1ABC", stationCall: "K1ABC" }}
    loadCapabilities={async () => ({ platform_services: false })} onFinish={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Setup radio connection"), { target: { value: "hamlib" } });
  fireEvent.click(screen.getByRole("button", { name: "Browse radio models" }));
  expect(await screen.findByRole("option", { name: /Rig fixture/ })).toBeTruthy();
  expect(stationSessionRequest).toHaveBeenCalledWith("radio1", { action: "hamlib_catalogue" });

  fireEvent.click(screen.getByRole("button", { name: "Skip radio" }));
  fireEvent.change(screen.getByLabelText("Setup rotator connection"), { target: { value: "hamlib" } });
  const browse = () => fireEvent.click(screen.getByRole("button", { name: "Browse rotator models" }));
  browse();
  expect((await screen.findByRole("alert")).textContent).toMatch(/retry/i);
  browse();
  expect(await screen.findByRole("option", { name: /Rotor fixture/ })).toBeTruthy();
  expect(workerRequest).toHaveBeenCalledTimes(2);
  expect(workerRequest).toHaveBeenCalledWith("hamlib_models", { device: "rotor" });
});

it("shares in-flight reads and retains a successful nonempty catalogue", async () => {
  let finish!: (value: { models: unknown[] }) => void;
  const read = vi.fn(() => new Promise<{ models: unknown[] }>(resolve => { finish = resolve; }));
  const pending = loadHamlibCatalogue(read, "rotor");
  expect(loadHamlibCatalogue(read, "rotor")).toBe(pending);
  finish({ models: [{ id: 1, manufacturer: "Hamlib", model: "Dummy" }] });
  expect((await pending).map(model => model.id)).toEqual([1]);
  expect(loadHamlibCatalogue(read, "rotor")).toBe(pending);
  expect(read).toHaveBeenCalledTimes(1);
});

it.each(["empty", "unusable", "error"])("retries a %s catalogue without evicting the other device", async failure => {
  const rig = { id: 1, manufacturer: "Hamlib", model: "Dummy" };
  let rotorReads = 0;
  const read = vi.fn(async (_method: string, params: Record<string, unknown>) => {
    if (params.device === "radio") return { models: [rig] };
    if (++rotorReads === 1) {
      if (failure === "error") throw new Error("Missing helper fixture");
      return { models: failure === "empty" ? [] : [{ id: "1", model: "Invalid" }] };
    }
    return { models: [{ ...rig, model: "Dummy rotor" }] };
  });
  const radio = loadHamlibCatalogue(read, "radio");
  await radio;
  if (failure === "error") await expect(loadHamlibCatalogue(read, "rotor")).rejects.toThrow(/helper/);
  else expect(await loadHamlibCatalogue(read, "rotor")).toEqual([]);
  expect((await loadHamlibCatalogue(read, "rotor"))[0].model).toBe("Dummy rotor");
  expect(loadHamlibCatalogue(read, "radio")).toBe(radio);
  expect(read).toHaveBeenCalledTimes(3);
});
