// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSharedCW } from "./useSharedCW";
import { defaultCWProfile } from "./cwMacros";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); invoke.mockReset(); });
it("main Desk shared shortcuts preserve typing/modal/focus exclusions and unregister on cleanup", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const profile = structuredClone(defaultCWProfile); profile.macros[0].shortcut = "F1";
  let armed = false, revision = 0;
  invoke.mockImplementation(async (_command, { client, params }) => {
    if (params.action === "arm") { armed = true; revision++; }
    if (params.action === "stop" || params.action === "unregister") { armed = false; revision++; }
    return { revision, armed, pending: false, owner: null, client: armed ? client : null, lease: armed ? "native-lease" : null,
      message: "CW", error: "", winkeyer: null, canonical: { profile, context: { MYCALL: "OM0RX" }, provider: "direct_agent" } };
  });
  function Harness({ contextKey = "new-qso" }: { contextKey?: string }) {
    const { controller, state } = useSharedCW(contextKey);
    return <><button onClick={() => void controller.arm()}>Arm</button><output>{state.armed ? "Armed" : "Disarmed"}</output><input aria-label="Call" /></>;
  }
  const { rerender, unmount } = render(<Harness />);
  await waitFor(() => expect(invoke).toHaveBeenCalled()); fireEvent.click(screen.getByText("Arm")); await screen.findByText("Armed");
  const sends = () => invoke.mock.calls.filter(call => call[1].params.action === "send");
  fireEvent.keyDown(screen.getByLabelText("Call"), { key: "F1" });
  fireEvent.keyDown(document.body, { key: "F1", repeat: true }); fireEvent.keyDown(document.body, { key: "F1", isComposing: true });
  const dialog = document.createElement("dialog"); dialog.setAttribute("open", ""); document.body.append(dialog);
  fireEvent.keyDown(document.body, { key: "F1" }); dialog.remove(); expect(sends()).toHaveLength(0);
  fireEvent.keyDown(document.body, { key: "F1" }); await waitFor(() => expect(sends()).toHaveLength(1));
  expect(sends()[0][1].params).not.toHaveProperty("text"); expect(sends()[0][1].params).not.toHaveProperty("context");
  await act(async () => { window.dispatchEvent(new Event("blur")); }); await screen.findByText("Disarmed");
  fireEvent.keyDown(document.body, { key: "F1" }); expect(sends()).toHaveLength(1);
  fireEvent.click(screen.getByText("Arm")); await screen.findByText("Armed"); rerender(<Harness contextKey="changed" />); await screen.findByText("Disarmed");
  unmount(); expect(invoke.mock.calls.at(-1)?.[1].params.action).toBe("unregister");
});

it("leaves detached Entry focus and shortcuts to the native owner while Setup hosts its controller", async () => {
  vi.spyOn(document,"hasFocus").mockReturnValue(true);
  let armed=false,revision=0;
  invoke.mockImplementation(async(_command,{client,params})=>{
    if(params.action==="arm"){armed=true;revision++;}
    if(params.action==="unregister"){armed=false;revision++;}
    return {revision,armed,pending:false,client:armed?client:null,lease:armed?"lease":null,error:"",canonical:{profile:defaultCWProfile}};
  });
  function Harness(){const {controller,state}=useSharedCW("contest",false,true);return <>
    <button onClick={()=>void controller.arm()}>Arm</button><output>{state.armed?"Armed":"Disarmed"}</output></>;}
  const {unmount}=render(<Harness/>);
  await waitFor(()=>expect(invoke).toHaveBeenCalled());fireEvent.click(screen.getByText("Arm"));await screen.findByText("Armed");
  await act(async()=>{window.dispatchEvent(new Event("blur"));document.dispatchEvent(new Event("visibilitychange"));});
  fireEvent.keyDown(document.body,{key:"F1"});
  expect(invoke.mock.calls.filter(call=>["unregister","send"].includes(call[1].params.action))).toHaveLength(0);
  unmount();expect(invoke.mock.calls.at(-1)?.[1].params.action).toBe("unregister");
});
