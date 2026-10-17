// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import RadioSpotSettings from "./RadioSpotSettings";

afterEach(cleanup);

it("migrates an old FLEX preference and saves a DXCC colour policy without claiming TCI output", async () => {
  const configuration: { forwardSpotsToFlex: boolean; radioSpotColorPolicy?: string; palette: { status: Record<string, string> } } =
    { forwardSpotsToFlex: true, palette: { status: { ATNO: "#123456" } } };
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "cluster_snapshot") return { configuration, flex_forwarding_available: true,
      forwarding: { accepted_count: 2, status: "Accepted by Remote Station Agent; FLEX display is not verified." } };
    if (method === "cluster_radio_spots_configure") {
      expect(params).toEqual({ color_policy: "dxcc", color_policy_expected: "callsign",
        status_colors: { ATNO: "#654321" }, status_color_expected: { ATNO: "#123456" } });
      configuration.radioSpotColorPolicy = "dxcc";
      Object.assign(configuration.palette.status, params?.status_colors);
      return {};
    }
    throw new Error(method);
  });
  render(<RadioSpotSettings request={request} visible />);
  expect(await screen.findByText(/2 accepted by agent/)).toBeTruthy();
  expect((screen.getByLabelText("Radio spot colour status") as HTMLSelectElement).value).toBe("callsign");
  fireEvent.change(screen.getByLabelText("Radio spot colour status"), { target: { value: "dxcc" } });
  const atno = screen.getByLabelText("ATNO radio spot colour") as HTMLInputElement;
  expect(atno.value).toBe("#123456");
  fireEvent.change(atno, { target: { value: "#654321" } });
  expect((screen.getByLabelText("New Call radio spot colour") as HTMLInputElement).value).toBe("#ff6b35");
  fireEvent.click(screen.getByRole("button", { name: "Save radio spot output" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("cluster_radio_spots_configure", {
    color_policy: "dxcc", color_policy_expected: "callsign",
    status_colors: { ATNO: "#654321" }, status_color_expected: { ATNO: "#123456" },
  }));
  expect(screen.getByText(/no TCI spot output transport/)).toBeTruthy();
  expect((screen.getByRole("checkbox", { name: /Send spots through TCI/ }) as HTMLInputElement).disabled).toBe(true);
});

it("keeps colour edits when refreshing runtime status and sends only changed palette entries", async () => {
  const request = vi.fn(async () => ({ configuration: { forwardSpotsToFlex: false,
    palette: { status: { "New Call": "#010203", Worked: "#111111" } } }, flex_forwarding_available: true }));
  render(<RadioSpotSettings request={request} visible />);
  const edited = await screen.findByLabelText("New Call radio spot colour") as HTMLInputElement;
  await waitFor(() => expect(edited.value).toBe("#010203"));
  fireEvent.change(edited, { target: { value: "#040506" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(edited.value).toBe("#040506");
  expect((screen.getByLabelText("Worked radio spot colour") as HTMLInputElement).value).toBe("#111111");
});

it("a stale Settings window saves only its edited field", async () => {
  let configuration = { forwardSpotsToFlex: false, radioSpotColorPolicy: "callsign",
    palette: { status: { ATNO: "#123456" } } };
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "cluster_snapshot") return { configuration: structuredClone(configuration), flex_forwarding_available: true };
    if (method === "cluster_radio_spots_configure") {
      if (params?.flex_enabled !== undefined) configuration.forwardSpotsToFlex = params.flex_enabled as boolean;
      if (params?.color_policy !== undefined) configuration.radioSpotColorPolicy = params.color_policy as string;
      if (params?.status_colors) Object.assign(configuration.palette.status, params.status_colors);
      return {};
    }
    throw new Error(method);
  });
  const { container } = render(<><RadioSpotSettings request={request} visible /><RadioSpotSettings request={request} visible /></>);
  const [first, second] = Array.from(container.querySelectorAll<HTMLElement>(".service-radio-spots"));
  await waitFor(() => expect(within(first).getByRole("button", { name: "Save radio spot output" }).hasAttribute("disabled")).toBe(true));
  fireEvent.click(within(first).getByRole("checkbox", { name: /Forward spots through/ }));
  fireEvent.click(within(first).getByRole("button", { name: "Save radio spot output" }));
  await waitFor(() => expect(configuration.forwardSpotsToFlex).toBe(true));
  fireEvent.change(within(second).getByLabelText("ATNO radio spot colour"), { target: { value: "#abcdef" } });
  fireEvent.click(within(second).getByRole("button", { name: "Save radio spot output" }));
  await waitFor(() => expect(configuration.palette.status.ATNO).toBe("#abcdef"));
  expect(configuration.forwardSpotsToFlex).toBe(true);
  const writes = request.mock.calls.filter(([method]) => method === "cluster_radio_spots_configure");
  expect(writes[1][1]).toEqual({ status_colors: { ATNO: "#abcdef" }, status_color_expected: { ATNO: "#123456" } });
});
