// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CWSettings from "./CWSettings";
import ServiceSettings from "./ServiceSettings";
import { defaultCWProfile, type CWProfile } from "./cwMacros";
afterEach(cleanup);
const context = { MYCALL: "OM0RX", CALL: "K1ABC", RST: "599" };

describe("CW preferences and preview never transmit", () => {
  it("edits, previews and navigates without I/O; persists only on explicit Save", async () => {
    const request = vi.fn(async (_method: string, params?: Record<string, any>) => ({ settings: params?.settings }));
    render(<ServiceSettings values={{ stationCall: "OM0RX" }} request={request} onSaved={vi.fn()} cwContext={context} />);
    fireEvent.click(screen.getByRole("tab", { name: "CW" }));
    fireEvent.change(screen.getByLabelText("CW button label"), { target: { value: "My CQ" } });
    fireEvent.change(screen.getByLabelText("CW shortcut"), { target: { value: "F1" } });
    fireEvent.change(screen.getByLabelText("CW button colour"), { target: { value: "pink" } });
    fireEvent.click(screen.getByLabelText("Show selected macro buttons on Operator Desk"));
    expect(screen.getByLabelText("Expanded CW preview").textContent).toBe("CQ CQ DE OM0RX OM0RX K");
    fireEvent.click(screen.getByRole("tab", { name: "Station" }));
    fireEvent.click(screen.getByRole("tab", { name: "CW" }));
    expect((screen.getByLabelText("CW button label") as HTMLInputElement).value).toBe("My CQ");
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request.mock.calls[0][0]).toBe("settings_save");
    expect(request.mock.calls[0][1]?.settings.cwProfile).toMatchObject({ showOnDesk: true,
      macros: [expect.objectContaining({ label: "My CQ", shortcut: "F1", color: "pink" }), ...defaultCWProfile.macros.slice(1)] });
  });

  it("rejects duplicate shortcuts before any persistence or device request", async () => {
    const request = vi.fn();
    render(<ServiceSettings values={{}} request={request} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "CW" }));
    fireEvent.change(screen.getByLabelText("CW shortcut"), { target: { value: "F1" } });
    fireEvent.click(screen.getByRole("tab", { name: /^Call/ }));
    fireEvent.change(screen.getByLabelText("CW shortcut"), { target: { value: "F1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByText(/Shortcut F1 is already assigned/);
    expect(request).not.toHaveBeenCalled();
  });

  it("adds exactly twenty slots, navigates them by keyboard and removes safely", () => {
    function Editor() { const [profile, setProfile] = useState<CWProfile>({ ...defaultCWProfile, macros: [] }); return <CWSettings value={profile} onChange={setProfile} />; }
    render(<Editor />);
    expect(screen.getByText(/Add a macro to create your first message/)).toBeTruthy();
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Add CW macro" }));
    expect((screen.getByRole("button", { name: "Add CW macro" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByRole("tab")).toHaveLength(20);
    fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "Home" });
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("Macro 1");
    expect(document.activeElement).toBe(screen.getByRole("tab", { selected: true }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Macro 1 macro" }));
    expect(screen.getAllByRole("tab")).toHaveLength(19);
  });

  it("keyer connection needs saved port and explicit fresh consent; edits cannot connect", async () => {
    const request = vi.fn(async () => ({}));
    const saved = { ...defaultCWProfile, output: "winkeyer" as const, winkeyer: { port: "TEST-ONLY", wpm: 20 } };
    function Editor() { const [profile, setProfile] = useState<CWProfile>(saved); return <CWSettings value={profile} saved={saved} onChange={setProfile} request={request} />; }
    render(<Editor />);
    const button = screen.getByRole("button", { name: "Connect WinKeyer" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I have checked the port/));
    expect(button.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("WinKeyer serial port"), { target: { value: "ANOTHER-TEST" } });
    expect(button.disabled).toBe(true);
    expect((screen.getByLabelText(/I have checked the port/) as HTMLInputElement).checked).toBe(false);
    expect(request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("WinKeyer serial port"), { target: { value: "TEST-ONLY" } });
    fireEvent.click(screen.getByLabelText(/I have checked the port/));
    fireEvent.click(button);
    await waitFor(() => expect(request).toHaveBeenCalledExactlyOnceWith("winkeyer_connect", { port: "TEST-ONLY", confirm_serial_control: true }));
  });
});
