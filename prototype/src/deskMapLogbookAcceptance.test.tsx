// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyDeskMapLogbook } from "./deskMapLogbookAcceptance";
import { DeskMapLogbook } from "./live/DeskMapLogbook";
import { LogbookPanel } from "./live/LogbookPanel";
import { LogbookMutationSession } from "./live/logbookMutationSession";
import { deskMapLogbookKey } from "./live/deskMapLogbookPreferences";
import { logbookColumnsKey } from "./live/logbookColumnPreferences";
import { testWorkspaceGeneration } from "../tests/operator-draft-fixture";

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
let height = 610;
beforeEach(() => {
  localStorage.clear(); height = 610;
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.closest("[hidden]") ? [] : [{ width: 1280, height }]) as unknown as DOMRectList;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: height, width: 1280, height, toJSON() {},
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

async function setup(options: { changedDraft?: boolean; utcOnly?: boolean; leakColumns?: boolean; omitChoice?: boolean; replaceMap?: boolean; transientDividerBlock?: boolean } = {}) {
  let reads = 0, mount = 0, dividerAttempts = 0;
  const draft = { generation: testWorkspaceGeneration, revision: 2, qso: {
    id: "12345678-1234-4234-8234-123456789abc", call: "", start: "2026-10-14T00:00:00Z", end: "2026-10-14T00:00:00Z",
    band: "20m", mode: "CW", txPower: "100", notes: "Retain draft notes", extraFields: { APP_TEST: "retain" },
  } };
  const qso = { ...draft.qso, id: "22345678-1234-4234-8234-123456789abc", call: "W1AW", country: "United States",
    frequencyHz: 14025000, rstSent: "599", rstReceived: "599", comment: "Private acceptance fixture" };
  const request = vi.fn(async (method: string) => {
    if (method === "logbook_list") return { qsos: [structuredClone(qso)], total: 1, offset: 0, limit: 20 };
    if (method === "logbook_operator_draft") {
      const value = structuredClone(draft);
      if (reads++ > 0) {
        if (options.changedDraft) value.qso.notes = "Unexpected mutation";
        if (options.utcOnly) { value.revision++; value.qso.start = value.qso.end = "2026-10-14T00:00:01Z"; }
      }
      return { draft: value };
    }
    throw new Error(`Forbidden acceptance worker method: ${method}`);
  });
  const mutations = new LogbookMutationSession(request, () => {});
  function Harness({ route }: { route: string }) {
    const panel = (desk: boolean) => <LogbookPanel onRequest={request} onEdit={() => { throw new Error("Unexpected contact edit"); }}
      refreshKey={0} mutations={mutations} columnContext={desk && !options.leakColumns ? "desk" : "docked"} />;
    return <main aria-label={route}>{route === "Operator Desk"
      ? <DeskMapLogbook map={<div className="map-wrap"><canvas /><span>Offline synthetic map</span></div>} logbook={panel(true)}
          canChangeView={() => !options.transientDividerBlock || dividerAttempts++ !== 4} />
      : panel(false)}</main>;
  }
  const rendered = render(<Harness route="Operator Desk" />);
  const routes: string[] = [];
  const controls = {
    worker: async (method: string) => ({ result: await request(method) }),
    navigate: async (route: string) => { routes.push(route); await act(async () => {
      rendered.rerender(<Harness route={route} key={++mount} />); await frame();
    });
      if (options.omitChoice && route === "Operator Desk") document.querySelector('option[value="logbook-above"]')?.remove();
    },
    fill: async (selector: string, value: string) => { await act(async () => {
      const input = document.querySelector(selector); if (!input) throw new Error(`Missing ${selector}`);
      fireEvent.change(input, { target: { value } }); await frame();
    });
      if (options.replaceMap && value === "logbook") {
        const map = document.querySelector(".desk-map-logbook-map .map-wrap"); map?.replaceWith(map.cloneNode(true));
      }
    },
    click: async (name: string, selector = "button") => {
      let button: HTMLButtonElement | undefined;
      await waitFor(() => { button = [...document.querySelectorAll<HTMLButtonElement>(selector)]
        .find(item => item.textContent?.trim() === name && !!item.getClientRects().length); expect(button && !button.disabled).toBe(true); });
      await act(async () => { fireEvent.click(button!); await frame(); });
    },
  };
  return { controls, request, routes };
}

it("proves rendered choices, actual table retention, isolated columns, keyboard split and route persistence with read-only worker access", async () => {
  const context = await setup({ utcOnly: true });
  const evidence = await verifyDeskMapLogbook(context.controls);
  expect(evidence).toMatchObject({ choices: ["Map", "Logbook", "Logbook + Previous QSO's", "Logbook above map", "Logbook below map"],
    retainedMap: true, retainedTable: true, columnsIndependent: true, keyboardDivider: true,
    routeRemount: true, restoredMap: true, sameDraft: true, stationIO: false });
  expect(evidence.columnWidth).toBeGreaterThan(150);
  expect(evidence.maximum).toBeGreaterThan(evidence.minimum);
  expect(context.request.mock.calls.every(([method]) => ["logbook_list", "logbook_operator_draft"].includes(method))).toBe(true);
  expect(context.routes).toEqual(["Logbook", "Operator Desk", "Logbook", "Operator Desk"]);
  expect(JSON.parse(localStorage.getItem(deskMapLogbookKey)!).view).toBe("map");
  expect(JSON.parse(localStorage.getItem(logbookColumnsKey("desk"))!).columns).toHaveLength(11);
  expect(JSON.parse(localStorage.getItem(logbookColumnsKey("docked"))!).columns).toHaveLength(11);
});
it("retries an idempotent rendered divider target after a transient workspace veto", async () => {
  const context = await setup({ transientDividerBlock: true });
  const evidence = await verifyDeskMapLogbook(context.controls);
  expect(evidence.keyboardDivider).toBe(true);
  expect(evidence.maximum).toBeGreaterThan(evidence.minimum);
});
it("fails rather than certifying a changed draft note", async () => {
  const context = await setup({ changedDraft: true });
  await expect(verifyDeskMapLogbook(context.controls)).rejects.toThrow("changed the shared draft");
});
it("fails when Desk changes docked preferences instead of its independent normal columns", async () => {
  const context = await setup({ leakColumns: true });
  await expect(verifyDeskMapLogbook(context.controls)).rejects.toThrow("changed docked preferences");
});
it("fails when one of the four actual rendered choices is absent", async () => {
  const context = await setup({ omitChoice: true });
  await expect(verifyDeskMapLogbook(context.controls)).rejects.toThrow("four Desk");
});
it("fails if a host replaces the actual Map DOM while hiding it", async () => {
  const context = await setup({ replaceMap: true });
  await expect(verifyDeskMapLogbook(context.controls)).rejects.toThrow("remounted the retained Map or table");
});
it("reports the legitimate fixed minimum as requiring native sizing, never a keyboard-change pass", async () => {
  height = 300; const context = await setup(); height = 300;
  await expect(verifyDeskMapLogbook(context.controls)).rejects.toThrow("fixed minimum");
});
it("requires a valid cleared canonical draft before any navigation", async () => {
  const navigate = vi.fn(), fill = vi.fn(), click = vi.fn();
  await expect(verifyDeskMapLogbook({ worker: async () => ({ result: {} }), navigate, fill, click })).rejects.toThrow("verified cleared");
  expect(navigate).not.toHaveBeenCalled(); expect(fill).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
});
