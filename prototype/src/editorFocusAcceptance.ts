// Isolated acceptance only. The native menu owns navigation; synthetic DOM
// key events cannot exercise an OS accelerator or open its detached window.
import { waitForAcceptance } from "./acceptance";
import { sameDraftValue, validScopedSnapshot } from "./live/operatorDraftSession";

type Controls = { navigate: (title: string) => Promise<void>; worker: (method: string) => Promise<any> };
const selector = 'main[aria-label="Log QSO"] .qso-call input';
export async function verifyEditorFocus({ navigate, worker }: Controls) {
  const before = (await worker("logbook_operator_draft"))?.result?.draft;
  if (!validScopedSnapshot(before)) throw new Error("The shared draft could not be verified before editor focus acceptance.");
  await navigate("Log QSO");
  await waitForAcceptance("editable full editor", () => {
    const input = document.querySelector<HTMLInputElement>(selector);
    return !!input && !input.disabled && !input.closest("[inert]");
  });
  const comment = document.querySelector<HTMLInputElement>('main[aria-label="Log QSO"] input[aria-label="Comment"]');
  if (!comment) throw new Error("The full editor comment field is missing.");
  comment.focus();
  if (document.activeElement !== comment) throw new Error("The full editor comment field could not receive focus.");
  comment.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await waitForAcceptance("full editor Escape focus", () => document.activeElement === document.querySelector(selector));
  const after = (await worker("logbook_operator_draft"))?.result?.draft;
  if (!validScopedSnapshot(after) || !sameDraftValue(before, after)) throw new Error("Editor focus acceptance changed the shared draft.");
  return { entry: "native-menu-route", screen: "log-qso", focusAction: "Escape", physicalAccelerator: false, sameDraft: true };
}
