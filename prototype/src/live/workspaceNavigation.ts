import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import screens from "./workspaceScreens.json";
export const workspaceScreens = screens;
type Navigation = { revision: number; screen: string };
export function validWorkspaceNavigation(value: any): value is Navigation {
  return value && Number.isSafeInteger(value.revision) && value.revision > 0 &&
    workspaceScreens.some(screen => screen.id === value.screen);
}
type Transport = { read: () => Promise<unknown>; ack: (revision: number) => Promise<unknown>;
  listen: (wake: () => void) => Promise<() => void> };

/** Subscribe before reading; native state retains the latest request until ack. */
export function connectWorkspaceNavigation(navigate: (title: string) => void, failed: (message: string) => void,
  transport?: Transport): () => void {
  if (!transport && !isTauri()) return () => {};
  const api = transport ?? { read: () => invoke("workspace_navigation_snapshot"),
    ack: (revision: number) => invoke("workspace_navigation_ack", { revision }),
    listen: (wake: () => void) => listen("xlog:workspace-navigation", wake) };
  let active = true, last = 0, reading = false, again = false;
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
        if (value === null) continue;
        if (!validWorkspaceNavigation(value)) throw new Error("The native menu destination could not be verified.");
        if (value.revision > last) {
          navigate(workspaceScreens.find(screen => screen.id === value.screen)!.title);
          last = value.revision;
        }
        await api.ack(value.revision);
      } while (active && again);
    } catch (error) { if (active) failed(error instanceof Error ? error.message : "Native menu navigation is unavailable."); }
    finally { reading = false; }
  };
  void api.listen(() => void refresh()).then(stop => {
    if (!active) { stop(); return; }
    unlisten = stop; void refresh();
  }).catch(error => { if (active) failed(error instanceof Error ? error.message : "Native menus could not connect."); });
  return () => { active = false; unlisten?.(); };
}
