import {invoke,isTauri} from '@tauri-apps/api/core';
export const desktop = isTauri();
export async function workerRequest(method:string,params:Record<string,unknown>={}) {
 if(!desktop)throw new Error('Browser preview has no Swift worker. Launch the desktop prototype to run this check.');
 const response = await invoke<{id:string;ok:boolean;result?:unknown;error?:unknown}>('worker_request',{request:{id:crypto.randomUUID(),method,params}});
 if(!response.ok)throw new Error(`Swift worker rejected ${method}: ${JSON.stringify(response.error)}`);
 return response;
}
export async function openMonitor(){if(desktop){await invoke('open_monitor');return 'Detached station monitor opened';}const w=window.open(`${window.location.pathname}?monitor=1`,'xlog-p1-monitor','width=760,height=660');if(!w)throw new Error('Monitor preview was blocked. Allow popups and try again.');return 'Browser monitor preview opened';}
