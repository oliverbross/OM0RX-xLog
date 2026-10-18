import type { ReactNode } from "react";
import OperatorCanvas, { type CanvasPanel } from "../live/OperatorCanvas";
import { useWorkspaceLayout } from "../live/useWorkspaceLayout";
import type { WorkspaceLayoutSession, WorkspacePanelID } from "../live/workspaceLayoutSession";

type LayoutRequest = ConstructorParameters<typeof WorkspaceLayoutSession>[0];
type Props = {
  panels: Partial<Record<WorkspacePanelID, CanvasPanel>>;
  traditional: ReactNode;
  request: LayoutRequest;
  canChangeLayout: () => boolean;
};

/** Presentation only. ContestWorkspace remains the single session/draft owner
 * while this shared layout engine chooses which projections are mounted. */
export function ContestOperatorCanvas({ panels, traditional, request, canChangeLayout }: Props) {
  const layout = useWorkspaceLayout(true, "contest", request, "contesting");
  if (!layout.state.snapshot && !layout.state.error)
    return <p className="contest-source" role="status">Loading saved contest layout…</p>;
  if (!layout.state.snapshot) return <>{traditional}{layout.state.error &&
    <p className="contest-source">Saved contest layout unavailable; showing the fixed workspace.</p>}</>;
  return <OperatorCanvas {...layout} panels={panels} traditional={traditional} canvasPresetMode="all"
    canChangeLayout={canChangeLayout}/>;
}

export default ContestOperatorCanvas;
