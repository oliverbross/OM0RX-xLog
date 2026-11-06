import { waitForAcceptance } from "./acceptance";

type Controls = {
  fill: (selector: string, value: string) => Promise<void>;
  click: (name: string, selector?: string) => Promise<void>;
};
const selector = '[aria-label="Desk layout"]';
const recoverySelector = '.canvas-recovery[role="alert"]';
function control() {
  const value = document.querySelector<HTMLSelectElement>(selector);
  if (!value) throw new Error("Missing rendered Desk layout control.");
  return value;
}
function reviewedRecovery() {
  const alert = document.querySelector(recoverySelector);
  if (!alert) return null;
  const message = alert.querySelector("span")?.textContent?.trim();
  if (message === "The workspace changed after editing began. Reload and review it before saving.") return "Reload layout";
  if (message === "Another window changed the layout. Your intended change is retained for review.") return "Use saved layout";
  throw new Error("Unexpected canvas recovery state; acceptance cannot retry it.");
}

function recoveryFailure(name: string, cause: unknown) {
  const current = document.querySelector<HTMLSelectElement>(selector);
  const alert = document.querySelector(recoverySelector);
  const state = {
    capturedAt: Date.now(),
    layout: current ? { value: current.value, disabled: current.disabled } : null,
    message: alert?.querySelector("span")?.textContent?.trim() ?? null,
    status: document.querySelector('.canvas-toolbar [role="status"]')?.textContent?.trim() ?? null,
    buttons: [...(alert?.querySelectorAll<HTMLButtonElement>("button") ?? [])].map(button => ({
      name: button.textContent?.trim(), disabled: button.disabled, visible: button.getClientRects().length > 0,
    })),
  };
  return new Error(`Unavailable canvas recovery control: ${name}. ${cause instanceof Error ? cause.message : String(cause)}; canvas=${JSON.stringify(state)}`);
}

/** Packaged acceptance only; drive the real controls and explicit recovery. */
export async function selectCustomCanvas({ fill, click }: Controls) {
  await fill(selector, "custom");
  await waitForAcceptance("custom canvas or reviewed layout conflict", () => {
    const current = control();
    return reviewedRecovery() !== null || current.value === "custom" && !current.disabled;
  });
  const recovery = reviewedRecovery();
  if (recovery) {
    // A conflict can render before the outer layout operation clears working.
    // Wait for this reviewed action without replaying the pending mutation.
    try {
      await waitForAcceptance(`enabled canvas recovery control: ${recovery}`, () => {
        if (reviewedRecovery() !== recovery) throw new Error("Canvas recovery state changed before its action was ready.");
        const button = [...document.querySelectorAll<HTMLButtonElement>(`${recoverySelector} button`)]
          .find(item => item.textContent?.trim() === recovery);
        if (!button) throw new Error("Recovery control is missing.");
        return !button.disabled;
      });
    } catch (cause) { throw recoveryFailure(recovery, cause); }
    await click(recovery, `${recoverySelector} button`);
    await waitForAcceptance("fresh saved layout adopted", () => {
      const current = control();
      return reviewedRecovery() === null && current.value === "traditional" && !current.disabled;
    });
    // Exactly one new selection after an explicit reviewed read/discard. A
    // second rejection remains a failure; this is not a mutation retry loop.
    await fill(selector, "custom");
  }
  await waitForAcceptance("custom canvas acknowledged", () => {
    if (document.querySelector(recoverySelector)) throw new Error("Custom canvas was not acknowledged after reviewed recovery.");
    const current = control();
    return current.value === "custom" && !current.disabled;
  });
  return { layoutConflictRecovered: recovery !== null };
}
