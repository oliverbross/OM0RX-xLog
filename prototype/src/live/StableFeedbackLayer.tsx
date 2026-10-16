import type { ReactNode } from "react";

/**
 * Keeps transient status and recovery controls visible without inserting a
 * new row above the operator's working surface.
 */
export function StableFeedbackLayer({ children }: { children: ReactNode }) {
  return <div className="live-feedback-overlay">{children}</div>;
}
