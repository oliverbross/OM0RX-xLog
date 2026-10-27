// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AnalyticsCandidateEvidence,AnalyticsLearningEvidence} from './ContestAnalyticsEvidence';
import {prepareAnalytics} from './contestAnalytics';
import {analyticsFixtureMeta,analyticsFixtureRows} from './contestAnalytics.fixtures';
import type {AnalyticsExport} from './contestAnalyticsExport';
import {flushUnfinishedEditors} from './unfinishedEditors';
afterEach(()=>{vi.restoreAllMocks();flushUnfinishedEditors();cleanup();localStorage.clear();});
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

it('recovers exact annotation text after unmount without mutating the log or exporting',()=>{
 const dataset=prepareAnalytics(analyticsFixtureMeta,analyticsFixtureRows),before=JSON.stringify(dataset),save=vi.fn(async()=>{}),props={dataset,onDrill:vi.fn(),exportState:{pending:false,save} as unknown as AnalyticsExport};
 const view=render(<AnalyticsLearningEvidence {...props}/>);fireEvent.change(screen.getByLabelText('Original learning evidence'),{target:{value:'unfinished\n  learning annotation ž'}});
 view.unmount();render(<AnalyticsLearningEvidence {...props}/>);
 expect((screen.getByLabelText('Original learning evidence') as HTMLTextAreaElement).value).toBe('unfinished\n  learning annotation ž');
 expect(save).not.toHaveBeenCalled();expect(JSON.stringify(dataset)).toBe(before);expect(screen.getByText(/Not exported/)).toBeTruthy();
});

it('retains a stale snapshot annotation for copy/discard and rejects silent application',()=>{
 const dataset=prepareAnalytics(analyticsFixtureMeta,analyticsFixtureRows),props={dataset,onDrill:vi.fn(),exportState:{pending:false,save:vi.fn()} as unknown as AnalyticsExport};
 const view=render(<AnalyticsLearningEvidence {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Show identity-bound evidence template'}));flushUnfinishedEditors();
 const original=(screen.getByLabelText('Original learning evidence') as HTMLTextAreaElement).value;
 view.rerender(<AnalyticsLearningEvidence {...props} dataset={{...dataset,meta:{...dataset.meta,identity:'later-snapshot'}}}/>);
 expect((screen.getByLabelText('Original learning evidence') as HTMLTextAreaElement).value).toBe(original);
 expect((screen.getByRole('button',{name:'Inspect learning evidence without correction'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByText(/no text was rebound/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Discard draft'}));expect((screen.getByLabelText('Original learning evidence') as HTMLTextAreaElement).value).toBe('');
});

it.each(['Export cancelled.',undefined])('retains the annotation after cancelled/failed export (%s)',async(outcome)=>{
 const dataset=prepareAnalytics(analyticsFixtureMeta,analyticsFixtureRows),save=vi.fn(async()=>outcome);
 render(<AnalyticsLearningEvidence dataset={dataset} onDrill={vi.fn()} exportState={{pending:false,save} as unknown as AnalyticsExport}/>);
 fireEvent.click(screen.getByRole('button',{name:'Show identity-bound evidence template'}));fireEvent.click(screen.getByRole('button',{name:'Inspect learning evidence without correction'}));
 fireEvent.click(await screen.findByRole('button',{name:'Save read-only learning review'}));await waitFor(()=>expect(save).toHaveBeenCalledOnce());
 expect((screen.getByLabelText('Original learning evidence') as HTMLTextAreaElement).value).toContain(dataset.meta.identity);expect(Object.values(localStorage).join()).toContain('xlog-learning-evidence');
});

it('archives malformed editor bytes only after a verified copy',()=>{
 const dataset=prepareAnalytics(analyticsFixtureMeta,analyticsFixtureRows),prefix=`xlog.contest.learning-editor.v1/${dataset.meta.workspaceGeneration}/${dataset.meta.sessionID}`;
 const raw='{"unfinished":"original bytes';localStorage.setItem(`${prefix}/broken`,raw);
 render(<AnalyticsLearningEvidence dataset={dataset} onDrill={vi.fn()} exportState={{pending:false} as AnalyticsExport}/>);
 const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota full');});
 fireEvent.click(screen.getByRole('button',{name:'Archive unreadable draft'}));expect(localStorage.getItem(`${prefix}/broken`)).toBe(raw);expect(screen.getByRole('alert').textContent).toContain('quota full');
 write.mockRestore();fireEvent.click(screen.getByRole('button',{name:'Archive unreadable draft'}));expect(localStorage.getItem(`${prefix}/broken`)).toBeNull();
 expect(Object.values(localStorage)).toContain(raw);
});
