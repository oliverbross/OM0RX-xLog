from pathlib import Path
root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog/prototype')
out = Path('/tmp/xlog-phase6-20261029-0ce97a12/agents/frontend')
for name in ['QSOEditorCore','OperatorDesk','DetachedQSOSurface']:
    p=out/(name+'.baseline.tsx')
    s=p.read_text().replace('"./','"'+str(root/'src/live')+'/').replace('"../worker"','"'+str(root/'src/worker')+'"')
    if name == 'DetachedQSOSurface':
        s=s.replace(str(root/'src/live/QSOEditorCore'),str(out/'QSOEditorCore.baseline'))
        s=s.replace(str(root/'src/live/OperatorDesk'),str(out/'OperatorDesk.baseline'))
    p.write_text(s)
s=(out/'manual-remount.test.tsx').read_text()
s=s.replace(str(root/'src/live/DetachedQSOSurface'),str(out/'DetachedQSOSurface.baseline'))
# Retain the one display requirement and next-edit characterization. Baseline
# direct Save ignores component payload in this detached surface, so it retains
# native manual time too; both paths use the same unchanged session backend.
(out/'manual-remount-baseline.test.tsx').write_text(s)
(out/'vitest-baseline.config.mjs').write_text((out/'vitest.config.mjs').read_text().replace('manual-remount.test.tsx','manual-remount-baseline.test.tsx'))
