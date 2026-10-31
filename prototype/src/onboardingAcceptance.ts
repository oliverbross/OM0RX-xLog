type Json = Record<string, any>;
export const acceptanceStation = { operatorCall: "K1TEST", stationCall: "K1TEST/P", gridSquare: "FN31PR", stationLocation: "Isolated acceptance fixture", defaultPower: "100" } as const;
export function validFirstRunReadback(value: Json): boolean {
  return value.settings?.onboardingCompleted === true && value.settings.logbookMode === "local" && value.settings.automaticSync === false &&
    Object.entries(acceptanceStation).every(([key, expected]) => value.settings[key] === expected) &&
    Number.isSafeInteger(value.revision) && value.revision > 0 && typeof value.generation === "string";
}

/** Drive the actual first-run controls. The driver has no create/save/device
 * shortcut: only Finish setup admits the application's ordinary save owner. */
export async function verifyFirstRunSetup(api: {
  fill: (selector: string, value: string) => Promise<void>; click: (name: string) => Promise<void>;
  wait: (label: string, condition: () => boolean) => Promise<void>;
  waitWorker: (label: string, condition: () => Promise<boolean>) => Promise<void>;
  worker: (method: string) => Promise<Json>;
}) {
  await api.wait("first-run station setup", () => !!document.querySelector('[aria-label="First-run station setup"]'));
  for (const label of ["Operator call", "Station call", "Station grid (optional)", "Station location (optional)"]) {
    if (document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)?.value !== "") throw new Error(`Fresh setup unexpectedly contains ${label}`);
  }
  for (const [label, value] of [
    ["Operator call", acceptanceStation.operatorCall], ["Station call", acceptanceStation.stationCall],
    ["Station grid (optional)", acceptanceStation.gridSquare], ["Station location (optional)", acceptanceStation.stationLocation],
    ["Default power W", acceptanceStation.defaultPower],
  ]) await api.fill(`[aria-label="${label}"]`, value);
  await api.click("Continue");
  await api.wait("optional radio setup", () => document.querySelector<HTMLSelectElement>('[aria-label="Setup radio connection"]')?.value === "skip");
  await api.click("Skip radio");
  await api.wait("optional rotator setup", () => document.querySelector<HTMLSelectElement>('[aria-label="Setup rotator connection"]')?.value === "skip");
  await api.click("Skip rotator");
  await api.wait("integrated local logbook choice", () => document.querySelector<HTMLSelectElement>('[aria-label="Setup logbook mode"]')?.value === "local");
  await api.click("Finish setup");
  let saved: Json | null = null;
  await api.waitWorker("durable first-run setup completion", async () => {
    const value = (await api.worker("settings_load")).result;
    if (!validFirstRunReadback(value)) return false;
    saved = value; return true;
  });
  const workspace = (await api.worker("workspace_status")).result;
  if (workspace.workspace_exists !== true || workspace.first_run_eligible !== false || workspace.generation !== saved!.generation)
    throw new Error("Completed first-run settings did not match the created workspace.");
  await api.wait("completed setup dismissed", () => !document.querySelector('[aria-label="First-run station setup"]'));
  return { completed: true, initialIdentityBlank: true, radioSkipped: true, rotatorSkipped: true, localMode: true,
    settingsRevision: saved!.revision, generation: saved!.generation, station: acceptanceStation };
}
