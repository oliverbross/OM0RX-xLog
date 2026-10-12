// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import QSOEditor from "./QSOEditor";

const initial = () => ({
  id: "qso-1", call: "EA7EU", start: "2026-10-12T10:20:30Z", end: null,
  band: "20m", mode: "CW", submode: "", frequencyHz: 14025000, receiveFrequencyHz: null,
  rstSent: "599", rstReceived: "599", extraFields: { APP_XLOG_NOTE: "retained" },
  customQSOKey: { retain: true },
});
function Harness({ save = vi.fn(), lookup = null, previous = [], request, onReadRadio }: { save?: () => void; lookup?: Record<string, any> | null; previous?: Record<string, any>[];
  request?: (method: string, params?: Record<string, any>) => Promise<any>; onReadRadio?: () => Promise<void> | void }) {
  const [draft, setDraft] = useState<Record<string, any> | null>(initial());
  const [follow, setFollow] = useState(true);
  return <><QSOEditor draft={draft} setDraft={setDraft} save={save} clear={() => setDraft(initial())} busy={false} lookup={lookup} previous={previous} follow={follow} setFollow={setFollow} request={request} onReadRadio={onReadRadio} /><output data-testid="draft">{JSON.stringify(draft)}</output></>;
}
const value = () => JSON.parse(screen.getByTestId("draft").textContent || "{}");
afterEach(cleanup);

