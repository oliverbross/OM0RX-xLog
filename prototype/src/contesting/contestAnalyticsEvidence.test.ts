import {expect,it} from 'vitest';
import {analyticalCandidate,inspectLearningEvidence} from './analyticsEvidenceModel';
import {prepareAnalytics} from './contestAnalytics';
import {analyticsFixtureMeta,analyticsFixtureRows} from './contestAnalytics.fixtures';

it('keeps received-zone uncertainty and immutable evidence separate from assumed CQ WW gains',()=>{
 for(const pluginID of ['cq_ww_cw','cq_ww_ssb']){
  const dataset=prepareAnalytics({...analyticsFixtureMeta,pluginID},analyticsFixtureRows),before=JSON.stringify(dataset);
  const unknown=analyticalCandidate(dataset,'a','40m','',3);expect(unknown).toMatchObject({status:'PASS',newCountry:true,newZone:null,conditionalGain:null,receivedZone:null});
  const known=analyticalCandidate(dataset,'a','40m','5',3);expect(known).toMatchObject({status:'PASS',newCountry:true,newZone:true,conditionalGain:33});
  expect(analyticalCandidate(dataset,'a','20m','5',3)).toMatchObject({duplicate:true,newCountry:false,newZone:false,conditionalGain:0});
  expect(analyticalCandidate(dataset,'unresolved','40m','5',3).status).toBe('UNVERIFIED');expect(JSON.stringify(dataset)).toBe(before);
 }
});
it('rejects unsupported adjudication formats, stale identities and unmatched contacts without changing evidence',()=>{
 const dataset=prepareAnalytics(analyticsFixtureMeta,analyticsFixtureRows),before=JSON.stringify(dataset);
 const evidence={schemaVersion:1,format:'xlog-learning-evidence',logIdentity:dataset.meta.identity,source:'Operator transcription of local paper note',findings:[{qsoID:'a',status:'exchange',note:'Review accuracy; do not correct'}]};
 expect(inspectLearningEvidence(dataset,JSON.stringify(evidence))).toEqual(evidence);
 for(const changed of [{...evidence,logIdentity:'another'},{...evidence,findings:[{...evidence.findings[0],qsoID:'unknown'}]},{...evidence,format:'UBN'}])expect(()=>inspectLearningEvidence(dataset,JSON.stringify(changed))).toThrow();
 expect(()=>inspectLearningEvidence(dataset,'CALLSIGN: K1ABC NIL')).toThrow('Unsupported LCR/UBN');expect(JSON.stringify(dataset)).toBe(before);
});
