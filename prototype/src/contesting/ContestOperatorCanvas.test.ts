import { expect, it, vi } from "vitest";
import { LayoutRequestRejected } from "../live/workspaceLayoutSession";
import { contestLayoutRequest } from "./ContestOperatorCanvas";

const id = "aaaaaaaa-0000-4000-8000-000000000099";

it("unwraps the production framed layout result without changing method or scope", async () => {
  const source = vi.fn(async () => ({ id, ok: true, result: { layout: { scope: "contesting" } } }));
  const request = contestLayoutRequest(source);
  await expect(request("workspace_layout_load", { scope: "contesting" })).resolves.toEqual({ layout: { scope: "contesting" } });
  expect(source).toHaveBeenCalledWith("workspace_layout_load", { scope: "contesting" });
});

it("preserves confirmed rejection and unknown transport outcomes", async () => {
  const rejected = contestLayoutRequest(async () => ({ id, ok: false, error: { message: "revision conflict" } }));
  await expect(rejected("workspace_layout_apply")).rejects.toBeInstanceOf(LayoutRequestRejected);
  const lost = contestLayoutRequest(async () => { throw new Error("IPC reply lost"); });
  await expect(lost("workspace_layout_apply")).rejects.toThrow("IPC reply lost");
});

it("rejects malformed or noncanonical frames while retaining preview payload compatibility", async () => {
  const malformed = contestLayoutRequest(async () => ({ id: id.toUpperCase(), ok: true, result: { layout: {} } }));
  await expect(malformed("workspace_layout_load")).rejects.toThrow("could not be verified");
  const preview = contestLayoutRequest(async () => ({ layout: { scope: "contesting" } }));
  await expect(preview("workspace_layout_load")).resolves.toEqual({ layout: { scope: "contesting" } });
});
