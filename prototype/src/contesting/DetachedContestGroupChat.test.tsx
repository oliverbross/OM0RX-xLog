// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedContestGroupChat } from "./DetachedContestGroupChat";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
const context = { operatingContext:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sessionID:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspaceGeneration:"cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", `/?scope=contesting&view=group-chat&operatingContext=${context.operatingContext}&sessionID=${context.sessionID}&workspaceGeneration=${context.workspaceGeneration}`);
});
afterEach(() => cleanup());

it("renders bounded sender history and highlights own-operator mentions", async () => {
  native.invoke.mockResolvedValue({ status:"connected", error:null, enabled:true, operator:"OM0RX", multicastGroup:"239.1.1.1", multicastPort:2239,
    messages:[{sequence:1,sender:"VK6ABC",message:"OM0RX please QSY",receivedAtMs:1},{sequence:2,sender:"N0CALL",message:"all clear",receivedAtMs:2}] });
  render(<DetachedContestGroupChat />);
  expect((await screen.findByText("OM0RX please QSY")).classList.contains("mentions-operator")).toBe(true);
  expect(screen.getByText("all clear").classList.contains("mentions-operator")).toBe(false);
  expect(screen.getByText("Connected · 239.1.1.1:2239")).toBeTruthy();
  expect(native.invoke).toHaveBeenCalledWith("contest_group_chat_snapshot", context);
});

it("sends Enter as one CHAT request and clears only after success", async () => {
  native.invoke.mockImplementation(async (command: string) => command === "contest_group_chat_snapshot" ?
    { status:"connected", error:null, enabled:true, operator:"OM0RX", multicastGroup:"239.1.1.1", multicastPort:2239, messages:[] } : undefined);
  render(<DetachedContestGroupChat />);
  const input = await screen.findByRole("textbox", { name:"Message" });
  fireEvent.change(input, { target:{ value:"hello group" } }); fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("contest_group_chat_send", { ...context, message:"hello group" }));
  expect((input as HTMLInputElement).value).toBe("");
});

it("truthfully disables input when group networking is off", async () => {
  native.invoke.mockResolvedValue({ status:"disabled", error:null, enabled:false, operator:"OM0RX", multicastGroup:"239.1.1.1", multicastPort:2239, messages:[] });
  render(<DetachedContestGroupChat />);
  expect(await screen.findByText("Group networking is disabled in Contest Setup.")).toBeTruthy();
  expect((screen.getByRole("textbox", { name:"Message" }) as HTMLInputElement).disabled).toBe(true);
});
