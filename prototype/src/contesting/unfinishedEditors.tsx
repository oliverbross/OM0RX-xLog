import { useEffect, useRef, useState } from "react";

// Only unsent note/learning text lives here. Attempted note operations retain
// their existing journal and operation IDs; neither owner writes a contact.
type Draft<T> = { schema: 1; id: string; target: T; text: string };
const flushers = new Set<() => void>();
const failures = new Map<() => void,string>();
const announce=()=>window.dispatchEvent(new Event("xlog:unfinished-editor-failure"));
export function flushUnfinishedEditors() { for (const flush of flushers) flush(); }
const detail = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function useUnfinishedEditor<T>(prefix: string, valid: (target: unknown) => target is T, limit: number) {
  const [draft, setDraft] = useState<Draft<T> | null>(null), [records, setRecords] = useState<{key:string;raw:string;draft:Draft<T>|null}[]>([]);
  const [error, setError] = useState(""), [status, setStatus] = useState("");
  const current = useRef<Draft<T>|null>(null), original = useRef<string|null>(null), timer = useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const key = (id: string) => `${prefix}/${id}`;
  const scan = () => {
    try {
      const found: typeof records = [];
      for (let n=0;n<localStorage.length;n++) {
        const name=localStorage.key(n); if(!name?.startsWith(`${prefix}/`)||name.slice(prefix.length+1).includes("/"))continue;
        const raw=localStorage.getItem(name);if(raw===null)throw Error("Recovery changed while reading. Retry recovery.");
        let value: Draft<T>|null=null;
        try { const parsed=JSON.parse(raw);if(parsed.schema!==1||typeof parsed.id!=="string"||name!==key(parsed.id)||typeof parsed.text!=="string"||parsed.text.length>limit||!valid(parsed.target))throw Error();value=parsed; } catch { /* Preserve exact malformed bytes for verified archive/copy. */ }
        found.push({key:name,raw,draft:value});
      }
      setRecords(found);setError("");return found;
    }catch(cause){setError(`Local draft recovery unavailable: ${detail(cause)}. Existing bytes are retained.`);return null;}
  };
  const flush = () => {
    clearTimeout(timer.current);timer.current=undefined;
    const value=current.current;if(!value)return;
    const raw=JSON.stringify(value);
    try {
      const stored=localStorage.getItem(key(value.id));
      if(stored!==original.current&&stored!==raw)throw Error("This draft changed in another editor. Copy this text or reopen recovery; no record was overwritten.");
      if(stored!==raw){localStorage.setItem(key(value.id),raw);if(localStorage.getItem(key(value.id))!==raw)throw Error("Draft write could not be verified.");}
      original.current=raw;setError("");setStatus("Draft retained locally");
    }catch(cause){const text=`Draft not retained: ${detail(cause)} Keep this editor open or copy its text.`;setError(text);setStatus("");throw Error(text);}
  };
  const flushRef=useRef(flush);flushRef.current=flush;
  useEffect(()=>{
    const found=scan();if(found?.length===1&&found[0].draft){current.current=found[0].draft;original.current=found[0].raw;setDraft(found[0].draft);setStatus("Draft retained locally");}
    let active=true;
    const run=()=>{try{flushRef.current();failures.delete(run);if(!active)flushers.delete(run);announce();}
      catch(cause){failures.set(run,detail(cause));announce();throw cause;}};flushers.add(run);
    const leaving=()=>{try{run();}catch{/* Controlled native close/navigation uses the throwing path. */}};
    window.addEventListener("pagehide",leaving);window.addEventListener("blur",leaving);
    return()=>{active=false;leaving();if(!failures.has(run))flushers.delete(run);window.removeEventListener("pagehide",leaving);window.removeEventListener("blur",leaving);clearTimeout(timer.current);};
  },[prefix]);
  const update = (target:T,text:string) => {
    const next={schema:1 as const,id:current.current?.id??crypto.randomUUID(),target:current.current?.target??target,text};
    current.current=next;setDraft(next);setStatus("Draft retention pending…");
    // A fixed deadline, rather than a trailing debounce: continuous typing
    // cannot postpone a write indefinitely. Navigation flushes synchronously.
    timer.current??=setTimeout(()=>{timer.current=undefined;try{flushRef.current();}catch{}},300);
  };
  const start=(target:T)=>{flush();if(current.current)throw Error("Keep or discard the existing draft before starting another note.");update(target,"");};
  const keepForLater = () => {
    flush(); // Only release this editor after its original record is verified.
    current.current=null;original.current=null;setDraft(null);scan();
  };
  const clear = () => {
    const value=current.current;if(!value)return;
    clearTimeout(timer.current);timer.current=undefined;
    try {if(localStorage.getItem(key(value.id))!==original.current)throw Error("Recovery changed; nothing was removed.");
      localStorage.removeItem(key(value.id));if(localStorage.getItem(key(value.id))!==null)throw Error("Draft removal failed.");
      current.current=null;original.current=null;setDraft(null);setStatus("");setError("");scan();
    }catch(cause){setError(detail(cause));throw cause;}
  };
  const recover=(record:typeof records[number])=>{try{flush();if(localStorage.getItem(record.key)!==record.raw)throw Error("Recovery changed; retry reading it.");
    if(!record.draft)throw Error("Unreadable recovery must be copied or archived first.");current.current=record.draft;original.current=record.raw;setDraft(record.draft);setError("");setStatus("Draft retained locally");
  }catch(cause){setError(detail(cause));}};
  const archive=(record:typeof records[number])=>{try{
    if(localStorage.getItem(record.key)!==record.raw)throw Error("Recovery changed; retry reading it.");
    const archiveKey=`${record.key}/unreadable/${crypto.randomUUID()}`;localStorage.setItem(archiveKey,record.raw);
    if(localStorage.getItem(archiveKey)!==record.raw||localStorage.getItem(record.key)!==record.raw)throw Error("Recovery archive could not be verified. Original retained.");
    localStorage.removeItem(record.key);scan();
  }catch(cause){setError(detail(cause));}};
  const complete=(id:string,text:string)=>{
    if(current.current?.id===id){if(current.current.text!==text)throw Error("Saved draft changed; recovery retained.");clear();return;}
    const raw=localStorage.getItem(key(id));if(raw===null)return;
    const value=JSON.parse(raw) as Draft<T>;
    if(value.id!==id||value.text!==text||!valid(value.target))throw Error("Saved draft recovery changed; original operation retained.");
    localStorage.removeItem(key(id));if(localStorage.getItem(key(id))!==null)throw Error("Saved draft removal failed.");scan();
  };
  const restore=(target:T,text:string,id?:string)=>{
    flush();const name=id?key(id):null,raw=name?localStorage.getItem(name):null;
    if(raw!==null&&name){const value=JSON.parse(raw) as Draft<T>;if(value.id!==id||value.text!==text||!valid(value.target))throw Error("Original editor recovery changed; attempted note retained.");recover({key:name,raw,draft:value});return;}
    const next={schema:1 as const,id:crypto.randomUUID(),target,text};current.current=next;original.current=null;setDraft(next);flush();scan();
  };
  return {draft,records,error,status,update,start,flush,keepForLater,clear,complete,restore,recover,archive,scan};
}

