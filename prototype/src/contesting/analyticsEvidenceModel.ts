import { conditionalContactGain,type AnalyticsDataset } from './contestAnalytics';

/** Candidate geography comes only from an explicitly selected immutable contact.
 * A received zone must be supplied; historical heard zones are not a forecast.
 * No station lookup, draft load, tune, output or log mutation belongs here.
 */
export function analyticalCandidate(dataset:AnalyticsDataset,sourceID:string,band:string,receivedZone:string,points:number){
 const unavailable=(reason:string)=>({status:'UNVERIFIED' as const,reason,identity:dataset.meta.identity,ids:[] as string[]});
 if(!['cq_ww_cw','cq_ww_ssb'].includes(dataset.meta.pluginID)||!dataset.meta.cqWW||!dataset.meta.multiplierAdapter&&dataset.meta.hostEvidence)
   return unavailable('Only reconciled CQ WW CW/SSB analytical copies have this adapter.');
 const source=dataset.contacts.find(row=>row.id===sourceID);
 if(!source||source.country==='Unknown')return unavailable('Select a contact with a saved country identity. New unresolved calls remain unverified.');
 if(!['160m','80m','40m','20m','15m','10m'].includes(band))return unavailable('Choose a supported contest band.');
 const category=String(dataset.meta.settings.BandCategory??'ALL').toLowerCase();
 if(category!=='all'&&category!==band)return unavailable('The proposed band is outside this claimed category.');
 const duplicate=dataset.contacts.some(row=>row.call===source.call&&row.band===band);
 const countryRows=dataset.contacts.filter(row=>row.inCategory&&row.multiplierEligible===true&&row.band===band&&row.country===source.country);
 const zone=receivedZone.trim(),knownZone=/^(?:[1-9]|[1-3][0-9]|40)$/.test(zone);
 const zoneRows=knownZone?dataset.contacts.filter(row=>row.inCategory&&row.multiplierEligible===true&&row.band===band&&row.zone===zone):[];
 const newCountry=!duplicate&&countryRows.length===0,newZone=knownZone?!duplicate&&zoneRows.length===0:null;
 const gain=duplicate?0:newZone===null?null:conditionalContactGain(dataset.meta,points,Number(newCountry)+Number(newZone));
 return {status:'PASS' as const,identity:dataset.meta.identity,sourceID,call:source.call,country:source.country,band,duplicate,
   receivedZone:knownZone?zone:null,newCountry,newZone,conditionalGain:gain,
   reason:'Saved country evidence from the selected contact; received zone and QSO points are explicit assumptions. Unknown zone has no guaranteed multiplier or gain. No live station preview is used.',
   ids:[...new Set([sourceID,...countryRows.map(row=>row.id),...zoneRows.map(row=>row.id)])]};
}

export type LearningFinding={qsoID:string;status:'accepted'|'not-in-log'|'exchange'|'duplicate'|'operator-note';note:string};
export type LearningEvidence={schemaVersion:1;format:'xlog-learning-evidence';logIdentity:string;source:string;findings:LearningFinding[]};
export function inspectLearningEvidence(dataset:AnalyticsDataset,text:string):LearningEvidence{
 if(new TextEncoder().encode(text).length>1024*1024)throw Error('Learning evidence exceeds 1 MiB; nothing was imported.');
 let value:unknown;try{value=JSON.parse(text);}catch{throw Error('Unsupported LCR/UBN or malformed input. Only the documented xlog-learning-evidence JSON is accepted; original input is retained.');}
 const document=value as LearningEvidence;
 if(!document||typeof document!=='object'||Object.keys(document).sort().join(',')!=='findings,format,logIdentity,schemaVersion,source'||document.schemaVersion!==1||document.format!=='xlog-learning-evidence')
   throw Error('Unsupported adjudication format; no organizer-specific conversion or automatic correction is supplied.');
 if(document.logIdentity!==dataset.meta.identity)throw Error('Evidence belongs to another immutable log identity. Refresh/reconcile it explicitly.');
 if(typeof document.source!=='string'||!document.source.trim()||document.source.length>256||!Array.isArray(document.findings)||document.findings.length>5000)throw Error('Invalid bounded learning evidence.');
 const ids=new Set(dataset.contacts.map(row=>row.id)),seen=new Set<string>();
 for(const row of document.findings){
   if(!row||typeof row!=='object'||Object.keys(row).sort().join(',')!=='note,qsoID,status'||typeof row.qsoID!=='string'||!ids.has(row.qsoID)||seen.has(row.qsoID)||!['accepted','not-in-log','exchange','duplicate','operator-note'].includes(row.status)||typeof row.note!=='string'||row.note.length>2048)
     throw Error('Invalid, repeated or unmatched contributing contact. No annotations were accepted.');
   seen.add(row.qsoID);
 }
 return document;
}
