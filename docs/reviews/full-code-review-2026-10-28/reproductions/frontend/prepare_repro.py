import re, os
from pathlib import Path
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog/prototype')
out=Path(__file__).parent
if not (out/'node_modules').exists(): os.symlink(root/'node_modules',out/'node_modules',target_is_directory=True)
(out/'package.json').write_text('{"type":"module"}\n')
source=root/'src/live/DetachedQSOSurface.test.tsx'
text=source.read_text()
def absolute(match):
    value=match[2]
    if not value.startswith('.'):
        return match[0]
    return match[1]+str((source.parent/value).resolve())+match[1]
text=re.sub(r'''(["'])(\.{1,2}/[^"']+)\1''',absolute,text)
text='import { draftPowerDescription } from "'+str(root/'src/live/QSOEditorCore')+'";\n'+text
text=text.replace('let current: DraftSnapshot = { generation: testWorkspaceGeneration, revision: 0, qso, power };',
    'let current: DraftSnapshot & {automaticStart:boolean} = { generation: testWorkspaceGeneration, revision: 0, qso, power, automaticStart:true };')
text=text.replace('current = { generation: testWorkspaceGeneration, revision: current.revision + 1, qso: next, power: nextPower };',
    'current = { generation: testWorkspaceGeneration, revision: current.revision + 1, qso: next, power: nextPower, automaticStart:mutation.action === "replace" ? (next.start !== current.qso.start || next.end !== current.qso.end ? false : current.automaticStart) : true };')
for package in ['react','@testing-library/react']:
    text=text.replace('from "'+package+'"','from "'+str(root/'node_modules'/package)+'"')
text+='''
it.each(["Simple","Full"])("REVIEW proves detached %s commits displayed current UTC",async mode=>{
  const f=backend();api.draft.mockImplementation(f.request);
  vi.setSystemTime(new Date("2026-10-28T12:34:56Z"));
  render(<DetachedQSOSurface/>);
  await waitFor(()=>expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("K1ABC"));
  fireEvent.click(screen.getByRole("button",{name:mode}));
  const date=screen.getByLabelText(mode==="Full"?"Start UTC date":"Desk UTC date") as HTMLInputElement;
  expect(date.value).toBe("2026-10-28");
  fireEvent.click(screen.getByRole("button",{name:"Log QSO"}));
  await waitFor(()=>expect(f.contacts.length).toBe(1));
  console.log("REVIEW timestamp",JSON.stringify({mode,displayedDate:date.value,savedStart:f.contacts[0].start}));
  expect(f.contacts[0].start).toBe("2026-10-28T12:34:56.000Z");
});
it("REVIEW retains manual UTC across detached editor mode change",async()=>{
  const f=backend();api.draft.mockImplementation(f.request);
  vi.setSystemTime(new Date("2026-10-28T12:34:56Z"));
  render(<DetachedQSOSurface/>);
  await waitFor(()=>expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("K1ABC"));
  fireEvent.change(screen.getByLabelText("Start UTC date"),{target:{value:"2026-10-20"}});
  fireEvent.change(screen.getByLabelText("Start UTC time"),{target:{value:"10:15:30"}});
  await waitFor(()=>expect(f.current.qso.start).toBe("2026-10-20T10:15:30Z"));
  expect(f.current.automaticStart).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Simple"}));
  console.log("REVIEW manual timestamp",JSON.stringify({mode:"Simple",displayedDate:(screen.getByLabelText("Desk UTC date") as HTMLInputElement).value,displayedTime:(screen.getByLabelText("Desk UTC time") as HTMLInputElement).value,retainedStart:f.current.qso.start,automaticStart:f.current.automaticStart}));
  expect((screen.getByLabelText("Desk UTC date") as HTMLInputElement).value).toBe("2026-10-20");
  expect((screen.getByLabelText("Desk UTC time") as HTMLInputElement).value).toBe("10:15:30");
});
it("REVIEW describes captured radio output using its actual source",()=>{
  const f=backend();f.meter(55);
  f.current.power!.selectedSample!.source="radio_output";
  f.current.power!.selectedContext!.meterSource="radio_output";
  console.log("REVIEW power description",draftPowerDescription(f.current.qso,f.current.power));
  expect(draftPowerDescription(f.current.qso,f.current.power)).toContain("radio");
});
'''
(out/'detached-time.test.tsx').write_text(text)
(out/'vitest-review.config.ts').write_text("import base from '"+str(root/'vite.config.ts')+"';\nexport default {...base, root:"+repr(str(out.resolve()))+", resolve:{alias:{'vitest':"+repr(str((root/'node_modules/vitest/dist/index.js').resolve()))+",'react/jsx-dev-runtime':"+repr(str((root/'node_modules/react/jsx-dev-runtime.js').resolve()))+",'react/jsx-runtime':"+repr(str((root/'node_modules/react/jsx-runtime.js').resolve()))+"}}, server:{fs:{allow:["+repr(str(root))+","+repr(str(out.resolve()))+"]}}, test:{include:['detached-time.test.tsx'], environment:'jsdom',maxWorkers:1}};\n")
print(out/'detached-time.test.tsx')
