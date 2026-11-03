import { beforeEach, expect, it, vi } from "vitest";
const native=vi.hoisted(()=>({load:vi.fn(),tune:vi.fn(),session:vi.fn()}));
vi.mock("./guideTuneSession",()=>({loadGuideStation:native.load,guideTuneSession:native.session}));
import { tuneGuideMarker } from "./guideTune";
beforeEach(()=>{vi.clearAllMocks();native.session.mockReturnValue({tune:native.tune});});
it("tunes once through selected-slot owner using explicit marker mode and captured fences",async()=>{
  const selection={provider:"direct_tci",generation:7,selection_id:"tci-7"};
  const radio={provider:"direct_tci",selection_id:"tci-7",selection_generation:7,snapshot:{generation:3,radio:{mode:"USB"}}};
  native.load.mockResolvedValue({active_radio:"radio2",selection,radio});
  await tuneGuideMarker({frequencyHz:14100000,label:"IBP",category:"reference",mode:"CW"});
  expect(native.session).toHaveBeenCalledWith("radio2","CW");expect(native.tune).toHaveBeenCalledExactlyOnceWith("direct_tci",14100000,"CW",expect.objectContaining({selection,radio}));
});
it("keeps current observed mode for a personal marker and rejects a changed active slot",async()=>{
  native.load.mockResolvedValueOnce({active_radio:"radio2"}).mockResolvedValueOnce({active_radio:"radio1",selection:{provider:"direct_tci"},radio:{snapshot:{radio:{mode:"USB"}}}});
  await expect(tuneGuideMarker({frequencyHz:14200000,label:"Personal",category:"personal"})).rejects.toThrow(/selected radio/);
  expect(native.tune).not.toHaveBeenCalled();
  native.load.mockResolvedValue({active_radio:"radio1",selection:{provider:"direct_tci"},radio:{snapshot:{radio:{mode:"USB"}}}});
  await tuneGuideMarker({frequencyHz:14200000,label:"Personal",category:"personal"});
  expect(native.tune.mock.calls[0][2]).toBe("USB");
});
