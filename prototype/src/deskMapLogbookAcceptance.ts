// Private packaged acceptance only: presentation writes use rendered controls;
// the worker is used exclusively to read the canonical draft.
import { waitForAcceptance } from "./acceptance";
import { deskMapLogbookKey, deskMapLogbookViews } from "./live/deskMapLogbookPreferences";
import { logbookColumnsKey } from "./live/logbookColumnPreferences";
import { sameDraftValue, validScopedSnapshot } from "./live/operatorDraftSession";

type Controls = {
  worker: (method: string) => Promise<any>;
  navigate: (title: string) => Promise<void>;
  fill: (selector: string, value: string) => Promise<void>;
  click: (name: string, selector?: string) => Promise<void>;
};
const selector = '[aria-label="Desk map and logbook view"]';
const root = () => document.querySelector<HTMLElement>(".desk-map-logbook");
function required<T extends Element>(query: string): T {
  const value = document.querySelector<T>(query);
  if (!value) throw new Error(`Missing Desk Map/Logbook evidence: ${query}`);
  return value;
}
const headers = (table: Element) => [...table.querySelectorAll("thead th > span:first-child")].map(item => item.textContent?.trim());
// Empty drafts legitimately refresh their UTC start/end as the clock advances.
// All identity, contact, power, note and extra fields must still be unchanged.
function contactValue(snapshot: any) {
  const { start: _start, end: _end, ...qso } = snapshot.qso;
  return { generation: snapshot.generation, qso, power: snapshot.power };
}
export async function verifyDeskMapLogbook({ worker, navigate, fill, click }: Controls) {
  const before = (await worker("logbook_operator_draft"))?.result?.draft;
  if (!validScopedSnapshot(before) || before.qso.call !== "") throw new Error("Desk acceptance requires the verified cleared shared draft.");
  await navigate("Logbook");
  await waitForAcceptance("docked W1AW table", () => !!document.querySelector(".live-logbook-table tbody tr")?.textContent?.includes("W1AW"));
  const dockedHeaders = headers(required(".live-logbook-table"));
  const dockedPreferences = localStorage.getItem(logbookColumnsKey("docked"));
  await navigate("Operator Desk");
  const originalRoot = required<HTMLElement>(".desk-map-logbook");
  const choices = [...required<HTMLSelectElement>(selector).options].map(option => [option.value, option.text]);
  if (!sameDraftValue(choices, deskMapLogbookViews)) throw new Error("The four Desk Map/Logbook choices are not rendered.");
  const map = required<HTMLElement>(".desk-map-logbook-map .map-wrap");
  await fill(selector, "logbook");
  await waitForAcceptance("Desk W1AW table", () => !!document.querySelector(".desk-map-logbook-logbook tbody tr")?.textContent?.includes("W1AW"));
  const table = required<HTMLTableElement>(".desk-map-logbook-logbook .live-logbook-table");
  if (!sameDraftValue(headers(table), ["UTC", "Callsign", "Band / Mode", "Frequency", "Country"])) throw new Error("Desk compact columns are not rendered independently.");
  function panes(view: string) {
    const mapPane = required<HTMLElement>(".desk-map-logbook-map"), logPane = required<HTMLElement>(".desk-map-logbook-logbook");
    if (root() !== originalRoot || document.querySelector(".desk-map-logbook-map .map-wrap") !== map ||
      document.querySelector(".desk-map-logbook-logbook .live-logbook-table") !== table) throw new Error("Desk switching remounted the retained Map or table.");
    if (mapPane.hidden !== (view === "logbook") || logPane.hidden !== (view === "map") ||
      mapPane.hasAttribute("inert") !== mapPane.hidden || logPane.hasAttribute("inert") !== logPane.hidden ||
      (!mapPane.hidden && !mapPane.getClientRects().length) || (!logPane.hidden && !logPane.getClientRects().length)) throw new Error("Desk pane visibility/inert evidence disagrees with the selected view.");
    if (view.startsWith("logbook-")) {
      const above = view === "logbook-above";
      if (logPane.style.gridRow !== (above ? "1" : "3") || mapPane.style.gridRow !== (above ? "3" : "1")) throw new Error("Desk pane order did not follow the rendered choice.");
    }
  }
  panes("logbook");
  for (const view of ["map", "logbook-above", "logbook-below"]) { await fill(selector, view); panes(view); }
  await click("Columns", ".desk-map-logbook-logbook button");
  const rst = required<HTMLInputElement>('.desk-map-logbook-logbook [aria-label="Show RST column"]');
  if (rst.checked) throw new Error("Desk RST column unexpectedly enabled before acceptance.");
  rst.click();
  await waitForAcceptance("Desk RST column", () => headers(table).includes("RST"));
  await click("Done", ".desk-map-logbook-logbook button");
  if (localStorage.getItem(logbookColumnsKey("docked")) !== dockedPreferences) throw new Error("Desk columns changed docked preferences.");
  const divider = required<HTMLElement>('[aria-label="Map and Logbook height"]');
  if (divider.getAttribute("aria-disabled") !== "false") throw new Error("Desk divider is at the fixed minimum; acceptance needs a usable native window height.");
  const key = async (value: string) => {
    await waitForAcceptance(`Desk divider ${value} persisted`, () => {
      const current = required<HTMLElement>('[aria-label="Map and Logbook height"]');
      const stored = JSON.parse(localStorage.getItem(deskMapLogbookKey) || "null");
      const shown = Number(current.getAttribute("aria-valuenow"));
      const target = Number(current.getAttribute(value === "Home" ? "aria-valuemin" : "aria-valuemax"));
      if (!!stored && Math.abs(stored.logbookPercent - shown) <= 0.51 && shown === target) return true;
      // Layout, editor and logbook owners can briefly veto presentation writes
      // while settling. The target is idempotent; retry the rendered keyboard
      // action only after the divider is visibly enabled instead of certifying
      // an ignored event or weakening persistence evidence.
      if (current.getAttribute("aria-disabled") === "false") {
        current.focus();
        current.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
      }
      return false;
    });
    return Number(required('[aria-label="Map and Logbook height"]').getAttribute("aria-valuenow"));
  };
  const minimum = await key("Home"), maximum = await key("End");
  if (!(maximum > minimum)) throw new Error("Desk keyboard divider did not change height.");
  const saved = localStorage.getItem(deskMapLogbookKey), deskColumns = localStorage.getItem(logbookColumnsKey("desk"));
  await navigate("Logbook");
  await waitForAcceptance("docked table after Desk preferences", () => !!document.querySelector(".live-logbook-table tbody tr"));
  if (root() || !sameDraftValue(headers(required(".live-logbook-table")), dockedHeaders) ||
    localStorage.getItem(logbookColumnsKey("docked")) !== dockedPreferences) throw new Error("Desk preferences leaked into the docked Logbook.");
  await navigate("Operator Desk");
  await waitForAcceptance("restored Desk table", () => !!document.querySelector(".desk-map-logbook-logbook tbody tr"));
  if (root() === originalRoot || required<HTMLSelectElement>(selector).value !== "logbook-below" ||
    localStorage.getItem(deskMapLogbookKey) !== saved || localStorage.getItem(logbookColumnsKey("desk")) !== deskColumns ||
    Number(required('[aria-label="Map and Logbook height"]').getAttribute("aria-valuenow")) !== maximum ||
    !headers(required(".desk-map-logbook-logbook .live-logbook-table")).includes("RST")) throw new Error("Desk choice, split or columns did not survive route remount.");
  await click("Columns", ".desk-map-logbook-logbook button");
  required<HTMLInputElement>('.desk-map-logbook-logbook [aria-label="Show RST column"]').click();
  await click("Done", ".desk-map-logbook-logbook button");
  await fill(selector, "map");
  const after = (await worker("logbook_operator_draft"))?.result?.draft;
  if (!validScopedSnapshot(after) || !sameDraftValue(contactValue(before), contactValue(after))) throw new Error("Desk Map/Logbook acceptance changed the shared draft.");
  return { choices: choices.map(([, label]) => label), retainedMap: true, retainedTable: true, columnsIndependent: true,
    keyboardDivider: true, minimum, maximum, routeRemount: true, restoredMap: true, sameDraft: true, stationIO: false };
}
