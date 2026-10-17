// @vitest-environment jsdom
import { useState } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import QSOEditor, { safeProfileURL } from "./QSOEditor";
import { defaultQSOCanvasLayout, qsoCanvasLayoutKey } from "./qsoCanvasLayout";
import { qsoDetailsFieldsKey } from "./qsoEditorPreferences";
const editorCSS = readFileSync("src/live/QSOEditor.css", "utf8");

const initial = () => ({
  id: "qso-1", call: "EA7EU", start: "2026-10-12T10:20:30Z", end: null,
  band: "20m", mode: "CW", submode: "", frequencyHz: 14025000, receiveFrequencyHz: null,
  rstSent: "599", rstReceived: "599", extraFields: { APP_XLOG_NOTE: "retained" },
  customQSOKey: { retain: true },
});
function Harness({ save = vi.fn(), lookup = null, previous = [], request, onReadRadio, automaticStationMetadata, isEditing }: { save?: () => void; lookup?: Record<string, any> | null; previous?: Record<string, any>[];
  request?: (method: string, params?: Record<string, any>) => Promise<any>; onReadRadio?: () => Promise<void> | void;
  automaticStationMetadata?: Array<{label: string; value: string; provenance: "observed" | "configured" | "selected"}>; isEditing?: boolean }) {
  const [draft, setDraft] = useState<Record<string, any> | null>(initial());
  const [follow, setFollow] = useState(true);
  return <><QSOEditor draft={draft} setDraft={setDraft} save={save} clear={() => setDraft(initial())} busy={false} lookup={lookup} previous={previous} follow={follow} setFollow={setFollow} request={request} onReadRadio={onReadRadio} automaticStationMetadata={automaticStationMetadata} isEditing={isEditing} /><output data-testid="draft">{JSON.stringify(draft)}</output></>;
}
const value = () => JSON.parse(screen.getByTestId("draft").textContent || "{}");
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("QSOEditor", () => {
  it("places active contact, details, intelligence, previous QSOs and matrices on the configurable canvas", () => {
    const { container } = render(<Harness />);
    const details = container.querySelector(".qso-details")!, matrices = container.querySelector(".qso-matrices")!;
    expect(details.closest('[aria-label="QSO details panel"]')).toBeTruthy();
    expect(matrices.closest('[aria-label="Band / mode matrix panel"]')).toBeTruthy();
    expect(matrices.querySelectorAll(".qso-matrix-section")).toHaveLength(2);
    expect(container.querySelectorAll(".qso-canvas-panel")).toHaveLength(5);
    expect(editorCSS).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
  });
  it("moves a panel by keyboard in Arrange mode and persists the geometry", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x:0, y:0, top:0, left:0, right:1440, bottom:1120, width:1440, height:1120, toJSON: () => ({}) });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Arrange panels" }));
    const move = screen.getByRole("button", { name: "Move Active contact" });
    fireEvent.keyDown(move, { key: "ArrowRight" }); fireEvent.keyUp(move, { key: "ArrowRight" });
    const saved = JSON.parse(localStorage.getItem(qsoCanvasLayoutKey)!);
    expect(saved.panels.find((panel: any) => panel.id === "active-contact").rect.x).toBe(8);
  });
  it("resizes and resets the saved layout, then restores normal form interaction", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x:0, y:0, top:0, left:0, right:1440, bottom:1120, width:1440, height:1120, toJSON: () => ({}) });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Arrange panels" }));
    const resize = screen.getByRole("button", { name: "Resize QSO details right edge" });
    fireEvent.keyDown(resize, { key: "ArrowLeft" }); fireEvent.keyUp(resize, { key: "ArrowLeft" });
    let saved = JSON.parse(localStorage.getItem(qsoCanvasLayoutKey)!);
    expect(saved.panels.find((panel: any) => panel.id === "qso-details").rect.width).toBe(992);
    fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
    saved = JSON.parse(localStorage.getItem(qsoCanvasLayoutKey)!);
    expect(saved).toEqual(defaultQSOCanvasLayout());
    fireEvent.click(screen.getByRole("button", { name: "Finish arranging" }));
    expect(screen.queryByRole("button", { name: /Move Active contact/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "VK8AA" } });
    expect(value().call).toBe("VK8AA");
  });
  it("honours Display settings field visibility while retaining core logging controls", () => {
    localStorage.setItem(qsoDetailsFieldsKey, JSON.stringify({ version: 1, fields: ["name"] }));
    render(<Harness />);
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.queryByLabelText("Gridsquare")).toBeNull();
    expect(screen.queryByRole("heading", { name: "References & notes" })).toBeNull();
    expect(screen.getByLabelText("Callsign")).toBeTruthy();
    expect(screen.getByLabelText("Frequency MHz")).toBeTruthy();
  });
  it("does not label an empty callsign as a pending lookup", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "" } });
    expect(screen.queryByText("Lookup pending")).toBeNull();
    expect(screen.getAllByText("Enter a callsign").length).toBeGreaterThan(0);
  });
  it("shows the duplicate advisory below the reference fields instead of in the panel header", async () => {
    const request = vi.fn(async (method: string) => method === "logbook_duplicate"
      ? { call: "EA7EU", band: "20m", mode: "CW", last_worked_at: "2026-01-02T23:55:00Z" }
      : method === "logbook_matrix" ? { cells: [] } : {});
    render(<Harness request={request} />);
    const warning = await screen.findByText("Dupe: Worked on 02/01/26");
    const references = screen.getByRole("heading", { name: "References & notes" }).parentElement!;
    expect(references.contains(warning)).toBe(true);
    expect(screen.getByLabelText("POTA").compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Active contact" }).parentElement?.contains(warning)).toBe(false);
  });
  it("shows matched QRZ details below a full-width safe photo without mutating the QSO draft", () => {
    const profile = { call: "EA7EU", source: "QRZ XML", name: "Operator name", country: "Spain", gridSquare: "IM67AA", dxcc: 281,
      imageURL: "https://cdn-bio.qrz.com/e/ea7eu/photo.jpg", nickname: "On-air nickname", websiteURL: "https://station.example.com/", qslManager: "EA1AAA", iota: "EU-005", licenseClass: "Full", qth: "Seville", state: "Andalusia", county: "Seville", email: "radio@example.com" };
    render(<Harness lookup={profile} />);
    const inspector = within(screen.getByRole("complementary", { name: "Contact context" }));
    const image = inspector.getByRole("img", { name: "EA7EU QRZ profile photo" });
    expect(image.getAttribute("src")).toBe(profile.imageURL);
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image.className).toBe("qso-profile-photo");
    const trigger = image.closest("button")!;
    expect(trigger.nextElementSibling?.className).toBe("qso-profile-identity");
    expect(editorCSS).toContain(".qso-profile-photo { display:block; width:100%; height:auto;");
    expect(editorCSS).toContain(".qso-profile-identity { min-width:0; text-align:right; overflow-wrap:anywhere;");
    for (const detail of ["Operator name", "QRZ XML", "On-air nickname", "EA1AAA", "EU-005", "Full", "radio@example.com"]) expect(inspector.getByText(detail)).toBeTruthy();
    expect(inspector.getByRole("link", { name: "Station website" }).getAttribute("rel")).toBe("noopener noreferrer");
    expect(value()).toEqual(initial());
  });
  it("collapses unavailable and failed QRZ photos and ignores another call's profile", () => {
    const view = render(<Harness lookup={{ call: "EA7EU", source: "QRZ XML", imageURL: "https://cdn-bio.qrz.com/e/ea7eu/photo.jpg" }} />);
    fireEvent.error(screen.getByRole("img", { name: "EA7EU QRZ profile photo" }));
    expect(screen.queryByRole("img", { name: "EA7EU QRZ profile photo" })).toBeNull();
    view.rerender(<Harness lookup={{ call: "OTHER", source: "QRZ XML stale", name: "Wrong operator", imageURL: "https://cdn-bio.qrz.com/x/photo.jpg" }} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("Wrong operator")).toBeNull();
    expect(screen.queryByText("QRZ XML stale")).toBeNull();
    view.rerender(<Harness lookup={{ call: "EA7EU", source: "CTY approximate", country: "Spain" }} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("CTY approximate")).toBeTruthy();
  });
  it("rejects unsafe profile links and photo URLs before rendering", () => {
    expect(safeProfileURL("https://cdn-bio.qrz.com/a/photo.jpg")).toBe("https://cdn-bio.qrz.com/a/photo.jpg");
    for (const url of ["http://cdn.qrz.com/photo.jpg", "javascript:alert(1)", "data:image/svg+xml,hi", "https://user:password@cdn.qrz.com/photo.jpg", "https://127.0.0.1/photo.jpg", "https://[::1]/photo.jpg", "https://localhost/photo.jpg", "https://shack.local/photo.jpg", "https://internal.lan/photo.jpg", "https://xmldata.qrz.com/xml/current/?s=key", "https://cdn.qrz.com:8443/photo.jpg", "https://cdn.qrz.com/photo.jpg#fragment"]) expect(safeProfileURL(url)).toBeNull();
    render(<Harness lookup={{ call: "EA7EU", source: "QRZ XML", imageURL: "https://127.0.0.1/photo.jpg", websiteURL: "javascript:alert(1)" }} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("link", { name: "Station website" })).toBeNull();
  });
  it("warns about differing draft country/DXCC while profile and matrices stay on matching lookup evidence", async () => {
    const request = vi.fn(async (method: string) => method === "logbook_matrix" ? { cells: [] } : { history: { call: "EA7EU", adif: 281, matrix: [] } });
    render(<Harness lookup={{ call: "EA7EU", source: "QRZ XML", country: "Spain", dxcc: 281 }} request={request} />);
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "ENGLAND" } });
    fireEvent.change(screen.getByLabelText("DXCC"), { target: { value: "223" } });
    await within(screen.getByRole("region", { name: "Band / mode matrix" })).findByText("Spain · DXCC 281");
    expect(screen.getByText(/Draft country\/DXCC differs from this lookup/)).toBeTruthy();
    expect(value()).toMatchObject({ country: "ENGLAND", dxcc: 223 });
    expect(within(screen.getByRole("complementary", { name: "Contact context" })).getByText("Spain")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("cluster_history", { call: "EA7EU", adif: 281 });
  });
  it("keeps the native active contact, three detail columns, and right-hand context visible together", () => {
    render(<Harness />);
    for (const heading of ["Active contact", "QSO details", "Contact & location", "References & notes", "Station & QSL",
      "Callsign intelligence", "Previous QSOs", "Band / mode matrix"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "Station" })).toBeNull();
    expect(screen.getByText("Saved to your local logbook.")).toBeTruthy();
  });
  it("renders only supplied station context with explicit provenance", () => {
    const view = render(<Harness />);
    expect(screen.queryByText("Station context")).toBeNull();
    view.rerender(<Harness automaticStationMetadata={[
      { label: "TX power", value: "75 W", provenance: "observed" },
      { label: "Antenna path", value: "A", provenance: "selected" },
    ]} isEditing />);
    expect(screen.getByText("Station context")).toBeTruthy();
    expect(screen.getByText("75 W")).toBeTruthy();
    expect(screen.getByText("selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update QSO" })).toBeTruthy();
  });
  it("reads authoritative call and country matrices, not the six displayed previous QSOs", async () => {
    const request = vi.fn(async (method: string) => method === "logbook_matrix"
      ? { cells: [{ band: "20m", mode: "CW", worked: true, confirmed: false }] }
      : { history: { call: "EA7EU", adif: 281, matrix: [{ band: "80m", mode: "FT8", worked: true, confirmed: true }] } });
    render(<Harness lookup={{ call: "EA7EU", country: "Spain", dxcc: 281 }} previous={[]} request={request} />);
    await waitFor(() => expect(screen.getByLabelText("Country 80m FT8: Confirmed")).toBeTruthy());
    expect(screen.getByLabelText("Callsign 20m CW: Worked")).toBeTruthy();
    expect(screen.getByLabelText("Callsign 80m FT8: Unworked")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("logbook_matrix", { call: "EA7EU" });
    expect(request).toHaveBeenCalledWith("cluster_history", { call: "EA7EU", adif: 281 });
    expect(screen.getByText("No matching QSO is in the loaded local history.")).toBeTruthy();
  });
  it("does not render missing or mismatched country evidence as unworked", async () => {
    const request = vi.fn(async (method: string) => method === "logbook_matrix" ? { cells: [] }
      : { history: { call: "OTHER", adif: 281, matrix: [] } });
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
  it("does not clear the next draft's manual buffer after an earlier radio read finishes", async () => {
    let finish: null | (() => void) = null;
    const props = { draft: initial(), setDraft: vi.fn(), save: vi.fn(), clear: vi.fn(), busy: false,
      lookup: null, previous: [], follow: false, setFollow: vi.fn(), onReadRadio: () => new Promise<void>(resolve => { finish = resolve; }) };
    const view = render(<QSOEditor {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
    view.rerender(<QSOEditor {...props} draft={{ ...initial(), id: "next-draft", frequencyHz: 7025000, band: "40m" }} />);
    fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "manual-invalid" } });
    (finish as unknown as () => void)();
    await waitFor(() => expect((screen.getByRole("button", { name: "Read radio" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText("Frequency MHz") as HTMLInputElement).value).toBe("manual-invalid");
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
  it("keeps the screenshot's compact five-band / three-mode matrices identically shaped without extra status chips", async () => {
    const request = vi.fn(async (method: string) => method === "logbook_matrix" ? { cells: [
      { band: "17m", mode: "FT4", worked: true, confirmed: false }, { band: "20m", mode: "CW", worked: true, confirmed: false },
    ] } : { history: { call: "EA7EU", adif: 281, matrix: [{ band: "6m", mode: "FM", worked: true, confirmed: true }, { band: "80m", mode: "FT8", worked: true, confirmed: true }] } });
    const { container } = render(<Harness lookup={{ call: "EA7EU", country: "A deliberately long but authentic country name", dxcc: 281 }} request={request} />);
    await screen.findByLabelText("Country 80m FT8: Confirmed");
    expect(screen.getByLabelText("Callsign 20m CW: Worked")).toBeTruthy(); expect(screen.queryByLabelText("Callsign 17m FT4: Worked")).toBeNull();
    const callTable = screen.getByRole("table", { name: "Callsign band and mode status" }), countryTable = screen.getByRole("table", { name: "Country band and mode status" });
    expect(within(callTable).getAllByRole("columnheader").map(node => node.textContent)).toEqual(within(countryTable).getAllByRole("columnheader").map(node => node.textContent));
    expect(within(callTable).getAllByRole("columnheader").map(node => node.textContent)).toEqual(["Mode", "80m", "40m", "20m", "15m", "10m"]);
    expect(within(callTable).getAllByRole("rowheader").map(node => node.textContent)).toEqual(["CW", "SSB", "FT8"]);
    expect(within(callTable).getAllByRole("rowheader").map(node => node.textContent)).toEqual(within(countryTable).getAllByRole("rowheader").map(node => node.textContent));
    expect(callTable.querySelectorAll("td").length).toBe(countryTable.querySelectorAll("td").length);
    expect(container.querySelectorAll(".qso-matrix-heading")).toHaveLength(2); expect(container.querySelector(".qso-matrix-other")).toBeNull();
    expect(container.querySelectorAll(".qso-matrix-legend")).toHaveLength(2);
    expect(editorCSS).toContain("grid-template-rows:16px 18px"); expect(editorCSS).toContain(".qso-matrix-section+.qso-matrix-section { padding-left:0; border-left:0; }");
    expect(value()).toEqual(initial());
  });
  it("opens the full-width photo in a safe full-size modal, traps focus, closes on Escape and restores focus", () => {
    const save = vi.fn(), photo = "https://cdn-bio.qrz.com/e/ea7eu/photo.jpg";
    render(<Harness save={save} lookup={{ call: "EA7EU", imageURL: photo, source: "QRZ XML" }} />);
    const trigger = screen.getByRole("button", { name: "View full-size QRZ photo for EA7EU" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(editorCSS).not.toContain("width:176px"); expect(editorCSS).not.toContain("max-height:208px");
    trigger.focus(); fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Full-size QRZ photo for EA7EU" });
    const image = within(dialog).getByRole("img", { name: "EA7EU full-size QRZ profile photo" });
    expect(image.getAttribute("src")).toBe(photo); expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close photo" }));
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true }); expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Close photo" }));
    fireEvent.keyDown(dialog, { key: "Enter", metaKey: true }); expect(save).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" }); expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(trigger);
    expect(value()).toEqual(initial());
  });
  it("closes the photo on explicit close, image failure or changed callsign without reopening a stale image", () => {
    const profile = { call: "EA7EU", imageURL: "https://cdn-bio.qrz.com/e/ea7eu/photo.jpg", source: "QRZ XML" };
    const { rerender } = render(<Harness lookup={profile} />);
    fireEvent.click(screen.getByRole("button", { name: "View full-size QRZ photo for EA7EU" })); fireEvent.click(screen.getByRole("button", { name: "Close photo" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View full-size QRZ photo for EA7EU" }));
    rerender(<Harness lookup={{ ...profile, call: "OTHER" }} />); expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<Harness lookup={profile} />); expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View full-size QRZ photo for EA7EU" }));
    fireEvent.error(screen.getByRole("img", { name: "EA7EU full-size QRZ profile photo" }));
    expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.queryByRole("img")).toBeNull(); expect(screen.queryByRole("button", { name: "View full-size QRZ photo for EA7EU" })).toBeNull();
  });
  it("aligns previous contact columns and renders Worked orange / Confirmed green at the mode's font size", () => {
    render(<Harness previous={[
      { id: "worked", call: "EA7EU", start: "2026-10-12T10:20:00Z", band: "160m", mode: "FT4", qslReceived: "N", lotwReceived: "N" },
      { id: "confirmed", call: "EA7EU", start: "2026-10-11T09:00:00Z", band: "6m", mode: "SSB", qslReceived: "Y", lotwReceived: "N" },
    ]} />);
    const history = screen.getByRole("heading", { name: "Previous QSOs" }).closest("section")!;
    const worked = within(history).getByText("Worked"), confirmed = within(history).getByText("Confirmed");
    expect(worked.className).toBe("qso-history-worked"); expect(confirmed.className).toBe("qso-history-confirmed");
    expect(worked.tagName).toBe("SPAN"); expect(worked.parentElement?.children).toHaveLength(4); expect(confirmed.parentElement?.children).toHaveLength(4);
    expect(editorCSS).toContain("grid-template-columns:minmax(0,1fr) 42px 40px 74px"); expect(editorCSS).toContain(".qso-history-worked { color:#ff8c00; }");
    expect(editorCSS).toContain(".qso-history-confirmed { color:#12d6a0; }"); expect(editorCSS).toContain("font-size:inherit");
    expect(history.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-12T10:20:00Z");
    expect(value()).toEqual(initial());
  });
  it("edits across native field groups and retains unknown QSO and ADIF keys", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "7.025000" } });
    expect(value().frequencyHz).toBe(7025000);
    expect(value().band).toBe("40m");
    fireEvent.change(screen.getByLabelText("Station location"), { target: { value: "Home" } });
    fireEvent.change(screen.getByLabelText("RX frequency MHz"), { target: { value: "7.035000" } });
    fireEvent.change(screen.getByLabelText("DXCC"), { target: { value: "281" } });
    fireEvent.change(screen.getByLabelText("POTA"), { target: { value: "EA-0001" } });
    fireEvent.change(screen.getByLabelText("QSO note"), { target: { value: "First line\nSecond line" } });
    fireEvent.change(screen.getByLabelText("QSL received"), { target: { value: "Y" } });
    fireEvent.click(screen.getByText("Additional QSO fields, timing and ADIF metadata"));
    fireEvent.change(screen.getByLabelText("ADIF APP_XLOG_NOTE"), { target: { value: "changed" } });
    expect(value()).toMatchObject({ stationLocation: "Home", receiveFrequencyHz: 7035000, dxcc: 281,
      potaReference: "EA-0001", notes: "First line\nSecond line", qslReceived: "Y",
      extraFields: { APP_XLOG_NOTE: "changed" }, customQSOKey: { retain: true } });
  });

  it("soft-wraps notes without changing long words, whitespace or explicit newlines", () => {
    const { container } = render(<Harness />);
    const notes = screen.getByLabelText("QSO note") as HTMLTextAreaElement;
    const text = `First line\n  ${"long-unbroken-note".repeat(80)}\nLast line  `;
    expect(notes.wrap).toBe("soft");
    fireEvent.change(notes, { target: { value: text } });
    expect(notes.value).toBe(text);
    expect(value().notes).toBe(text);
    expect(container.querySelectorAll("input[placeholder], textarea[placeholder]")).toHaveLength(0);
    expect(screen.getByLabelText("RST sent")).toBeTruthy();
    expect(editorCSS).toContain("white-space:pre-wrap; overflow-wrap:anywhere;");
  });

  it("adds and removes arbitrary ADIF fields without overwriting case-insensitive or native names", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Additional QSO fields, timing and ADIF metadata"));
    const name = screen.getByLabelText("New ADIF field name");
    const add = () => fireEvent.click(screen.getByRole("button", { name: "Add ADIF field" }));
    for (const key of ["call", "APP_xlog_note", "EOR", "bad:name"]) {
      fireEvent.change(name, { target: { value: key } }); add();
      expect(value().extraFields).toEqual(initial().extraFields);
    }
    fireEvent.change(name, { target: { value: "sat_name" } });
    expect(screen.getByRole("button", { name: "Log QSO" }).hasAttribute("disabled")).toBe(true);
    add();
    fireEvent.change(screen.getByLabelText("ADIF SAT_NAME"), { target: { value: "  QO-100\nnotes  " } });
    expect(value().extraFields).toEqual({ ...initial().extraFields, SAT_NAME: "  QO-100\nnotes  " });
    fireEvent.click(screen.getByRole("button", { name: "Remove ADIF SAT_NAME" }));
    expect(value().extraFields).toEqual(initial().extraFields);
    expect(value().customQSOKey).toEqual({ retain: true });
  });

  it("removes only the selected extension and its metadata, preserving unrelated typed ADIF metadata", () => {
    const extension = (name: string) => ({ kind: "APP", attributes: { PROGRAMID: "TEST", FIELDNAME: name, TYPE: "S" } });
    const metadata = { version: 1, extensions: { APP_TEST_ONE: extension("ONE"), APP_TEST_TWO: extension("TWO") } };
    function MetadataHarness() {
      const [draft, setDraft] = useState<Record<string, any> | null>({ ...initial(), end: "2026-10-12T10:25:00Z",
        receiveFrequencyHz: 14_030_000, receiveBand: "20m", antennaPath: "S", qslMessage: "73", extraFields: {
        CALL: "EA7EU", QSO_DATE_OFF: "20261012", TIME_OFF: "102500", FREQ: "14.025000", FREQ_RX: "14.030000", BAND_RX: "20m",
        ANT_PATH: "S", QSLMSG: "73", APP_TEST_ONE: "one", APP_TEST_TWO: "two",
      }, adifFieldMetadata: metadata });
      return <><QSOEditor draft={draft} setDraft={setDraft} save={vi.fn()} clear={vi.fn()} busy={false} lookup={null} previous={[]} follow={false} setFollow={vi.fn()} /><output data-testid="draft">{JSON.stringify(draft)}</output></>;
    }
    render(<MetadataHarness />);
    fireEvent.click(screen.getByText("Additional QSO fields, timing and ADIF metadata"));
    for (const field of ["CALL", "QSO_DATE_OFF", "TIME_OFF", "FREQ", "FREQ_RX", "BAND_RX", "ANT_PATH", "QSLMSG"])
      expect(screen.queryByLabelText(`ADIF ${field}`)).toBeNull();
    fireEvent.change(screen.getByLabelText("RX band"), { target: { value: "" } });
    expect(value().receiveFrequencyHz).toBe(14_030_000);
    expect(value().receiveBand).toBe("");
    expect(value().extraFields.FREQ_RX).toBe("14.030000");
    expect(value().extraFields.BAND_RX).toBeUndefined();
    fireEvent.change(screen.getByLabelText("RX frequency MHz"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Antenna path"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("QSL message"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("End UTC date"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("End UTC time"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Frequency MHz"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove ADIF APP_TEST_ONE" }));
    expect(value().extraFields).toEqual({ CALL: "EA7EU", APP_TEST_TWO: "two" });
    expect(value().adifFieldMetadata).toEqual({ version: 1, extensions: { APP_TEST_TWO: metadata.extensions.APP_TEST_TWO } });
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
    fireEvent.click(screen.getByText("Additional QSO fields, timing and ADIF metadata"));
    for (const fields of Object.values(textFields)) {
      for (const [label, key] of fields) {
        const text = key === "email" ? "operator@example.org" : `${key}-value`;
        fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
        expected[key] = ["operatorCall", "myCall", "myGrid", "gridSquare"].includes(key) ? text.toUpperCase() : text;
      }
    }
    fireEvent.change(screen.getByLabelText("Submode"), { target: { value: "Q65" } }); expected.submode = "Q65";
    fireEvent.change(screen.getByLabelText("RX frequency MHz"), { target: { value: "14.030000" } }); expected.receiveFrequencyHz = 14030000;
    fireEvent.change(screen.getByLabelText("RX band"), { target: { value: "20m" } }); expected.receiveBand = "20m";
    fireEvent.change(screen.getByLabelText("DXCC"), { target: { value: "281" } }); expected.dxcc = 281;
    fireEvent.change(screen.getByLabelText("Continent"), { target: { value: "EU" } }); expected.continent = "EU";
    for (const [label, key, value] of [["QSL sent", "qslSent", "Y"], ["QSL received", "qslReceived", "V"],
      ["QSL method", "qslMethod", "B"], ["LoTW sent", "lotwSent", "Q"], ["LoTW received", "lotwReceived", "Y"]]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } }); expected[key] = value;
    }
    expect(value()).toMatchObject(expected);
    expect(value()).toMatchObject({ id: "qso-1", extraFields: { APP_XLOG_NOTE: "retained" }, customQSOKey: { retain: true } });
  });

  it("keeps UTC date and time typed without local timezone conversion", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Additional QSO fields, timing and ADIF metadata"));
    fireEvent.change(screen.getByLabelText("Start UTC date"), { target: { value: "2026-10-13" } });
    fireEvent.change(screen.getByLabelText("Start UTC time"), { target: { value: "23:45:12" } });
    fireEvent.change(screen.getByLabelText("End UTC date"), { target: { value: "2026-10-14" } });
    fireEvent.change(screen.getByLabelText("End UTC time"), { target: { value: "00:05:12" } });
    expect(value().start).toBe("2026-10-13T23:45:12Z");
    expect(value().end).toBe("2026-10-14T00:05:12Z");
  });

  it("fills only empty fields for an exact matching callsign", () => {
    render(<Harness lookup={{ call: "ea7eu", name: "Lookup Name", country: "Spain", dxcc: 281 }} previous={[{ call: "OTHER", band: "40m", mode: "CW" }]} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Operator Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Fill empty fields from lookup" }));
    expect(value()).toMatchObject({ name: "Operator Name", country: "Spain", dxcc: 281 });
    expect(screen.getByText("No matching QSO is in the loaded local history.")).toBeTruthy();
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
    fireEvent.keyDown(screen.getByLabelText("QSO note"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Callsign")));
  });
});
