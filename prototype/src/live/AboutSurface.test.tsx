// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const invoke = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { AboutSurface } from "./AboutSurface";
afterEach(cleanup);
it("shows the larger icon, maker and email without reading station or logbook data", () => {
  render(<AboutSurface />);
  expect(screen.getByAltText("OM0RX-xLog logbook icon").getAttribute("width")).toBe("192");
  expect(screen.getByText("Oliver Bross · OM0RX")).toBeTruthy();
  expect(screen.getByRole("link", { name: "oliver@bross.eu" }).getAttribute("href")).toBe("mailto:oliver@bross.eu");
  expect(screen.getByText(/questions, ideas for improvements, and bug reports/)).toBeTruthy();
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" })); expect(invoke).toHaveBeenCalledWith("close_about_window");
});
