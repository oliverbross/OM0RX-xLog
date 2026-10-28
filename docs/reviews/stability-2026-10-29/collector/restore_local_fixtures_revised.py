"""Restore preserved local frontend/CW fixtures only after the final plan passes."""
from pathlib import Path
import datetime
import json
from collector_common import (ROOT, TASK, assert_gates, assert_head, parse_plan,
                              read_json, sha, source_snapshot, suite_counts, write_json)

def hashes(directory):
    return {str(path.relative_to(directory)): sha(path)
            for path in directory.rglob('*') if path.is_file()}

def main():
    plan = parse_plan()
    assert plan.get('restoreQuiescent') is True, 'Parent must confirm no tests/builds use the frontend trees'
    assert_head(plan)
    source = source_snapshot(plan)
    assert_gates(plan)
    suite_counts(plan)
    baseline = read_json(TASK / 'baseline.json')
    owned = ROOT / '.build/phase5-20261029'
    original_node = owned / 'original-node_modules'
    current_node = ROOT / 'prototype/node_modules'
    original_dist = owned / 'original-dist'
    current_dist = ROOT / 'prototype/dist'
    final_node = Path(plan.get('freshNodeModulesDestination', str(owned / 'final-validated-node_modules')))
    final_dist = Path(plan.get('freshDistDestination', str(owned / 'final-built-dist')))
    for path in [original_node, current_node, original_dist, current_dist]:
        assert path.is_dir() and not path.is_symlink(), path
    for path in [final_node, final_dist]:
        assert path.parent.resolve() == owned.resolve() and not path.exists() and not path.is_symlink(), path
    assert original_node.stat().st_ino == baseline['nodeModulesInode'] == 560040948
    assert hashes(original_dist) == baseline['distHashes']
    assert len(baseline['distHashes']) == 180
    cw = ROOT / '.build/cw-native'
    assert cw.is_dir() and not cw.is_symlink()
    assert cw.stat().st_ino == plan.get('originalCWInode', 589158794)
    fresh_hashes = hashes(current_dist)
    moves = [(current_node, final_node), (original_node, current_node),
             (current_dist, final_dist), (original_dist, current_dist)]
    completed = []
    try:
        for source_path, destination in moves:
            assert not destination.exists() and not destination.is_symlink(), destination
            source_path.rename(destination)
            completed.append((source_path, destination))
        assert current_node.stat().st_ino == baseline['nodeModulesInode']
        assert hashes(current_dist) == baseline['distHashes']
        source_snapshot(plan)
    except BaseException:
        for source_path, destination in reversed(completed):
            if destination.exists() and not source_path.exists():
                destination.rename(source_path)
        raise
    receipt = {'restoredUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'sourceHead': plan['head'], 'nodeModulesOriginalInode': current_node.stat().st_ino,
               'originalDistFiles': len(baseline['distHashes']), 'originalDistHashesMatch': True,
               'cwOriginalInode': cw.stat().st_ino,
               'freshNodeModulesPreserved': str(final_node), 'freshDistPreserved': str(final_dist),
               'freshDistHashes': fresh_hashes, 'finalSourceFilesVerified': len(source)}
    write_json(TASK / 'restoration-final.json', receipt)
    print(json.dumps({key: value for key, value in receipt.items() if key != 'freshDistHashes'}))

if __name__ == '__main__':
    main()
