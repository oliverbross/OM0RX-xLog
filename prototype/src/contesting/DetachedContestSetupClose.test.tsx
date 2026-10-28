// @vitest-environment jsdom
import {useEffect} from 'react';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {DetachedContestSetupSurface} from './DetachedContestSetupSurface';
const native=vi.hoisted(()=>({ready:vi.fn(),close:null as (()=>void)|null,invoke:vi.fn(async()=>{}),prepare:vi.fn(async()=>{}),freeze:vi.fn(),resume:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({isTauri:()=>true,invoke:native.invoke}));
vi.mock('@tauri-apps/api/window',()=>({getCurrentWindow:()=>({listen:async(_event:string,callback:()=>void)=>{native.close=callback;return ()=>{};}})}));
vi.mock('../operatingModule',()=>({operatingModuleStatus:async()=>({context:'contesting'})}));
vi.mock('../operatingModulePreparation',()=>({prepareOperatingModuleTransition:()=>()=>{}}));
vi.mock('../worker',()=>({framedWorkerRequest:vi.fn(),workerRequest:async(method:string)=>({result:method==='health'?{mode:'contesting_test'}:method==='workspace_status'?{workspace_exists:true}:{generation:'workspace',settings:{stationCall:'OM0RX'}}})}));
vi.mock('../live/workspaceNavigation',()=>({connectWorkspaceNavigation:()=>()=>{},isContestMenuRoute:()=>false}));
vi.mock('./Not1MMContestWorkspace',()=>({Not1MMContestWorkspace:({registerTransition}:{registerTransition:(value:unknown)=>void})=>{useEffect(()=>{registerTransition({prepare:native.prepare,freeze:native.freeze,resume:native.resume});native.ready();return()=>registerTransition(null);},[registerTransition]);return <p>Disposable contest owner</p>;}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('keeps a failed close visible after bootstrap and acknowledges hide only after successful preparation',async()=>{
 native.prepare.mockRejectedValueOnce(Error('draft write quota exhausted'));
 render(<DetachedContestSetupSurface/>);await screen.findByText('Disposable contest owner');
 await waitFor(()=>expect(native.ready).toHaveBeenCalled());
 act(()=>native.close!());await screen.findByText(/Close cancelled; unfinished work remains open/);
 expect(screen.getByRole('alert').textContent).toContain('quota exhausted');expect(native.invoke).not.toHaveBeenCalledWith('hide_prepared_contest_owner');
 expect(native.resume).toHaveBeenCalledOnce();
 act(()=>native.close!());await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith('hide_prepared_contest_owner'));
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
});
