// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HFPropagationCanvas from "./HFPropagationCanvas";
import { defaultHFPropagationCanvasLayout } from "./hfPropagationCanvasLayout";

afterEach(cleanup);

it("ends viewing at the last visible panel while preserving saved sizes and the full arrangement workspace", () => {
  const layout = defaultHFPropagationCanvasLayout();
  const footer = layout.panels.find(panel => panel.id === "data-sources")!;
  footer.rect = { x: 0, y: 1100, width: 1600, height: 80 };
  const onChange = vi.fn();
  const props = { layout, panels: [{ id: "data-sources" as const, title: "Sources", content: <footer>Sources</footer> }],
    onChange, onCompactChange: vi.fn() };
  const view = render(<HFPropagationCanvas {...props} arranging={false} />);
  const frame = screen.getByLabelText("Sources panel");
  const canvas = frame.parentElement!;
  const physicalGeometry = () => {
    const [width, height] = canvas.style.aspectRatio.split("/").map(Number);
    return [parseFloat(frame.style.top) * height / width, parseFloat(frame.style.height) * height / width];
  };
  expect(canvas.style.aspectRatio).toBe("1600 / 1180");
  const geometry = physicalGeometry();
  expect(parseFloat(frame.style.top) + parseFloat(frame.style.height)).toBeCloseTo(100);
  view.rerender(<HFPropagationCanvas {...props} arranging />);
  expect(canvas.style.aspectRatio).toBe("1600 / 1940");
  expect(physicalGeometry()[0]).toBeCloseTo(geometry[0]);
  expect(physicalGeometry()[1]).toBeCloseTo(geometry[1]);
  expect(screen.getByRole("button", { name: "Move Sources" })).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});
