import type { ReactNode } from "react";

/** The hidden main renderer retains shared sessions, but task UI has one home. */
export function WorkspaceModeSurface({ separateWindows, children }: { separateWindows: boolean; children: ReactNode }) {
  return separateWindows ? <section aria-label="Separate windows workspace"><h1>Separate Windows</h1>
    <p>Open your task windows from the Window menu. Each window remembers its position and size.</p>
    <p>Return to your saved desk with Window → Workspace Mode → Canvas.</p>
  </section> : children;
}
