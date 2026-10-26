import { expect, it } from "vitest";
import { validContestSurfaceProjection } from "./contestSurfaceProtocol";

for (const cqWW of [true,false]) it(`validates duplicate counts and totals for ${cqWW?"CQ WW":"generic"} Stats`,()=>{
  const row=cqWW?{band:"7.0",qsos:3,points:6,countries:1,zones:1}:{band:"7.0",qsos:3,points:6,calls:2,cw:3,phone:0,digital:0,wpx:2};
  const projection={schemaVersion:3,status:"ready",...(cqWW?{layout:"cq_ww"}:{}),busy:false,
    score:{qsos:3,points:6,multipliers:2,claimedScore:12,multiplierLabels:[],multiplierDisplayLabels:[],sourceVerification:"verified"},
    rows:[{...row,dupes:1}],total:{...row,band:"TOTAL",dupes:1}};
  expect(validContestSurfaceProjection("propagation",projection)).toBe(true);
  for(const dupes of [-1,4,1.5,"1",Number.MAX_SAFE_INTEGER+1])
    expect(validContestSurfaceProjection("propagation",{...projection,rows:[{...row,dupes}]})).toBe(false);
  expect(validContestSurfaceProjection("propagation",{...projection,total:{...projection.total,dupes:2}})).toBe(false);
  expect(validContestSurfaceProjection("propagation",{...projection,rows:[row]})).toBe(false);
  expect(validContestSurfaceProjection("propagation",{...projection,rows:[{...row,dupes:null}],total:{...projection.total,dupes:null}})).toBe(true);
  expect(validContestSurfaceProjection("propagation",{...projection,rows:[{...row,dupes:null}]})).toBe(false);
});
