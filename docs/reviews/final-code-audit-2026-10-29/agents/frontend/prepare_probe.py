from pathlib import Path

root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog/prototype')
out = Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/frontend')
s = (root / 'src/live/DetachedQSOSurface.test.tsx').read_text().split('it.each(["Simple", "Full"])')[0]
s = s.replace('"./', '"' + str(root / 'src/live') + '/')
s = s.replace('"../../tests/', '"' + str(root / 'tests') + '/')
s = s.replace('"../windowSurface"', '"' + str(root / 'src/windowSurface') + '"')
s = s.replace('"../worker"', '"' + str(root / 'src/worker') + '"')
s += '''
it("PHASE6 immediate valid manual UTC remount must preserve displayed date", async () => {
  const f = backend(); api.draft.mockImplementation(f.request);
  vi.setSystemTime(new Date("2026-10-28T12:34:56Z"));
  render(<DetachedQSOSurface />); await screen.findByDisplayValue("K1ABC");
  fireEvent.change(screen.getByLabelText("Start UTC date"), { target: { value: "2026-10-20" } });
  fireEvent.change(screen.getByLabelText("Start UTC time"), { target: { value: "10:15:30" } });
  expect(journal().draft.start).toBe("2026-10-20T10:15:30Z");
  expect(journal().base.automaticStart).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Simple" }));
  expect((screen.getByLabelText("Desk UTC date") as HTMLInputElement).value).toBe("2026-10-20");
});
'''
(out / 'manual-remount.test.tsx').write_text(s)
(out / 'vitest.config.mjs').write_text('''import { defineConfig } from "/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/node_modules/vite/dist/node/index.js";
import react from "/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/node_modules/@vitejs/plugin-react/dist/index.js";
export default defineConfig({plugins:[react()],test:{include:["/tmp/xlog-phase6-20261029-0ce97a12/agents/frontend/manual-remount.test.tsx"],maxWorkers:1}});
''')
if not (out / 'node_modules').exists():
    (out / 'node_modules').symlink_to(root / 'node_modules', target_is_directory=True)
