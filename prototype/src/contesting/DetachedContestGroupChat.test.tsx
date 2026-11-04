// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedContestGroupChat } from "./DetachedContestGroupChat";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
const context = { operatingContext:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sessionID:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspaceGeneration:"cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const authority = { role:"client", status:"connected", masterStation:"MASTER", sessionID:context.sessionID,
  workspaceGeneration:context.workspaceGeneration, leaseExpiresAtMs:10_000, reconnectCursor:4 };
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", `/?scope=contesting&view=group-chat&operatingContext=${context.operatingContext}&sessionID=${context.sessionID}&workspaceGeneration=${context.workspaceGeneration}`);
});
afterEach(() => cleanup());

it("renders bounded sender history and highlights own-operator mentions", async () => {
  native.invoke.mockResolvedValue({ status:"connected", error:null, enabled:true, operator:"OM0RX", multicastGroup:"239.1.1.1", multicastPort:2239,
    messages:[{sequence:1,sender:"VK6ABC",message:"OM0RX please QSY",receivedAtMs:1},{sequence:2,sender:"N0CALL",message:"all clear",receivedAtMs:2}],
    unverifiedTransportAcknowledgements:[], capabilities:{chat:true,contactPublication:true,remotePersistenceVerified:true,sharedSerial:true,duplicateInquiry:true,authorityLimitation:""}, authority });
  render(<DetachedContestGroupChat />);
  expect((await screen.findByText("OM0RX please QSY")).classList.contains("mentions-operator")).toBe(true);
  expect(screen.getByText("all clear").classList.contains("mentions-operator")).toBe(false);
  expect(screen.getByText("Connected · 239.1.1.1:2239")).toBeTruthy();
  expect(screen.getByText("Trusted-LAN authority MASTER · connected")).toBeTruthy();
  expect(native.invoke).toHaveBeenCalledWith("contest_group_chat_snapshot", context);
});

it("sends Enter as one CHAT request and clears only after success", async () => {
  native.invoke.mockImplementation(async (command: string) => command === "contest_group_chat_snapshot" ?
    { status:"connected", error:null, enabled:true, operator:"OM0RX", multicastGroup:"239.1.1.1", multicastPort:2239, messages:[], unverifiedTransportAcknowledgements:[], capabilities:{chat:true,contactPublication:true,remotePersistenceVerified:false,sharedSerial:false,duplicateInquiry:false,authorityLimitation:"Replies are not authoritative."}, authority:{...authority,status:"discovering",masterStation:null,sessionID:null,workspaceGeneration:null,leaseExpiresAtMs:null,reconnectCursor:0} } : undefined);
  render(<DetachedContestGroupChat />);
  const input = await screen.findByRole("textbox", { name:"Message" });
  fireEvent.change(input, { target:{ value:"hello group" } }); fireEvent.submit(input.closest("form")!);
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("contest_group_chat_send", { ...context, message:"hello group" }));
  expect((input as HTMLInputElement).value).toBe("");
});

it("truthfully disables input when group networking is off", async () => {
  native.invoke.mockResolvedValue({ status:"disabled", error:null, enabled:false, operator:"OM0RX", multicastGroup:"239.1.1.1", multicastPort:2239, messages:[], unverifiedTransportAcknowledgements:[], capabilities:{chat:true,contactPublication:true,remotePersistenceVerified:false,sharedSerial:false,duplicateInquiry:false,authorityLimitation:"Replies are not authoritative."}, authority:{role:"disabled",status:"disabled",masterStation:null,sessionID:null,workspaceGeneration:null,leaseExpiresAtMs:null,reconnectCursor:0} });
  render(<DetachedContestGroupChat />);
  expect(await screen.findByText("Group networking is disabled in Contest Setup.")).toBeTruthy();
  expect((screen.getByRole("textbox", { name:"Message" }) as HTMLInputElement).disabled).toBe(true);
});

