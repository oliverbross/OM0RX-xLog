import {useEffect,useRef,useState} from "react";
import type {ContestRequest} from "./types";

type Delivery={id:string;kind:string;destination:string;qso_id:string;sha256:string;outcome:string;error:string;attempts:number;updated_utc:string};
type Snapshot={rows:Delivery[];remotePersistenceVerified:false;retryPolicy:string;scorePublicationComplete?:boolean};
export function ContestIntegrationDelivery({scope,request,disabled}:{scope:{sessionID:string;workspaceGeneration:string};request:ContestRequest;disabled:boolean}){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(""),[retrying,setRetrying]=useState(false),[reviewed,setReviewed]=useState("");
  const identity=`${scope.sessionID}/${scope.workspaceGeneration}`;
  const currentIdentity=useRef(identity);currentIdentity.current=identity;
  useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;setSnapshot(null);setError("");setRetrying(false);setReviewed("");
    const refresh=async()=>{try{const frame=await request<Snapshot>("contest_n1mm_delivery",scope);
      if(!frame.ok)throw Error(frame.error.message);if(active){setSnapshot(frame.result);setError("");}}
      catch(cause){if(active)setError(cause instanceof Error?cause.message:String(cause));}
      finally{if(active)timer=setTimeout(()=>void refresh(),5000);}};
    void refresh();return()=>{active=false;clearTimeout(timer);};
  },[identity,request]);
  const reviewIdentity=(row:Delivery)=>`${identity}/${row.id}/${row.sha256}/${row.attempts}`;
  const retry=async(row:Delivery)=>{if(disabled||retrying||reviewed!==reviewIdentity(row))return;
    const origin=identity;setRetrying(true);setError("");try{const frame=await request<Snapshot>("contest_n1mm_retry",{...scope,deliveryID:row.id,sha256:row.sha256,
      expectedAttempts:row.attempts,confirmUncertain:true});if(!frame.ok)throw Error(frame.error.message);if(currentIdentity.current===origin){setSnapshot(frame.result);setReviewed("");}}
    catch(cause){if(currentIdentity.current===origin)setError(cause instanceof Error?cause.message:String(cause));}finally{if(currentIdentity.current===origin)setRetrying(false);}};
  return <section aria-label="External integration delivery"><h2>External integration delivery</h2>
    <p>N1MM-compatible UDP: sent means an attempted datagram, never remote persistence or contest submission. A newer contact or changed destination blocks an old retry.</p>
    {error&&<p role="alert">{error}</p>}
    {snapshot?.scorePublicationComplete===false&&<p role="status">Score publication withheld: the current score is incomplete.</p>}
    <div className="contest-log-scroll"><table><thead><tr><th>Packet</th><th>Destination</th><th>Delivery</th><th>Attempts</th><th>Review</th></tr></thead>
      <tbody>{snapshot?.rows.map(row=><tr key={row.id}><td>{row.kind}</td><td>{row.destination}</td><td>{row.outcome==="sent_unverified"?"Sent · remote result unverified":row.outcome==="attempting"?"Interrupted or pending · uncertain":row.outcome}{row.error&&` · ${row.error}`}</td>
        <td>{row.attempts}</td><td><code style={{overflowWrap:"anywhere"}}>{row.sha256}</code><label><input type="checkbox" disabled={disabled||retrying}
          checked={reviewed===reviewIdentity(row)} onChange={event=>setReviewed(event.target.checked?reviewIdentity(row):"")}/>I reviewed the consumer; duplicate delivery is possible · {row.kind}</label>
          <button type="button" disabled={disabled||retrying||reviewed!==reviewIdentity(row)} onClick={()=>void retry(row)}>Review retry {row.kind}</button></td></tr>)}</tbody></table></div>
    {snapshot&&!snapshot.rows.length&&<p>No optional datagram attempts are recorded for this session.</p>}
  </section>;
}
