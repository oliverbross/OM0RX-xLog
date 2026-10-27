// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AnalyticsCandidateEvidence,AnalyticsLearningEvidence} from './ContestAnalyticsEvidence';
import {prepareAnalytics} from './contestAnalytics';
import {analyticsFixtureMeta,analyticsFixtureRows} from './contestAnalytics.fixtures';
import type {AnalyticsExport} from './contestAnalyticsExport';
afterEach(cleanup);
it('opens contributing candidate evidence without output and exports only reviewed normalized learning claims',async()=>{
 const dataset=prepareAnalytics(analyticsFixtureMeta,analyticsFixtureRows),before=JSON.stringify(dataset),onDrill=vi.fn(),save=vi.fn(async()=>{});
 const exporter={pending:false,save} as unknown as AnalyticsExport;
 render(<><AnalyticsCandidateEvidence dataset={dataset} onDrill={onDrill}/><AnalyticsLearningEvidence dataset={dataset} onDrill={onDrill} exportState={exporter}/></>);
 fireEvent.change(screen.getByLabelText('Analytical candidate source'),{target:{value:'a'}});
 fireEvent.change(screen.getByLabelText('Analytical candidate band'),{target:{value:'40m'}});
 expect(screen.getByText(/zone unknown · conditional gain unverified/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Open candidate evidence contacts'}));expect(onDrill).toHaveBeenCalledWith(expect.any(String),['a']);
 fireEvent.click(screen.getByRole('button',{name:'Show identity-bound evidence template'}));
 fireEvent.click(screen.getByRole('button',{name:'Inspect learning evidence without correction'}));
 await screen.findByRole('button',{name:'Save read-only learning review'});
 fireEvent.click(screen.getByRole('button',{name:'Save read-only learning review'}));
 await waitFor(()=>expect(save).toHaveBeenCalledOnce());
 const exported=JSON.parse(save.mock.calls[0][1]());expect(exported).toMatchObject({snapshotIdentity:dataset.meta.identity,contactMutations:0,sourceClaimsVerified:false});
 expect(exported.sourceSHA256).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(dataset)).toBe(before);
});
