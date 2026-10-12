// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServiceSettings from "./ServiceSettings";
afterEach(cleanup);
const values = { operatorCall: "OM0RX", stationCall: "OM0RX", wavelogURL: "https://example.invalid", wavelogStationID: 1, qrzUsername: "operator", qrzEnabled: true, clubLogCTYURL: "https://example.invalid/cty", lotwActivityURL: "https://example.invalid/lotw", preservedUnknown: "retain" };
describe("grouped service settings", () => {
  it("shows existing service URL, station and login values together without fetching credentials", () => {
    const request = vi.fn();
    render(<ServiceSettings values={values} request={request} onSaved={vi.fn()} />);
    expect((screen.getByLabelText("Wavelog URL") as HTMLInputElement).value).toBe(values.wavelogURL);
    expect((screen.getByLabelText("QRZ username") as HTMLInputElement).value).toBe("operator");
    expect(screen.getByText(/not a Club Log QSO uploader/)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
  it("saves a credential separately, clears its input and never sends it with settings", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, any>) => method === "settings_save" ? { settings: params?.settings } : { saved: true });
    const saved = vi.fn();
    render(<ServiceSettings values={values} request={request} onSaved={saved} />);
    const token = screen.getByLabelText("Wavelog API v2 token") as HTMLInputElement;
    fireEvent.change(token, { target: { value: "unit-test-only-not-a-real-secret" } });
    fireEvent.keyDown(token, { key: "Enter" });
    await screen.findByText("Wavelog API v2 token saved securely.");
    expect(token.type).toBe("password"); expect(token.value).toBe("");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("secret_save", { account: "wavelog-token", value: "unit-test-only-not-a-real-secret" });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(values));
    expect(request).toHaveBeenLastCalledWith("settings_save", { settings: values });
  });
});
