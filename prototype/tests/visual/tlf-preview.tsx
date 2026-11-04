// Disposable visual fixture. No worker, physical output or production storage.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {mockIPC} from '@tauri-apps/api/mocks';
import {ContestQTC} from '../../src/contesting/ContestQTC';
import '../../src/style.css';
import '../../src/live/live.css';
import '../../src/contesting/ContestWorkspace.css';
import '../../src/contesting/ContestProductivityTools.css';
mockIPC(()=>null);
const data:any={available:true,ruleEdition:'DARC 2026 · isolated fixture',eligibility:null,
  score:{qtcPoints:1,total:24},eligibleSources:[],operating:{schema:1,workspace:{},observations:{},attempts:[]},batches:[
    {id:'fixture-series',number:3,count:2,direction:'receive',counterpart:'K1ABC',timestamp:'2026-08-08 09:00:00',frequencyHz:14025000,status:'open',
      items:[{time:'0832',callsign:'JA1ABC',serial:'012',status:'confirmed',repeats:[]},{time:'0834',callsign:'VK2ABC',serial:'047',status:'pending',repeats:[]}]}]};
const scope={sessionID:'11111111-1111-4111-8111-111111111111',workspaceGeneration:'22222222-2222-4222-8222-222222222222',revision:1,draftID:'33333333-3333-4333-8333-333333333333',frequencyHz:14025000};
createRoot(document.getElementById('root')!).render(<div className="app live" style={{display:'block',height:'100vh',overflow:'auto',padding:24}}><main style={{display:'block',width:'100%',maxWidth:1200,margin:'0 auto',overflow:'visible'}}>
  <p role="status">ISOLATED VISUAL FIXTURE · all native output disabled</p><ContestQTC scope={scope} request={async()=>({id:'fixture',ok:true,result:structuredClone(data)}) as any}
    disabled={false} onMutate={async()=>data} onEntry={()=>{}} onOutput={async()=>({disabled:true})} onStop={async()=>({disabled:true})}/></main></div>);
