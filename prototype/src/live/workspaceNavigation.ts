import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import screens from "./workspaceScreens.json";
export const workspaceScreens = screens;
// Keep legacy routes valid without displaying their former top-level entries.
export const workspaceMenuScreens = screens.filter(screen => !screen.hidden);
type Navigation = { revision: number; screen: string };
export function validWorkspaceNavigation(value: any): value is Navigation {
  return value && Number.isSafeInteger(value.revision) && value.revision > 0 &&
    workspaceScreens.some(screen => screen.id === value.screen);
}
type Transport = { read: () => Promise<unknown>; ack: (revision: number) => Promise<unknown>;
  listen: (wake: () => void) => Promise<() => void> };

/** Subscribe before reading; native state retains the latest request until ack. */
export function connectWorkspaceNavigation(navigate: (title: string) => boolean | void, failed: (message: string) => void,
  transport?: Transport, onReadinessChange?: (retry: () => void) => () => void): () => void {
  if (!transport && !isTauri()) return () => {};
  const api = transport ?? { read: () => invoke("workspace_navigation_snapshot"),
    ack: (revision: number) => invoke("workspace_navigation_ack", { revision }),
    listen: (wake: () => void) => listen("xlog:workspace-navigation", wake) };
  let active = true, last = 0, reading = false, again = false, deferred = false;
  let unlisten: (() => void) | undefined;
  const refresh = async () => {
    if (!active) return;
    if (reading) { again = true; return; }
    reading = true;
    try {
      do {
        again = false;
        const value = await api.read();
        if (!active) return;
        if (value === null) { deferred = false; continue; }
        if (!validWorkspaceNavigation(value)) throw new Error("The native menu destination could not be verified.");
        if (value.revision > last) {
          // A new main renderer can receive Dock before its editor registry is
          // ready. A guarded refusal is not delivery: retain the native intent
          // and retry only after a readiness notification, never by bypassing
          // the editor guard or flushing/discarding its fields.
          if (navigate(workspaceScreens.find(screen => screen.id === value.screen)!.title) === false) {
            deferred = true; continue;
          }
          last = value.revision;
        }
        deferred = false;
        await api.ack(value.revision);
      } while (active && again);
    } catch (error) { if (active) failed(error instanceof Error ? error.message : "Native menu navigation is unavailable."); }
    finally { reading = false; }
  };
  void api.listen(() => void refresh()).then(stop => {
    if (!active) { stop(); return; }
    unlisten = stop; void refresh();
  }).catch(error => { if (active) failed(error instanceof Error ? error.message : "Native menus could not connect."); });
  const stopReadiness = onReadinessChange?.(() => { if (deferred) void refresh(); });
  return () => { active = false; stopReadiness?.(); unlisten?.(); };
}
