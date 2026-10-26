type Row = Record<string, any>;
type Page = { revision:number; total:number; rows:Row[] };

/** Read the complete log at one revision; search never changes the live entry. */
export async function selectContestLog(read:(offset:number,limit:number)=>Promise<Page>, revision:number,
    query:string, offset:number, limit:number, qsoID?:string) {
  const matches:Row[]=[];
  let total:number|undefined;
  for(let cursor=0;total===undefined||cursor<total;cursor+=100) {
    const page=await read(cursor,100);
    if(page.revision!==revision||!Number.isSafeInteger(page.total)||page.total<0||page.total>20000||
        total!==undefined&&page.total!==total||!Array.isArray(page.rows)||
        page.rows.length!==Math.min(100,page.total-cursor))
      throw new Error("The contest log changed or exceeds 20,000 contacts. Refresh and search again.");
    total=page.total;
    matches.push(...page.rows.filter(row=>String(row.Call??"").toUpperCase().includes(query)));
  }
  if(new Set(matches.map(row=>row.ID)).size!==matches.length)throw new Error("The contest log pages are inconsistent. Refresh and search again.");
  const index=qsoID?matches.findIndex(row=>row.ID===qsoID):-1;
  if(qsoID&&index<0)throw new Error("This contact is no longer in the log. Run review again.");
  const start=qsoID?Math.floor(index/limit)*limit:Math.min(offset,Math.max(0,Math.floor((matches.length-1)/limit)*limit));
  return {offset:start,total:matches.length,rows:matches.slice(start,start+limit),target:index<0?null:matches[index]};
}
