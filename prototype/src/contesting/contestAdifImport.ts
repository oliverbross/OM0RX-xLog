import { decodeADIFDocument } from "../live/adifTransfer";

export type ContestADIFImportRecord = {
  qsoID: string;
  timestamp: string;
  frequencyHz: number;
  mode: "SSB";
  fields: { callsign: string; sent: string; receive: string; other_1: string; other_2: string };
};

const maximumRecords = 100_000;
const fieldPattern = /<([A-Za-z0-9_]+)(?::([0-9]+)(?::[^>]*)?)?>/gy;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidFromN1MM(value: string): string | null {
  const compact=value.trim().toLowerCase();
  if(!/^[0-9a-f]{32}$/.test(compact))return null;
  const candidate=`${compact.slice(0,8)}-${compact.slice(8,12)}-${compact.slice(12,16)}-${compact.slice(16,20)}-${compact.slice(20)}`;
  return uuidPattern.test(candidate)?candidate:null;
}

async function stableUUID(value: string): Promise<string> {
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))).slice(0,16);
  bytes[6]=(bytes[6]&0x0f)|0x50;bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

function records(text: string): Map<string,string>[] {
  const eoh=/<EOH\s*>/i.exec(text), body=eoh?text.slice(eoh.index+eoh[0].length):text;
  const output:Map<string,string>[]=[];let index=0,current=new Map<string,string>();
  while(index<body.length){
    while(index<body.length&&/\s/.test(body[index]))index+=1;
    if(index===body.length)break;
    fieldPattern.lastIndex=index;const match=fieldPattern.exec(body);
    if(!match)throw new Error(`ADIF is malformed near byte ${index+1}. Nothing was imported.`);
    index=fieldPattern.lastIndex;const name=match[1].toUpperCase();
    if(name==="EOR"){
      if(current.size===0)throw new Error("ADIF contains an empty contact. Nothing was imported.");
      output.push(current);current=new Map();
      if(output.length>maximumRecords)throw new Error("ADIF contains more than 100,000 contacts. Nothing was imported.");
      continue;
    }
    if(name==="EOH")continue;
    if(match[2]===undefined)throw new Error(`ADIF field ${name} has no length. Nothing was imported.`);
    const length=Number(match[2]);
    if(!Number.isSafeInteger(length)||index+length>body.length)throw new Error(`ADIF field ${name} is truncated. Nothing was imported.`);
    const value=body.slice(index,index+length);index+=length;
    if(current.has(name))throw new Error(`ADIF contact repeats ${name}. Nothing was imported.`);
    current.set(name,value);
  }
  if(current.size)throw new Error("ADIF contact is missing <EOR>. Nothing was imported.");
  if(output.length===0)throw new Error("ADIF contains no contacts. Nothing was imported.");
  return output;
}

const required=(record:Map<string,string>,name:string,index:number)=>{
  const value=(record.get(name)??"").trim();
  if(!value)throw new Error(`ADIF contact ${index+1} is missing ${name}. Nothing was imported.`);
  return value;
};

export async function contestADIFImport(bytes: ArrayBuffer): Promise<ContestADIFImportRecord[]> {
  const document=decodeADIFDocument(bytes,"utf-8"), parsed=records(document.text), seen=new Set<string>();
  const output:ContestADIFImportRecord[]=[];
  for(let index=0;index<parsed.length;index+=1){
    const record=parsed[index],contest=required(record,"CONTEST_ID",index).toUpperCase();
    if(contest!=="CQ-WW-SSB")throw new Error(`ADIF contact ${index+1} is for ${contest}, not CQ-WW-SSB. Nothing was imported.`);
    const call=required(record,"CALL",index).toUpperCase();
    if(!/^[A-Z0-9/]{3,32}$/.test(call))throw new Error(`ADIF contact ${index+1} has an invalid callsign. Nothing was imported.`);
    const mode=required(record,"MODE",index).toUpperCase();
    if(!["SSB","PHONE","PH","USB","LSB"].includes(mode))throw new Error(`ADIF contact ${index+1} is not SSB. Nothing was imported.`);
    const date=required(record,"QSO_DATE",index),time=required(record,"TIME_ON",index);
    if(!/^\d{8}$/.test(date)||!/^\d{4}(?:\d{2})?$/.test(time))throw new Error(`ADIF contact ${index+1} has an invalid UTC time. Nothing was imported.`);
    const hhmmss=time.padEnd(6,"0"),timestamp=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)} ${hhmmss.slice(0,2)}:${hhmmss.slice(2,4)}:${hhmmss.slice(4,6)}`;
    const parsedTime=Date.parse(timestamp.replace(" ","T")+"Z");
    if(!Number.isFinite(parsedTime)||new Date(parsedTime).toISOString().slice(0,19).replace("T"," ")!==timestamp)
      throw new Error(`ADIF contact ${index+1} has an invalid UTC time. Nothing was imported.`);
    const frequency=Number(required(record,"FREQ",index)),frequencyHz=Math.round(frequency*1_000_000);
    if(!Number.isFinite(frequency)||!Number.isSafeInteger(frequencyHz)||frequencyHz<=0)
      throw new Error(`ADIF contact ${index+1} has an invalid frequency. Nothing was imported.`);
    const zone=required(record,"CQZ",index);
    if(!/^\d{1,2}$/.test(zone)||Number(zone)<1||Number(zone)>40)throw new Error(`ADIF contact ${index+1} has an invalid CQ zone. Nothing was imported.`);
    const fields={callsign:call,sent:required(record,"RST_SENT",index),receive:required(record,"RST_RCVD",index),
      other_1:(record.get("STX_STRING")??record.get("STX")??"").trim(),other_2:String(Number(zone))};
    if(!fields.other_1)throw new Error(`ADIF contact ${index+1} is missing the sent CQ zone. Nothing was imported.`);
    const identity=uuidFromN1MM(record.get("APP_N1MM_ID")??"")??await stableUUID(`${timestamp}\0${frequencyHz}\0${call}\0${index}`);
    if(seen.has(identity))throw new Error(`ADIF contact ${index+1} repeats a contact identity. Nothing was imported.`);
    seen.add(identity);output.push({qsoID:identity,timestamp,frequencyHz,mode:"SSB",fields});
  }
  return output;
}
