from pathlib import Path
import os,re,json
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog/prototype')
out=Path(__file__).parent
if not (out/'node_modules').exists(): os.symlink(root/'node_modules',out/'node_modules',target_is_directory=True)
(out/'package.json').write_text('{"type":"module"}\n')
source=root/'src/live/DetachedQSOSurface.test.tsx'
text=source.read_text()
text=re.sub(r'''(["'])(\.{1,2}/[^"']+)\1''',lambda m:m[1]+str((source.parent/m[2]).resolve())+m[1],text)
text=text.replace('let current: DraftSnapshot = { generation: testWorkspaceGeneration, revision: 0, qso, power };',
  'let current: DraftSnapshot & {automaticStart:boolean} = { generation: testWorkspaceGeneration, revision: 0, qso, power, automaticStart:true };')
text=text.replace('current = { generation: testWorkspaceGeneration, revision: current.revision + 1, qso: next, power: nextPower };',
  'current = { generation: testWorkspaceGeneration, revision: current.revision + 1, qso: next, power: nextPower, automaticStart:mutation.action === "replace" ? (next.start !== current.qso.start || next.end !== current.qso.end ? false : current.automaticStart) : true };')
imports='''import { draftPowerDescription } from "ROOT/src/live/QSOEditorCore";
import { validScopedSnapshot, validDraftPower } from "ROOT/src/live/operatorDraftSession";
'''.replace('ROOT',str(root))
text=imports+text
text+='''
it.each(["Simple","Full"])("VERIFY CR-008 manual UTC survives transition into %s",async nextMode=>{
  const f=backend();api.draft.mockImplementation(f.request);
  vi.setSystemTime(new Date("2026-10-28T12:34:56Z"));
  render(<DetachedQSOSurface/>);
  await waitFor(()=>expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("K1ABC"));
  fireEvent.change(screen.getByLabelText("Start UTC date"),{target:{value:"2026-10-20"}});
  fireEvent.change(screen.getByLabelText("Start UTC time"),{target:{value:"10:15:30"}});
  await waitFor(()=>expect(f.current.qso.start).toBe("2026-10-20T10:15:30Z"));
  expect(f.current.automaticStart).toBe(false);
  expect(validScopedSnapshot(f.current)).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"Simple"}));
  if(nextMode==="Full")fireEvent.click(screen.getByRole("button",{name:"Full"}));
  const day=(screen.getByLabelText(nextMode==="Full"?"Start UTC date":"Desk UTC date") as HTMLInputElement).value;
  const time=(screen.getByLabelText(nextMode==="Full"?"Start UTC time":"Desk UTC time") as HTMLInputElement).value;
  console.log("VERIFY CR-008",JSON.stringify({nextMode,day,time,canonicalStart:f.current.qso.start,canonicalAutomaticStart:f.current.automaticStart}));
  expect(day).toBe("2026-10-20");expect(time).toBe("10:15:30");
});
it.each(["radio_output","kpa500_output"] as const)("VERIFY CR-010 source label for valid %s sample",source=>{
  const f=backend();f.meter(55);
  const power=f.current.power!;
  power.selectedSample!.source=source;power.selectedContext!.meterSource=source;
  power.lastContext!.meterSource=source;
  expect(validDraftPower(power)).toBe(true);expect(validScopedSnapshot(f.current)).toBe(true);
  const expected=source==="radio_output"?"radio":"KPA500";
  const description=draftPowerDescription(f.current.qso,power);
  console.log("VERIFY CR-010",JSON.stringify({source,validSample:true,description}));
  expect(description).toContain(expected);
});
'''
(out/'frontend-verification.test.tsx').write_text(text)
alias={
  'vitest':str((root/'node_modules/vitest/dist/index.js').resolve()),
  'react/jsx-dev-runtime':str((root/'node_modules/react/jsx-dev-runtime.js').resolve()),
  'react/jsx-runtime':str((root/'node_modules/react/jsx-runtime.js').resolve()),
}
(out/'vitest-verification.config.ts').write_text("import base from '"+str(root/'vite.config.ts')+"';\nexport default {...base,root:"+repr(str(out.resolve()))+",resolve:{alias:"+json.dumps(alias)+"},server:{fs:{allow:["+repr(str(root))+","+repr(str(out.resolve()))+"]}},test:{include:['frontend-verification.test.tsx','codec-verification.test.ts','additional-probes.test.tsx'],environment:'jsdom',maxWorkers:1}};\n")
print(out/'frontend-verification.test.tsx')
