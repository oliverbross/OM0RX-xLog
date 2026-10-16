// Isolated packaged acceptance only. Hidden legacy routes are not native menu items.
import { waitForAcceptance } from "./acceptance";
import { workspaceMenuScreens } from "./live/workspaceNavigation";

type Json = Record<string, any>;
type Controls = {
  worker: (method: string, params?: Json) => Promise<Json>;
  navigate: (name: string) => Promise<void>;
  click: (name: string, selector?: string) => Promise<void>;
};
const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const same = (left: unknown, right: unknown) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));

export async function verifyWorkspaceMenuRoutes({ worker, navigate, click }: Controls) {
  const settings = (await worker("settings_load")).result?.settings;
  const draft = (await worker("logbook_operator_draft")).result?.draft;
  if (!settings || settings.logbookMode !== "local" || !draft?.qso?.id)
    throw new Error("Missing isolated local settings/draft fixture for native menu acceptance.");
  // navigate() requires the actual native menu item before following the
  // production navigation path. Do not invent a menu entry for hidden Sync.
  for (const screen of workspaceMenuScreens) await navigate(screen.title);
  await navigate("Settings");
  await click("Sync", '[role="tab"]');
  await waitForAcceptance("Settings Sync section", () => {
    const main = document.querySelector('main[aria-label="Settings"]');
    const selected = [...(main?.querySelectorAll('[role="tab"]') ?? [])].some(tab =>
      tab.textContent?.trim() === "Sync" && tab.getAttribute("aria-selected") === "true");
    const notice = [...(main?.querySelectorAll('[role="tabpanel"] p') ?? [])].some(item =>
      !item.closest("[hidden]") && item.textContent?.startsWith("Integrated-only mode. Wavelog synchronization is disabled."));
    return selected && notice;
  });
  if (!same(settings, (await worker("settings_load")).result?.settings)
    || !same(draft, (await worker("logbook_operator_draft")).result?.draft))
    throw new Error("Menu navigation or Settings Sync changed the settings or operator draft.");
  return { nativeRoutes: workspaceMenuScreens.map(screen => screen.id), settingsSync: true,
    settingsUnchanged: true, draftUnchanged: true, stationIO: false };
}