const authorityIdentity={sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,pluginID:"cq_wpx_cw",sourceRevision:"source",referenceID:"cty",coordinationDigest:"a".repeat(64)};
const connectedSnapshot={status:"connected",error:null,enabled:true,operator:"OM0RX",multicastGroup:"239.1.1.1",multicastPort:2239,messages:[],unverifiedTransportAcknowledgements:[],
  capabilities:{chat:true,contactPublication:true,remotePersistenceVerified:false,sharedSerial:true,duplicateInquiry:true,authorityLimitation:""},authority};
function coordinationReply(requestID:string,directed:unknown[]=[]){return{id:requestID,ok:true,result:{requestID,authority:authorityIdentity,revision:3,replayed:false,
  senderStation:"B",observedUTC:"2026-11-04T00:00:00.000Z",draftMutation:false,outputArmed:false,offlineSerialGuarantee:false,
  peers:[{station:"A",operator:"OM0RX",role:"helper",band:"20M",mode:"CW",laneID:"laneA",cursor:3,queue:0,context:"test",confirmedUTC:"2026-11-04T00:00:00Z"}],directed}};}

it("sends reviewed receive frequency, mode and source time instead of zero placeholders",async()=>{
  native.invoke.mockImplementation(async(command:string,args:{request?:{requestID:string}})=>command==="contest_group_chat_snapshot"?connectedSnapshot:
    command==="contest_group_authority_request"?coordinationReply(args.request!.requestID):undefined);
  render(<DetachedContestGroupChat/>);
  await screen.findByRole("option",{name:"A"});
  fireEvent.change(screen.getByRole("combobox",{name:"Message target"}),{target:{value:"A"}});
  fireEvent.change(screen.getByRole("combobox",{name:"Kind"}),{target:{value:"pass"}});
  fireEvent.change(screen.getByRole("textbox",{name:"Call"}),{target:{value:"K1ABC"}});
  fireEvent.change(screen.getByRole("textbox",{name:"Pass receive frequency Hz"}),{target:{value:"14025000"}});
  fireEvent.change(screen.getByRole("textbox",{name:"Pass observation UTC"}),{target:{value:"2026-11-03T14:00:00Z"}});
  fireEvent.submit(screen.getByRole("textbox",{name:"Message"}).closest("form")!);
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith("contest_group_authority_request",expect.objectContaining({request:expect.objectContaining({params:{action:"send",message:expect.objectContaining({schema:2,version:1,frequencyHz:14025000,mode:"CW",frequencyMeaning:"rx",observedUTC:"2026-11-03T14:00:00Z",source:"operator",sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration})}})})));
});

it("arrival exposes explicit separate actions and leaves native Entry and radios untouched",async()=>{
  const proposal={id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",sender:"A",target:"B",kind:"pass",body:"review",call:"K1ABC",frequencyHz:14025000,mode:"CW",laneID:"laneA",
    createdUTC:"2026-11-04T00:00:00.000Z",acknowledgedUTC:null,schema:2,version:1,sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,frequencyMeaning:"rx",observedUTC:"2026-11-03T14:00:00Z",source:"operator",supersedesID:null,superseded:false};
  native.invoke.mockImplementation(async(command:string,args:{request?:{requestID:string}})=>command==="contest_group_chat_snapshot"?connectedSnapshot:
    command==="contest_group_authority_request"?coordinationReply(args.request!.requestID,[proposal]):undefined);
  render(<DetachedContestGroupChat/>);
  await screen.findByRole("button",{name:"Load K1ABC into laneA"});
  expect(screen.getByRole("button",{name:"Review and tune K1ABC"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Park current entry and load K1ABC"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Decline K1ABC"})).toBeTruthy();
  expect(native.invoke.mock.calls.every(call=>["contest_group_chat_snapshot","contest_group_authority_request"].includes(call[0]))).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Acknowledge K1ABC"}));
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith("contest_group_authority_request",expect.objectContaining({request:expect.objectContaining({params:{action:"acknowledge",messageID:proposal.id}})})));
  expect(native.invoke).not.toHaveBeenCalledWith("contest_surface_action",expect.anything());
});
