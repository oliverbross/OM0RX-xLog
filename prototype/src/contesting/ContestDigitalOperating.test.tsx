// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {ContestDigitalOperating} from "./ContestDigitalOperating";
afterEach(cleanup);
const scope={sessionID:"s",workspaceGeneration:"w",draftID:"d",revision:1,selectedLaneID:"laneB",bindingVersion:4,fields:[{id:"callsign",label:"Call"},{id:"other_2",label:"Received exchange"}]};
it("reviews an exact instance and token without invoking an output method",async()=>{
 const row={id:"decode",sender:"127.0.0.1:5001",instanceID:"Engine-B",engineVersion:"3.0.2",periodMS:0,snr:-12,deltaSeconds:.1,message:"CQ K1ABC FN31",mode:"FT8",frequencyHz:14074500,lowConfidence:false,offAir:false,replyLimitation:"No output contract"};
 const service=vi.fn(async(method:string)=>method==="wsjtx_snapshot"?{decodes:[row]}:method==="fldigi_snapshot"?{completed:[]}:row),apply=vi.fn(async()=>{});
 render(<ContestDigitalOperating scope={scope} serviceRequest={service} onApply={apply} disabled={false}/>);
 fireEvent.click(await screen.findByRole("button",{name:"Select decode"}));
 await screen.findByText(/Selected candidate Engine-B/);
 fireEvent.change(screen.getByLabelText("Received token"),{target:{value:"K1ABC"}});
 fireEvent.click(screen.getByRole("button",{name:"Load token into empty field"}));
 await waitFor(()=>expect(apply).toHaveBeenCalledWith({draftID:"d",fieldID:"callsign",value:"K1ABC",source:"wsjtx/127.0.0.1:5001/Engine-B/decode"}));
 expect(service).toHaveBeenCalledWith("wsjtx_select",{decodeID:"decode",sessionID:"s",workspaceGeneration:"w",laneID:"laneB",bindingVersion:4});
 expect(service.mock.calls.every(([method])=>!method.includes("send")&&!method.includes("reply"))).toBe(true);
 expect((screen.getByRole("button",{name:"Reply unavailable"}) as HTMLButtonElement).disabled).toBe(true);
});