describe("QSOEditor", () => {
  it("reads authoritative call and country matrices, not the six displayed previous QSOs", async () => {
    const request = vi.fn(async (method: string) => method === "logbook_matrix"
      ? { cells: [{ band: "20m", mode: "CW", worked: true, confirmed: false }] }
      : { call: "EA7EU", adif: 281, matrix: [{ band: "80m", mode: "FT8", worked: true, confirmed: true }] });
    render(<Harness lookup={{ call: "EA7EU", country: "Spain", dxcc: 281 }} previous={[]} request={request} />);
    await waitFor(() => expect(screen.getByLabelText("Country 80m FT8: Confirmed")).toBeTruthy());
    expect(screen.getByLabelText("Callsign 20m CW: Worked")).toBeTruthy();
    expect(screen.getByLabelText("Callsign 80m FT8: Unworked")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("logbook_matrix", { call: "EA7EU" });
    expect(request).toHaveBeenCalledWith("cluster_history", { call: "EA7EU", adif: 281 });
    expect(screen.getByText("No local history for this call.")).toBeTruthy();
  });
  it("does not render missing or mismatched country evidence as unworked", async () => {
    const request = vi.fn(async (method: string) => method === "logbook_matrix" ? { cells: [] }
      : { call: "OTHER", adif: 281, matrix: [] });
    render(<Harness lookup={{ call: "EA7EU", country: "Spain", dxcc: 281 }} request={request} />);
    await waitFor(() => expect(screen.getByText("Country history response does not match this callsign.")).toBeTruthy());
    expect(screen.queryByLabelText("Country 80m FT8: Unworked")).toBeNull();
  });
  it("Read radio invokes only its supplied callback and leaves manual state intact on failure", async () => {
    const onReadRadio = vi.fn(async () => { throw new Error("Radio offline"); });
    render(<Harness onReadRadio={onReadRadio} />);
    fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "7.025000" } });
    fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
    await waitFor(() => expect(screen.getByText("Radio offline")).toBeTruthy());
    expect(onReadRadio).toHaveBeenCalledOnce();
    expect(value().frequencyHz).toBe(7025000);
    expect((screen.getByLabelText("Follow radio") as HTMLInputElement).checked).toBe(false);
  });
  it("discards the manual MHz buffer when radio following resumes", () => {
    const props = { draft: initial(), setDraft: vi.fn(), save: vi.fn(), clear: vi.fn(), busy: false,
      lookup: null, previous: [], follow: false, setFollow: vi.fn() };
    const view = render(<QSOEditor {...props} />);
    fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "7.025000" } });
    const observed = { ...props.draft, frequencyHz: 21019500, band: "15m" };
    view.rerender(<QSOEditor {...props} draft={observed} follow />);
    expect((screen.getByLabelText("Frequency MHz") as HTMLInputElement).value).toBe("21.019500");
    view.rerender(<QSOEditor {...props} draft={observed} follow={false} />);
    expect((screen.getByLabelText("Frequency MHz") as HTMLInputElement).value).toBe("21.019500");
  });
  it("suspends radio following as soon as an operator edits frequency, band or mode", () => {
    render(<Harness />);
    expect((screen.getByLabelText("Follow radio") as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "7.025000" } });
    expect((screen.getByLabelText("Follow radio") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText("Follow radio"));
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "SSB" } });
    expect((screen.getByLabelText("Follow radio") as HTMLInputElement).checked).toBe(false);
  });
  it("recognizes LoTW confirmation independently of a negative paper QSL", () => {
    render(<Harness previous={[{ call: "EA7EU", band: "20m", mode: "CW", qslReceived: "N", lotwReceived: "Y" }]} />);
    expect(screen.getByText("Confirmed")).toBeTruthy();
  });
  it("edits across native field groups and retains unknown QSO and ADIF keys", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "7.025000" } });
    expect(value().frequencyHz).toBe(7025000);
    expect(value().band).toBe("40m");
    fireEvent.click(screen.getByRole("button", { name: "Station" }));
    fireEvent.change(screen.getByLabelText("Station location"), { target: { value: "Home" } });
    fireEvent.change(screen.getByLabelText("RX frequency MHz"), { target: { value: "7.035000" } });
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.change(screen.getByLabelText("DXCC"), { target: { value: "281" } });
    fireEvent.click(screen.getByRole("button", { name: "References" }));
    fireEvent.change(screen.getByLabelText("POTA"), { target: { value: "EA-0001" } });
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    fireEvent.change(screen.getByLabelText("QSO note"), { target: { value: "First line\nSecond line" } });
    fireEvent.click(screen.getByRole("button", { name: "QSL" }));
    fireEvent.change(screen.getByLabelText("QSL received"), { target: { value: "Y" } });
    fireEvent.click(screen.getByRole("button", { name: "Metadata" }));
    fireEvent.change(screen.getByLabelText("ADIF APP_XLOG_NOTE"), { target: { value: "changed" } });
    expect(value()).toMatchObject({ stationLocation: "Home", receiveFrequencyHz: 7035000, dxcc: 281,
      potaReference: "EA-0001", notes: "First line\nSecond line", qslReceived: "Y",
      extraFields: { APP_XLOG_NOTE: "changed" }, customQSOKey: { retain: true } });
  });

  it("round-trips every exposed detail field through its native QSO key", () => {
    render(<Harness />);
    const textFields: Record<string, [string, string][]> = {
      Station: [["Station location", "stationLocation"], ["Radio", "radio"], ["TX power W", "txPower"],
        ["Operator", "operatorCall"], ["Station call", "myCall"], ["Station grid", "myGrid"],
        ["Propagation", "propagationMode"], ["Antenna path", "antennaPath"]],
      General: [["Name", "name"], ["Gridsquare", "gridSquare"], ["Country", "country"],
        ["CQ zone", "cqZone"], ["ITU zone", "ituZone"], ["State", "state"], ["County", "county"],
        ["Location", "qth"], ["Email", "email"]],
      References: [["POTA", "potaReference"], ["SOTA", "sotaReference"], ["IOTA", "iota"],
        ["WWFF", "wwffReference"], ["SIG", "sig"], ["SIG info", "sigInfo"], ["DOK", "dok"]],
      Notes: [["Comment", "comment"], ["QSO note", "notes"]],
      QSL: [["QSL via", "qslVia"], ["QSL message", "qslMessage"]],
    };
    const expected: Record<string, string | number> = {};
    for (const [tab, fields] of Object.entries(textFields)) {
      fireEvent.click(screen.getByRole("button", { name: tab }));
      for (const [label, key] of fields) {
        const text = key === "email" ? "operator@example.org" : `${key}-value`;
        fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
        expected[key] = ["operatorCall", "myCall", "myGrid", "gridSquare"].includes(key) ? text.toUpperCase() : text;
      }
    }
    fireEvent.click(screen.getByRole("button", { name: "QSO" }));
    fireEvent.change(screen.getByLabelText("Submode"), { target: { value: "Q65" } }); expected.submode = "Q65";
    fireEvent.click(screen.getByRole("button", { name: "Station" }));
    fireEvent.change(screen.getByLabelText("RX frequency MHz"), { target: { value: "14.030000" } }); expected.receiveFrequencyHz = 14030000;
    fireEvent.change(screen.getByLabelText("RX band"), { target: { value: "20m" } }); expected.receiveBand = "20m";
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.change(screen.getByLabelText("DXCC"), { target: { value: "281" } }); expected.dxcc = 281;
    fireEvent.change(screen.getByLabelText("Continent"), { target: { value: "EU" } }); expected.continent = "EU";
    fireEvent.click(screen.getByRole("button", { name: "QSL" }));
    for (const [label, key, value] of [["QSL sent", "qslSent", "Y"], ["QSL received", "qslReceived", "V"],
      ["QSL method", "qslMethod", "B"], ["LoTW sent", "lotwSent", "Q"], ["LoTW received", "lotwReceived", "Y"]]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } }); expected[key] = value;
    }
    expect(value()).toMatchObject(expected);
    expect(value()).toMatchObject({ id: "qso-1", extraFields: { APP_XLOG_NOTE: "retained" }, customQSOKey: { retain: true } });
  });

  it("keeps UTC date and time typed without local timezone conversion", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Start UTC date"), { target: { value: "2026-10-13" } });
    fireEvent.change(screen.getByLabelText("Start UTC time"), { target: { value: "23:45:12" } });
    fireEvent.change(screen.getByLabelText("End UTC date"), { target: { value: "2026-10-14" } });
    fireEvent.change(screen.getByLabelText("End UTC time"), { target: { value: "00:05:12" } });
    expect(value().start).toBe("2026-10-13T23:45:12Z");
    expect(value().end).toBe("2026-10-14T00:05:12Z");
  });

  it("fills only empty fields for an exact matching callsign", () => {
    render(<Harness lookup={{ call: "ea7eu", name: "Lookup Name", country: "Spain", dxcc: 281 }} previous={[{ call: "OTHER", band: "40m", mode: "CW" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Operator Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill empty fields from lookup" }));
    expect(value()).toMatchObject({ name: "Operator Name", country: "Spain", dxcc: 281 });
    expect(screen.getByText("No local history for this call.")).toBeTruthy();
  });

  it("blocks a stale lookup after callsign changes", () => {
    render(<Harness lookup={{ call: "EA7EU", country: "Spain" }} />);
    fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "OM0RX" } });
    expect(screen.getByRole("button", { name: "Fill empty fields from lookup" }).hasAttribute("disabled")).toBe(true);
    expect(value().country).toBeUndefined();
  });

  it("permits band-and-mode-only manual logging but rejects malformed nonblank frequency", () => {
    const save = vi.fn(); render(<Harness save={save} />);
    fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "" } });
    expect(value().frequencyHz).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Log QSO/ }));
    expect(save).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "not a frequency" } });
    expect(screen.getByRole("button", { name: /Log QSO/ }).hasAttribute("disabled")).toBe(true);
    expect(value().frequencyHz).toBeNull();
  });

  it("recognizes 4m frequency without a false band mismatch", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "70.200000" } });
    expect(value()).toMatchObject({ frequencyHz: 70200000, band: "4m" });
    expect(screen.getByRole("button", { name: /Log QSO/ }).hasAttribute("disabled")).toBe(false);
  });

  it("validates before save, then permits Command-Return and Escape focus", async () => {
    const save = vi.fn(); render(<Harness save={save} />);
    fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "NO" } });
    fireEvent.keyDown(screen.getByLabelText("Callsign"), { key: "Enter", metaKey: true });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("3–32 character callsign");
    fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "OM0RX" } });
    fireEvent.keyDown(screen.getByLabelText("Callsign"), { key: "Enter", metaKey: true });
    expect(save).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    fireEvent.keyDown(screen.getByLabelText("QSO note"), { key: "Escape" });
    expect(screen.getByRole("button", { name: "QSO" }).getAttribute("aria-current")).toBe("page");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Callsign")));
  });
});
