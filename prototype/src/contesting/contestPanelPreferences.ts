export type ContestLogView = { order:number[]; sort:null|{column:number;direction:"ascending"|"descending"} };
const logViewKey=(columns:readonly string[])=>`xlog.contesting.log-view.v1/${columns.join("\u001f")}`;
export function readContestLogView(columns:readonly string[]):ContestLogView {
  const fallback={order:columns.map((_,index)=>index),sort:null};
  try{
    const value=JSON.parse(localStorage.getItem(logViewKey(columns))??"null");
    if(!value||!Array.isArray(value.order)||value.order.length!==columns.length||
      new Set(value.order).size!==columns.length||value.order.some((index:unknown)=>!Number.isInteger(index)||Number(index)<0||Number(index)>=columns.length))return fallback;
    const sort=value.sort;
    return {order:value.order,sort:sort&&Number.isInteger(sort.column)&&sort.column>=0&&sort.column<columns.length&&
      ["ascending","descending"].includes(sort.direction)?sort:null};
  }catch{return fallback;}
}
export function persistContestLogView(columns:readonly string[],view:ContestLogView):void {
  try{localStorage.setItem(logViewKey(columns),JSON.stringify(view));}catch{/* View controls remain usable without storage. */}
}
export function moveContestLogColumn(order:readonly number[],source:number,target:number):number[] {
  const from=order.indexOf(source),to=order.indexOf(target);if(from<0||to<0)return [...order];
  const next=[...order];next.splice(from,1);next.splice(to,0,source);return next;
}
export function readPanelNumber(key:string,fallback:number,min:number,max:number):number {
  try{const raw=localStorage.getItem(key),value=raw===null?NaN:Number(raw);return Number.isFinite(value)&&value>=min&&value<=max?value:fallback;}catch{return fallback;}
}
