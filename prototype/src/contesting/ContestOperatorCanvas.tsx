import type { ReactNode } from "react";
import OperatorCanvas, { type CanvasPanel } from "../live/OperatorCanvas";
import { useWorkspaceLayout } from "../live/useWorkspaceLayout";
import { LayoutRequestRejected, type WorkspaceLayoutSession, type WorkspacePanelID } from "../live/workspaceLayoutSession";

type LayoutRequest = ConstructorParameters<typeof WorkspaceLayoutSession>[0];
type ContestRequest = (method: "workspace_layout_load" | "workspace_layout_apply", params?: Record<string, unknown>) => Promise<unknown>;
type Props = {
  panels: Partial<Record<WorkspacePanelID, CanvasPanel>>;
  traditional: ReactNode;
  request: ContestRequest;
  canChangeLayout: () => boolean;
};

export function contestLayoutRequest(request: ContestRequest): LayoutRequest {
  return (method, params) => request(method, params).then(response => {
    if (!response || typeof response !== "object" || Array.isArray(response) || !("ok" in response)) return response;
    const frame = response as Record<string, unknown>, keys = Object.keys(frame);
    if (typeof frame.id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(frame.id) ||
        typeof frame.ok !== "boolean" || keys.length !== 3 || !keys.includes(frame.ok ? "result" : "error"))
      throw new Error("The contest layout response could not be verified.");
    if (!frame.ok) {
      const error = frame.error && typeof frame.error === "object" && !Array.isArray(frame.error) ? frame.error as Record<string, unknown> : null;
      throw new LayoutRequestRejected(error && typeof error.message === "string" ? error.message : "The contest layout request was rejected.");
    }
    return frame.result;
  });
}

/** Presentation only. ContestWorkspace remains the single session/draft owner
 * while this shared layout engine chooses which projections are mounted. */
export function ContestOperatorCanvas({ panels, traditional, request, canChangeLayout }: Props) {
  const layout = useWorkspaceLayout(true, "contest", contestLayoutRequest(request), "contesting");
  if (!layout.state.snapshot && !layout.state.error)
    return <p className="contest-source" role="status">Loading saved contest layout…</p>;
  if (!layout.state.snapshot) return <>{traditional}{layout.state.error &&
    <p className="contest-source">Saved contest layout unavailable; showing the fixed workspace.</p>}</>;
  return <OperatorCanvas {...layout} panels={panels} traditional={traditional} canvasPresetMode="all"
    canChangeLayout={canChangeLayout}/>;
}

export default ContestOperatorCanvas;
