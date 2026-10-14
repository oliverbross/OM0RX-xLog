// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceModeSurface } from "./WorkspaceModeSurface";
afterEach(cleanup);
it("replaces the working Canvas with the task-window entry point and restores Canvas on return", () => {
  const canvas = vi.fn(() => <div>Traditional / Custom Canvas</div>);
  const Canvas = canvas;
  const view = render(<WorkspaceModeSurface separateWindows={false}><Canvas /></WorkspaceModeSurface>);
  expect(view.getByText("Traditional / Custom Canvas")).toBeTruthy();
  view.rerender(<WorkspaceModeSurface separateWindows><Canvas /></WorkspaceModeSurface>);
  expect(view.queryByText("Traditional / Custom Canvas")).toBeNull();
  expect(view.getByText(/Open your task windows from the Window menu/)).toBeTruthy();
  expect(canvas).toHaveBeenCalledTimes(1);
  view.rerender(<WorkspaceModeSurface separateWindows={false}><Canvas /></WorkspaceModeSurface>);
  expect(view.getByText("Traditional / Custom Canvas")).toBeTruthy();
});
