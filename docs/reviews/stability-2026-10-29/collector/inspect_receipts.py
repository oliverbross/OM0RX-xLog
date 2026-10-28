from pathlib import Path
import json

task = Path('/tmp/xlog-phase5-20261029-721e0705')
for path in sorted((task / 'logs').glob('*.json')):
    if '.running.' in path.name:
        continue
    try:
        value = json.loads(path.read_text())
    except ValueError:
        continue
    if value.get('exitCode') not in (None, 0) or path.stem.startswith(('SEAL-', 'ITER9', 'ITER10', 'ITER11', 'CI-FINAL', 'PORTABLE-IQ', 'CURRENT-')):
        print(path.stem, 'exit=', value.get('exitCode'), 'timeout=', value.get('timedOut'), 'duration=', value.get('durationSeconds'), 'head=', value.get('sourceHeadAtStart'))
print('TOP-LEVEL JSON')
for path in sorted(task.glob('*.json')):
    if any(part in path.name for part in ['seal', 'ci', 'supersed', 'source', 'platform']):
        print(path.name)
