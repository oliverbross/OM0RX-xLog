import { waitForAcceptance } from "./acceptance";

export const workspaceDraftMarker = "Unsaved workspace layout acceptance";
type Controls = {
  fill: (selector: string, value: string) => Promise<void>;
  click: (name: string, selector?: string) => Promise<void>;
};
const scope = '.detached-logbook-app main[aria-label="Detached Logbook"]';
const commentSelector = `${scope} .qso-editor input[aria-label="Comment"]`;
const editor = () => document.querySelector(`${scope} .qso-editor`);
const comment = () => document.querySelector<HTMLInputElement>(commentSelector);
const update = () => [...document.querySelectorAll<HTMLButtonElement>(`${scope} .qso-editor button`)]
  .find(button => button.textContent?.trim() === "Update QSO");
const targetRow = () => [...document.querySelectorAll<HTMLTableRowElement>(`${scope} .live-logbook-table tbody tr`)]
  .find(row => row.querySelector(".live-logbook-call")?.textContent?.trim() === "W1AW");

/** Isolated acceptance only: drive the real editor without saving a contact.
 * The hidden-window probe reads DOM synchronously and needs no animation frame. */
export function createLogbookLayoutAcceptance({ fill, click }: Controls): (action: string) => Promise<Record<string, unknown>> {
  let originalComment: string | null = null;
  const probe = () => {
    if (originalComment === null || originalComment === workspaceDraftMarker || !editor()
      || comment()?.value !== workspaceDraftMarker || !update())
      throw new Error("The unsaved detached Logbook edit was not retained.");
    return { originalComment, draftComment: workspaceDraftMarker, dirty: true };
  };
  return async action => {
    if (action === "editor_probe") return probe();
    if (action === "editor_prepare") {
      if (editor()) throw new Error("An existing detached Logbook edit must be resolved before acceptance.");
      await waitForAcceptance("existing W1AW detached Logbook row", () => !!targetRow());
      targetRow()!.click();
      await waitForAcceptance("detached Logbook contact editor", () => !!comment() && !!update() && !update()!.disabled);
      originalComment = comment()!.value;
      if (originalComment === workspaceDraftMarker) throw new Error("The contact already contains the acceptance marker; a dirty edit cannot be proved.");
      await fill(commentSelector, workspaceDraftMarker);
      await waitForAcceptance("unsaved detached Logbook comment", () => comment()?.value === workspaceDraftMarker);
      return probe();
    }
    if (action === "editor_cancel") {
      probe();
      await click("Cancel edit", `${scope} .qso-editor button`);
      await waitForAcceptance("detached Logbook editor cancelled", () => !editor() && !!targetRow());
      originalComment = null;
      return { cancelled: true };
    }
    throw new Error(`Unknown detached Logbook layout acceptance action: ${action}`);
  };
}
