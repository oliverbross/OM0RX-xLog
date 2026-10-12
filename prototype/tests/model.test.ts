import {describe,it,expect} from 'vitest';
import {reducer,initialState,spots,bandPosition,validateDraft} from '../src/model';
describe('synthetic station workflow',()=>{
 it('loads a cluster spot and publishes one coherent simulated frequency/mode',()=>{const s=reducer(initialState,{type:'spot',spot:spots[5]});expect(s.draft.call).toBe('N7A');expect(s.radio).toEqual({mhz:7.0294,mode:'CW'});expect(s.draft.sent).toBe('599');});
 it('preserves draft across profile switch and does not tune manual station',()=>{const s=reducer(reducer(initialState,{type:'field',field:'call',value:'DL1ABC'}),{type:'profile',profile:'manual'});expect(s.draft.call).toBe('DL1ABC');expect(reducer(s,{type:'spot',spot:spots[1]}).radio).toEqual(initialState.radio);});
 it('rejects invalid save without dropping draft',()=>{const s=reducer(initialState,{type:'log',id:'1',time:'now'});expect(s.qsos).toHaveLength(0);expect(s.error).toContain('callsign');});
 it('saves exactly once per action and preserves frequency for next contact',()=>{const s=reducer(reducer(initialState,{type:'spot',spot:spots[0]}),{type:'log',id:'1',time:'2026-10-12T00:00:00Z'});expect(s.qsos[0].call).toBe('W1AW');expect(s.draft.call).toBe('');expect(s.draft.frequency).toBe('14.240000');});
 it('placing a spot uses frequency rather than row order',()=>{expect(bandPosition(7.3,'40m')).toBe(0);expect(bandPosition(7,'40m')).toBe(100);expect(bandPosition(7.15,'40m')).toBeCloseTo(50);});
 it('checks frequency and report formats',()=>{expect(validateDraft({...initialState.draft,call:'W1AW',frequency:'NaN'})).toContain('Frequency');expect(validateDraft({...initialState.draft,call:'W1AW',sent:'abc'})).toContain('Reports');});
 it('rapid newer spot selection always wins',()=>{const s=spots.slice(0,3).reduce((state,spot)=>reducer(state,{type:'spot',spot}),initialState);expect(s.selected).toBe(spots[2].id);expect(s.radio.mhz).toBe(spots[2].mhz);});
});
