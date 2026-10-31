import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('stage-contest-runtime.py')
spec = importlib.util.spec_from_file_location('contest_stager', SCRIPT)
stager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stager)


class ContestHostStagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        subprocess.run(['git', 'init', '--quiet', str(self.repo)], check=True)
        for name in ['python/contest_host/launcher.py', 'python/vendor/not1mm/upstream/plugin.py']:
            source = self.repo / name
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text('# Synthetic tracked runtime\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'python'], check=True)
        self.destination = self.root / 'package'
        self.destination.mkdir()

    def test_untracked_private_files_and_tests_are_excluded(self):
        (self.repo / 'python/contest_host/private.json').write_text('{"accountToken":"synthetic-do-not-copy"}')
        tests = self.repo / 'python/tests'
        tests.mkdir()
        (tests / 'fixture.json').write_text('{"call":"TEST1","start":1}')
        with patch.object(stager, 'ROOT', self.repo):
            result = stager.stage_host(self.destination)
        self.assertEqual(len(result['files']), 2)
        self.assertFalse(list(self.destination.rglob('*.json')))
        self.assertTrue((self.destination / 'Not1MM/python/contest_host/launcher.py').is_file())

    def test_existing_destination_is_preserved(self):
        target = self.destination / 'Not1MM/python'
        target.mkdir(parents=True)
        (target / 'keep').write_bytes(b'keep')
        with patch.object(stager, 'ROOT', self.repo), self.assertRaises(ValueError):
            stager.stage_host(self.destination)
        self.assertEqual((target / 'keep').read_bytes(), b'keep')

    @unittest.skipIf(sys.platform == 'win32', 'Fixture symlink privilege is not assumed')
    def test_tracked_file_cannot_escape_through_changed_parent_symlink(self):
        source = self.repo / 'python/contest_host'
        source.rename(self.root / 'moved-host')
        source.symlink_to(self.root / 'moved-host', target_is_directory=True)
        with patch.object(stager, 'ROOT', self.repo), self.assertRaises(ValueError):
            stager.stage_host(self.destination)

    def test_isolated_host_only_cli_never_adds_a_platform_interpreter(self):
        result = subprocess.run([sys.executable, '-I', '-B', str(SCRIPT), '--host-only',
                                 '--destination', str(self.destination)], check=True, capture_output=True, text=True)
        summary = json.loads(result.stdout)
        evidence = json.loads((self.destination / 'evidence/contest-runtime.json').read_text())
        self.assertEqual(summary['platform'], 'source-only')
        self.assertEqual(evidence['platform'], 'source-only')
        self.assertNotIn('python', evidence)
        self.assertGreater(summary['hostFiles'], 100)
        self.assertFalse((self.destination / 'Python').exists())
        self.assertFalse((self.destination / 'Not1MM/python/tests').exists())


if __name__ == '__main__':
    unittest.main()
