// @vitest-environment jsdom
import React from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("../src/Map", () => ({
  default: () => <div aria-label="Offline map fixture" />,
}));
vi.mock("../src/worker", () => ({
  desktop: false,
  workerRequest: vi
    .fn()
    .mockRejectedValue(new Error("Browser preview · no worker")),
  openMonitor: vi.fn().mockResolvedValue("Browser monitor preview opened"),
}));
import App from "../src/App";
beforeEach(() => {
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      onmessage = null;
      postMessage() {}
      close() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("rendered operator workflow", () => {
  it("loads a cluster spot, simulates tuning and saves by keyboard", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(
      screen.getByRole("button", { name: /Load OH9W.*synthetic NB/ })
        .textContent,
    ).toBe("OH9WNB");
    await user.click(screen.getByRole("button", { name: "DX Cluster" }));
    await user.click(screen.getByRole("button", { name: "N7A" }));
    const call = screen.getByRole("textbox", {
      name: "Callsign",
    }) as HTMLInputElement;
    expect(call.value).toBe("N7A");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Frequency MHz",
        }) as HTMLInputElement
      ).value,
    ).toBe("7.029400");
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(call.value).toBe(""));
    await user.click(screen.getByRole("button", { name: "Logbook" }));
    expect(screen.getByRole("cell", { name: "N7A" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "CW" })).toBeTruthy();
  });
  it("keeps draft through a station switch and exposes unavailable radio read", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByRole("textbox", { name: "Callsign" }),
      "DL1ABC",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Station profile" }),
      "manual",
    );
    expect(
      (screen.getByRole("textbox", { name: "Callsign" }) as HTMLInputElement)
        .value,
    ).toBe("DL1ABC");
    expect(
      (
        screen.getByRole("button", {
          name: "Read simulated radio",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      (screen.getByRole("textbox", { name: "Callsign" }) as HTMLInputElement)
        .value,
    ).toBe("");
  });
  it("retains invalid draft and reports validation instead of claiming a save", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByRole("textbox", { name: "Callsign" }),
      "INVALID",
    );
    await user.click(screen.getByRole("button", { name: /Log QSO/ }));
    expect(screen.getByRole("alert").textContent).toContain("valid callsign");
    expect(
      (screen.getByRole("textbox", { name: "Callsign" }) as HTMLInputElement)
        .value,
    ).toBe("INVALID");
  });
  it("labels browser worker unavailable and prevents checks", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Prototype Checks" }));
    expect(
      screen.getByText("Browser preview · Swift worker unavailable"),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Check worker health",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
