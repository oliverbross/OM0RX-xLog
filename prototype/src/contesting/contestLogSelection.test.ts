import { expect,it,vi } from "vitest";
import { selectContestLog } from "./contestLogSelection";
it("searches beyond the displayed page and locates an exact ID among repeated calls",async()=>{
  const rows=Array.from({length:775},(_,index)=>({ID:String(index),Call:index%7===0?"UA6LUQ":"K1ABC"}));
  const read=vi.fn(async(offset:number,limit:number)=>({revision:7,total:rows.length,rows:rows.slice(offset,offset+limit)}));
  const selected=await selectContestLog(read,7,"UA6L",0,10,"763");
  expect(selected.target?.ID).toBe("763");expect(selected.rows.some(row=>row.ID==="763")).toBe(true);
  expect(selected.total).toBe(111);expect(read).toHaveBeenCalledTimes(8);
  expect((await selectContestLog(read,7,"ZZZ",0,10)).rows).toEqual([]);
});
it("rejects stale or inconsistent pages and deleted review targets",async()=>{
  const read=async()=>({revision:8,total:0,rows:[]});
  await expect(selectContestLog(read,7,"UA6L",0,10)).rejects.toThrow("changed");
  await expect(selectContestLog(read,8,"UA6L",0,10,"gone")).rejects.toThrow("no longer");
  await expect(selectContestLog(async()=>({revision:7,total:1,rows:[]}),7,"",0,10)).rejects.toThrow("changed");
});
