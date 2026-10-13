import { checkedLayout, WorkspaceLayoutSession } from "./live/workspaceLayoutSession";
import { requestWorkspaceLayout } from "./live/workspaceLayoutTransport";

/** Isolated native acceptance only. Exercises the production client/IPC/SQLite
 * path without opening windows, changing a draft or touching station services. */
export async function verifyWorkspaceLayoutRoundtrip() {
  const first = new WorkspaceLayoutSession(requestWorkspaceLayout), stale = new WorkspaceLayoutSession(requestWorkspaceLayout);
  await Promise.all([first.refresh(), stale.refresh()]);
  const original = first.getSnapshot().snapshot;
  if (!original || original.document.activePresetID !== "traditional" || original.document.presets.length !== 2)
    throw new Error("Expected isolated default workspace layouts.");
  await first.apply({ action: "activatePreset", presetID: "windowed" });
  const saved = first.getSnapshot();
  if (saved.pending || saved.snapshot?.revision !== original.revision + 1 || saved.snapshot.document.activePresetID !== "windowed")
    throw new Error("Native layout mutation was not acknowledged.");
  await stale.apply({ action: "activatePreset", presetID: "traditional" });
  if (!stale.getSnapshot().conflict || !stale.getSnapshot().pending) throw new Error("Stale layout mutation did not conflict.");
  const readback = checkedLayout((await requestWorkspaceLayout("workspace_layout_load")).layout);
  if (readback.revision !== saved.snapshot.revision || readback.document.activePresetID !== "windowed")
    throw new Error("Native layout readback differs.");
  await first.apply({ action: "activatePreset", presetID: "traditional" });
  const restored = checkedLayout((await requestWorkspaceLayout("workspace_layout_load")).layout);
  if (first.getSnapshot().pending || restored.revision !== original.revision + 2 || restored.document.activePresetID !== "traditional")
    throw new Error("Traditional layout restoration failed.");
  return { initialRevision: original.revision, savedRevision: readback.revision, restoredRevision: restored.revision,
    roles: restored.document.presets[0].panels.length, staleWriteRejected: true, stationIO: false };
}
