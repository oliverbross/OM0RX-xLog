import { expect, it, vi } from "vitest";
import { verifyWorkspaceLayoutRoundtrip } from "./workspaceLayoutAcceptance";
import { changedLayout, panelMinimum, workspacePanelIDs, type LayoutSnapshot } from "./live/workspaceLayoutSession";

const panels = workspacePanelIDs.map((id, z) => {
  const [width, height] = panelMinimum(id);
  return { id, placement: "hidden" as const, rect: { x: 0, y: 0, width, height }, z };
});

it("tests revision conflicts without activating Separate Windows", async () => {
  let snapshot: LayoutSnapshot = {
    revision: 0,
    generation: "00000000-0000-0000-0000-000000000001",
    document: { version: 2, activePresetID: "traditional", presets: [
      { id: "traditional", name: "Traditional", width: 1920, height: 1080, locked: true, snap: true, panels },
      { id: "windowed", name: "Separate Windows", width: 1920, height: 1080, locked: true, snap: true, panels },
    ] },
  };
  const original = structuredClone(snapshot.document);
  const activeIDs: string[] = [];
  const request = vi.fn(async (method: string, params: Record<string, any> = {}) => {
    if (method === "workspace_layout_load") return { layout: structuredClone(snapshot) };
    const { expectedRevision, generation, ...change } = params;
    if (generation !== snapshot.generation || expectedRevision !== snapshot.revision)
      return { status: "conflict", layout: structuredClone(snapshot) };
    snapshot = { ...snapshot, revision: snapshot.revision + 1, document: changedLayout(snapshot.document, change as any) };
    activeIDs.push(snapshot.document.activePresetID);
    return { status: "applied", layout: structuredClone(snapshot) };
  });

  const result = await verifyWorkspaceLayoutRoundtrip(request as any);

  expect(result).toMatchObject({ staleWriteRejected: true, initialRevision: 0, savedRevision: 1, restoredRevision: 2 });
  expect(activeIDs).toEqual(["traditional", "traditional"]);
  expect(snapshot.document).toEqual(original);
});
