import { checkedLayout, WorkspaceLayoutSession } from "./live/workspaceLayoutSession";
import { requestWorkspaceLayout } from "./live/workspaceLayoutTransport";

/** Isolated native acceptance only. Exercises the production client/IPC/SQLite
 * path without opening windows, changing a draft or touching station services. */
export async function verifyWorkspaceLayoutRoundtrip(request = requestWorkspaceLayout) {
  const first = new WorkspaceLayoutSession(request), stale = new WorkspaceLayoutSession(request);
  await Promise.all([first.refresh(), stale.refresh()]);
  const original = first.getSnapshot().snapshot;
  if (!original || original.document.activePresetID !== "traditional" || original.document.presets.length !== 2)
    throw new Error("Expected isolated default workspace layouts.");
  const windowed = original.document.presets.find(preset => preset.id === "windowed");
  if (!windowed) throw new Error("Expected isolated Separate Windows layout.");
  const changed = { ...structuredClone(windowed), name: "Separate Windows acceptance" };
  // Exercise revisioned persistence on an inactive preset. Activating the real
  // Separate Windows preset would make the running main renderer correctly
  // open native windows and pollute the later lifecycle/menu acceptance.
  await first.apply({ action: "savePreset", presetID: "windowed", preset: changed });
  const saved = first.getSnapshot();
  if (saved.pending || saved.snapshot?.revision !== original.revision + 1 || saved.snapshot.document.activePresetID !== "traditional" ||
      saved.snapshot.document.presets.find(preset => preset.id === "windowed")?.name !== changed.name)
    throw new Error("Native layout mutation was not acknowledged.");
  await stale.apply({ action: "savePreset", presetID: "windowed", preset: structuredClone(windowed) });
  if (!stale.getSnapshot().conflict || !stale.getSnapshot().pending) throw new Error("Stale layout mutation did not conflict.");
  const readback = checkedLayout((await request("workspace_layout_load")).layout);
  if (readback.revision !== saved.snapshot.revision || readback.document.activePresetID !== "traditional" ||
      readback.document.presets.find(preset => preset.id === "windowed")?.name !== changed.name)
    throw new Error("Native layout readback differs.");
  await first.apply({ action: "savePreset", presetID: "windowed", preset: structuredClone(windowed) });
  const restored = checkedLayout((await request("workspace_layout_load")).layout);
  if (first.getSnapshot().pending || restored.revision !== original.revision + 2 || restored.document.activePresetID !== "traditional" ||
      JSON.stringify(restored.document) !== JSON.stringify(original.document))
    throw new Error("Traditional layout restoration failed.");
  return { initialRevision: original.revision, savedRevision: readback.revision, restoredRevision: restored.revision,
    roles: restored.document.presets[0].panels.length, staleWriteRejected: true, stationIO: false };
}