export function UnfinishedEditorWarning(){
  const [message,setMessage]=useState("");
  useEffect(()=>{const update=()=>setMessage([...failures.values()].join(" "));update();window.addEventListener("xlog:unfinished-editor-failure",update);return()=>window.removeEventListener("xlog:unfinished-editor-failure",update);},[]);
  return message?<p role="alert">{message}</p>:null;
}

export function UnfinishedRecovery<T>({editor}:{editor:ReturnType<typeof useUnfinishedEditor<T>>}) {
  return <>{editor.status&&<p role="status">{editor.status}. This is unfinished editor text.</p>}{editor.error&&<p role="alert">{editor.error}</p>}
    <button onClick={()=>editor.scan()}>Refresh retained drafts</button>
    {editor.records.filter(row=>!row.draft||row.draft.id!==editor.draft?.id).map(row=><div key={row.key}>
      <p>{row.draft?`Retained draft ${row.draft.id.slice(0,8)}`:"Unreadable draft recovery — original bytes preserved"}</p>
      <button onClick={()=>void navigator.clipboard.writeText(row.draft?.text??row.raw).catch(()=>{})}>Copy retained text</button>
      {row.draft?<button onClick={()=>editor.recover(row)}>Recover retained draft</button>:<><pre>{row.raw}</pre><button onClick={()=>editor.archive(row)}>Archive unreadable draft</button></>}
    </div>)}</>;
}
