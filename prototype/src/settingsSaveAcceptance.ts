import { waitForAcceptance } from "./acceptance";
import { checkedSettingsSnapshot } from "./live/settingsSession";

type Json = Record<string, any>;
type Dependencies = {
  worker: (method: string) => Promise<Json>;
  edit: () => Promise<void>;
  save: () => Promise<void>;
  diagnostics: Json;
  root?: ParentNode;
  wait?: typeof waitForAcceptance;
};

const coordinates = (value: any) => ({
  generation: typeof value?.generation === "string" ? value.generation.slice(0, 64) : null,
  revision: Number.isSafeInteger(value?.revision) ? value.revision : null,
  stationCall: typeof value?.settings?.stationCall === "string" ? value.settings.stationCall.slice(0, 64) : null,
});

function submission(form: HTMLElement) {
  const raw = form.dataset.settingsSaveAttempt;
  const attempt = raw !== undefined && /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(attempt)) throw new Error("Settings save completion identity is unavailable");
  return { attempt, status: form.dataset.settingsSaveStatus ?? "unknown" };
}

/** Observe one rendered save, then read once after its acknowledged completion.
 * Never treat draft text, an old toast, or eventual value polling as durability. */
export async function verifySettingsSave(
  { worker, edit, save, diagnostics, root = document, wait = waitForAcceptance }: Dependencies,
  stationCall: string,
) {
  const started = performance.now();
  try {
    const form = root.querySelector<HTMLElement>(".service-settings");
    if (!form) throw new Error("Settings form is unavailable");
    const previous = submission(form);
    const expectedAttempt = previous.attempt + 1;
    const baseline = (await worker("settings_load")).result;
    diagnostics.before = coordinates(baseline);
    const before = checkedSettingsSnapshot(baseline);
    diagnostics.expected = {
      generation: before.generation,
      revision: before.revision + (before.settings.stationCall === stationCall ? 0 : 1),
      stationCall, attempt: expectedAttempt,
    };
    await edit();
    await save();
    await wait("confirmed settings save", () => {
      if (!form.isConnected || root.querySelector(".service-settings") !== form)
        throw new Error("Settings form changed before save completion");
      const current = submission(form);
      diagnostics.completion = { ...current, elapsedMs: Math.round(performance.now() - started) };
      if (current.attempt < expectedAttempt) return false;
      if (current.attempt !== expectedAttempt) throw new Error("Settings save completion belongs to another submission");
      if (["failed", "conflict", "workspace_changed"].includes(current.status))
        throw new Error("Settings save was not applied: " + current.status);
      return current.status === "applied";
    });

    // This is the sole post-completion read. An incorrect value stays a failure.
    const result = (await worker("settings_load")).result;
    diagnostics.readback = coordinates(result);
    const after = checkedSettingsSnapshot(result);
    diagnostics.matched = after.generation === before.generation &&
      after.revision === diagnostics.expected.revision && after.settings.stationCall === stationCall;
    return diagnostics.matched === true;
  } finally { diagnostics.elapsedMs = Math.round(performance.now() - started); }
}
