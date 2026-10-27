// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {ContestHistoricalImport} from './ContestHistoricalImport';
import type {ContestRequest} from './types';
vi.mock('./contestAdifImport',()=>({historicalADIFRecords:vi.fn(async()=>[{raw:{CALL:'K1ABC'},metadata:null,sourceSHA256:'a'.repeat(64)}])}));
afterEach(cleanup);
const scope={sessionID:'session',workspaceGeneration:'workspace',revision:7,draftID:'original'};
it('requires full read-only review and invalidates application after an external revision change',async()=>{
 const request=vi.fn(async()=>({id:'read',ok:true,result:{qsoID:'qso1',status:'ready',fields:{callsign:'K1ABC'},timestamp:'2026-10-21 10:00:00',frequencyHz:14025000,family:'serial',radioAttribution:'unknown'}})) as unknown as ContestRequest;
 const onApply=vi.fn(async()=>{}),props={scope,request,disabled:false,onApply};
 const mounted=render(<ContestHistoricalImport {...props}/>);
 fireEvent.change(screen.getByLabelText('Historical ADIF file'),{target:{files:[{arrayBuffer:async()=>new ArrayBuffer(0)}]}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Review all source contacts'})).toHaveProperty('disabled',false));
 expect(onApply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Review all source contacts'}));
 await screen.findByRole('button',{name:'Apply reviewed historical contacts'});
 expect(request).toHaveBeenCalledWith('contest_strategy',expect.objectContaining({section:'adif_preview',expectedRevision:7}));
 mounted.rerender(<ContestHistoricalImport {...props} scope={{...scope,revision:8}}/>);
 expect(screen.queryByRole('button',{name:'Apply reviewed historical contacts'})).toBeNull();expect(onApply).not.toHaveBeenCalled();
});
