// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {flushUnfinishedEditors,UnfinishedRecovery,useUnfinishedEditor} from './unfinishedEditors';
const valid=(value:unknown):value is {identity:string}=>!!value&&typeof (value as {identity:string}).identity==='string';
function Editor(){const editor=useUnfinishedEditor('test-unsent',valid,1000);return <section><UnfinishedRecovery editor={editor}/><textarea aria-label="Text" value={editor.draft?.text??''} onChange={event=>editor.update({identity:'original'},event.target.value)}/></section>;}
afterEach(()=>{vi.restoreAllMocks();act(()=>flushUnfinishedEditors());cleanup();localStorage.clear();vi.useRealTimers();});
it('writes at a bounded deadline during continuous typing and flushes the last pending input on navigation',()=>{
 vi.useFakeTimers();render(<Editor/>);const field=screen.getByLabelText('Text'),write=vi.spyOn(Storage.prototype,'setItem');
 for(let n=0;n<3;n++){fireEvent.change(field,{target:{value:`text ${n}`}});act(()=>vi.advanceTimersByTime(100));}
 expect(write).toHaveBeenCalledOnce();expect(Object.values(localStorage).join()).toContain('text 2');
 fireEvent.change(field,{target:{value:'last unblurred bytes'}});expect(write).toHaveBeenCalledOnce();act(()=>flushUnfinishedEditors());expect(write).toHaveBeenCalledTimes(2);expect(Object.values(localStorage).join()).toContain('last unblurred bytes');
});
it('two simultaneously mounted editors create separate records without overwriting either',()=>{
 const a=render(<Editor/>),b=render(<Editor/>);
 fireEvent.change(within(a.container).getByLabelText('Text'),{target:{value:'editor A'}});fireEvent.change(within(b.container).getByLabelText('Text'),{target:{value:'editor B'}});
 act(()=>flushUnfinishedEditors());expect(localStorage.length).toBe(2);expect(Object.values(localStorage).join()).toContain('editor A');expect(Object.values(localStorage).join()).toContain('editor B');
});
it('a concurrently changed recovery cannot be silently overwritten',()=>{
 const a=render(<Editor/>);fireEvent.change(screen.getByLabelText('Text'),{target:{value:'original'}});act(()=>flushUnfinishedEditors());
 const key=localStorage.key(0)!,raw=localStorage.getItem(key)!;localStorage.setItem(key,raw.replace('original','external'));
 expect(()=>act(()=>flushUnfinishedEditors())).toThrow(/another editor/);expect(localStorage.getItem(key)).toContain('external');
 // Restore the external fixture only so cleanup can release the failed writer.
 localStorage.setItem(key,raw);act(()=>flushUnfinishedEditors());a.unmount();
});
it('storage read failure is disclosed and new text stays available until storage recovers',()=>{
 const read=vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw Error('storage unavailable');});
 render(<Editor/>);fireEvent.change(screen.getByLabelText('Text'),{target:{value:'keep in memory'}});
 expect(()=>act(()=>flushUnfinishedEditors())).toThrow(/storage unavailable/);expect((screen.getByLabelText('Text') as HTMLTextAreaElement).value).toBe('keep in memory');
 read.mockRestore();act(()=>flushUnfinishedEditors());expect(Object.values(localStorage).join()).toContain('keep in memory');
});
