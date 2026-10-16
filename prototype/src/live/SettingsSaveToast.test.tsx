// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSettingsSaveToast } from "./SettingsSaveToast";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Harness() {
  const feedback = useSettingsSaveToast();
  return <main><button onClick={() => feedback.show("Settings saved")}>Save</button>{feedback.toast}</main>;
}

describe("settings save toast", () => {
  it("overlays the page for 1.5 seconds without reserving a status row", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("status").textContent).toBe("Settings saved");
    expect(screen.getByRole("status").classList.contains("settings-save-toast")).toBe(true);
    act(() => vi.advanceTimersByTime(1_499));
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
