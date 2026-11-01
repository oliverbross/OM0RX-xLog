#!/usr/bin/env python3
"""Portable pin provenance, refusal and post-command verification regressions."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('portable_swift_lock', HERE / 'portable-swift-lock.py')
lock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lock)


class PortableSwiftPins(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='xlog-portable-pins-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        (self.root / 'prototype').mkdir()
        shutil.copyfile(HERE.parent / 'portable-swift-pins.json', self.root / 'prototype/portable-swift-pins.json')
        self.manifest = self.root / 'Package.swift'
        self.manifest.write_bytes(b'// swift-tools-version: 5.10\r\n// Raw UTF-8 fixture: \xc3\xa9\r\n')
        self.resolved = self.root / 'Package.resolved'

    def latest_receipt(self):
        files = sorted((self.root / '.build/portable-swift-lock-receipts').glob('*.json'))
        self.assertTrue(files)
        return json.loads(files[-1].read_text())

    def test_origin_uses_actual_manifest_bytes_and_complete_verified_graph(self):
        created = lock.prepare(self.root)
        expected = json.loads(self.resolved.read_text())
        self.assertTrue(created['created'])
        self.assertEqual(expected['originHash'], hashlib.sha256(self.manifest.read_bytes()).hexdigest())
        self.assertEqual(expected['version'], 3)
        self.assertEqual(expected['pins'], [{
            'identity': 'swift-crypto', 'kind': 'remoteSourceControl',
            'location': 'https://github.com/apple/swift-crypto.git',
            'state': {'version': '3.8.0', 'revision': 'ffca28be3c9c6a86a579949d23f68818a4b9b5d8'},
        }])

    def test_matching_existing_lock_is_preserved_byte_for_byte(self):
        lock.prepare(self.root)
        self.resolved.write_text(json.dumps(json.loads(self.resolved.read_text()), separators=(',', ':')))
        before = self.resolved.read_bytes()
        self.assertFalse(lock.prepare(self.root)['created'])
        self.assertEqual(self.resolved.read_bytes(), before)
        self.assertEqual(lock.verify(self.root)['lockSHA256'], hashlib.sha256(before).hexdigest())

    def test_unexpected_pin_source_revision_version_or_graph_is_not_repaired(self):
        lock.prepare(self.root)
        original = self.resolved.read_text()
        for field, value in [('location', 'https://github.com/untrusted/swift-crypto.git'),
                             ('revision', '0' * 40), ('version', '3.8.1'), ('extra', True), ('missing', True)]:
            with self.subTest(field=field):
                changed = json.loads(original)
                if field == 'location':
                    changed['pins'][0]['location'] = value
                elif field in ['revision', 'version']:
                    changed['pins'][0]['state'][field] = value
                elif field == 'extra':
                    changed['pins'].append(changed['pins'][0])
                else:
                    changed['pins'] = []
                self.resolved.write_text(json.dumps(changed))
                before = self.resolved.read_bytes()
                with self.assertRaisesRegex(RuntimeError, 'preserved'):
                    lock.prepare(self.root)
                with self.assertRaises(RuntimeError):
                    lock.verify(self.root)
                self.assertEqual(self.resolved.read_bytes(), before)

    def test_changed_manifest_requires_review_instead_of_replacing_existing_lock(self):
        lock.prepare(self.root)
        before = self.resolved.read_bytes()
        self.manifest.write_bytes(self.manifest.read_bytes() + b'// Changed source\n')
        with self.assertRaisesRegex(RuntimeError, 'actual manifest'):
            lock.prepare(self.root)
        self.assertEqual(self.resolved.read_bytes(), before)

    def test_duplicate_json_keys_and_versioned_manifests_fail_closed(self):
        lock.prepare(self.root)
        self.resolved.write_text(self.resolved.read_text().replace('"version": 3,', '"version": 2, "version": 3,'))
        with self.assertRaisesRegex(ValueError, 'Duplicate JSON key'):
            lock.verify(self.root)
        self.resolved.unlink()
        (self.root / 'Package@swift-6.3.swift').write_text('// Versioned fixture')
        with self.assertRaisesRegex(RuntimeError, 'Versioned Swift manifests'):
            lock.prepare(self.root)
        self.assertFalse(self.resolved.exists())

    def test_directory_lock_is_preserved(self):
        self.resolved.mkdir()
        with self.assertRaises(RuntimeError):
            lock.prepare(self.root)
        self.assertTrue(self.resolved.is_dir())

    def test_symlink_lock_never_changes_the_external_file(self):
        outside = self.root / 'outside.json'
        outside.write_bytes(b'outside authority fixture')
        try:
            self.resolved.symlink_to(outside)
        except OSError as error:
            self.skipTest(f'This host cannot create a test symlink: {error}')
        with self.assertRaises(RuntimeError):
            lock.prepare(self.root)
        self.assertEqual(outside.read_bytes(), b'outside authority fixture')
        self.assertTrue(self.resolved.is_symlink())

    def test_linked_lock_never_changes_the_other_name(self):
        outside = self.root / 'outside.json'
        outside.write_bytes(b'outside authority fixture')
        os.link(outside, self.resolved)
        with self.assertRaises(RuntimeError):
            lock.prepare(self.root)
        self.assertEqual(outside.read_bytes(), b'outside authority fixture')

    def test_missing_force_flag_or_other_package_root_never_starts_swift(self):
        for command in [['swift', 'test'], ['swift', 'test', '--force-resolved-versions', '--package-path', 'elsewhere']]:
            with self.subTest(command=command), patch.object(subprocess, 'run') as child:
                self.assertEqual(lock.perform(self.root, 'run', command), 1)
                child.assert_not_called()
                self.assertFalse(self.resolved.exists())

    def test_guarded_child_retains_stdout_and_verifies_before_and_after(self):
        command = ['swift', 'build', '--force-resolved-versions', '--show-bin-path']
        with patch.object(subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)) as child:
            self.assertEqual(lock.perform(self.root, 'run', command), 0)
        child.assert_called_once_with(command, cwd=self.root, check=False)
        proof = self.latest_receipt()
        self.assertEqual(proof['state'], 'complete')
        self.assertEqual(proof['prepared']['lockSHA256'], proof['verified']['lockSHA256'])

    def test_post_command_drift_fails_even_when_swift_succeeded_and_preserves_drift(self):
        def child(*_args, **_kwargs):
            changed = json.loads(self.resolved.read_text())
            changed['pins'][0]['state']['revision'] = '0' * 40
            self.resolved.write_text(json.dumps(changed))
            return types.SimpleNamespace(returncode=0)
        with patch.object(subprocess, 'run', side_effect=child):
            self.assertEqual(lock.perform(self.root, 'run', ['swift', 'test', '--force-resolved-versions']), 1)
        self.assertEqual(self.latest_receipt()['childExitCode'], 0)
        self.assertEqual(self.latest_receipt()['state'], 'failed')
        self.assertEqual(json.loads(self.resolved.read_text())['pins'][0]['state']['revision'], '0' * 40)

    def test_failed_child_still_produces_post_verification_evidence(self):
        with patch.object(subprocess, 'run', return_value=types.SimpleNamespace(returncode=42)):
            self.assertEqual(lock.perform(self.root, 'run', ['swift', 'test', '--force-resolved-versions']), 42)
        proof = self.latest_receipt()
        self.assertEqual(proof['state'], 'child_failed')
        self.assertIn('verified', proof)


if __name__ == '__main__':
    unittest.main()
