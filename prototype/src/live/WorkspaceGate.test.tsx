// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WorkspaceGate from "./WorkspaceGate";

afterEach(cleanup);
describe("workspace startup truth", () => {
  it("does not offer a new logbook while disk status is unknown", () => {
    render(<WorkspaceGate workspace={null} pending busy={false} retry={vi.fn()} create={vi.fn()} />);
    expect(screen.getByRole("heading").textContent).toBe("Opening your integrated logbook");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("offers only reconnect after a failed workspace check", () => {
    const retry = vi.fn(), create = vi.fn();
    render(<WorkspaceGate workspace={null} pending={false} busy={false} retry={retry} create={create} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    expect(retry).toHaveBeenCalledOnce(); expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Create empty logbook" })).toBeNull();
  });
  it("offers creation only after confirmed missing workspace", () => {
    const create = vi.fn();
    render(<WorkspaceGate workspace={{ workspace_exists: false, native_log_exists: true }} pending={false} busy={false} retry={vi.fn()} create={create} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy my existing xLog logbook" }));
    expect(create).toHaveBeenCalledWith("copy_native");
  });
});
