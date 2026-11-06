#!/usr/bin/env python3
"""Synthetic-file regressions; no xLog, worker, GUI, Docker or network launch."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('linux-evidence.py'))
evidence = importlib.util.module_from_spec(spec); spec.loader.exec_module(evidence)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='xlog-evidence-fixture-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def report(self, name='ui-1', **changes):
        value = {'schema': 1, 'status': 'passed', 'scope': 'integrated-local-ui',
                 'embeddedUi': True, 'worker': True, 'platform': 'linux',
                 'checks': {str(i): True for i in range(14)}}
        value.update(changes)
        path = self.root / (name + '.json'); path.write_text(json.dumps(value))
        return path

    def validate(self, report, backend):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            evidence.validate(report, backend)
        return json.loads(output.getvalue())

    def test_x11_scope_failure_is_retained_and_labelled_before_assertion(self):
        path = self.report(scope='private unexpected value', error='private error detail')
        before = path.read_bytes(); output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaisesRegex(AssertionError, 'ui-1:scope'):
            evidence.validate(path, 'x11')
        diagnostic = json.loads(output.getvalue())
        self.assertEqual(diagnostic['scope'], 'missing-or-unrecognized')
        self.assertEqual(diagnostic['reportSHA256'], hashlib.sha256(before).hexdigest())
        self.assertRegex(diagnostic['errorSHA256'], r'^[0-9a-f]{64}$')
        self.assertNotIn('private', output.getvalue())
        saved = path.with_suffix('.validation.json')
        self.assertEqual(json.loads(saved.read_text()), diagnostic)
        self.assertEqual(stat.S_IMODE(saved.stat().st_mode), 0o600)
        self.assertEqual(path.read_bytes(), before)

    def test_wayland_status_failure_has_distinct_journey_label(self):
        path = self.report('ui-wayland', status='failed')
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(AssertionError, 'ui-wayland:schema-status'):
            evidence.validate(path, 'wayland')
        self.assertEqual(json.loads(path.with_suffix('.validation.json').read_text())['status'], 'failed')

    def test_original_x11_has_no_new_check_count_guard(self):
        path = self.report(checks={})
        self.assertEqual(self.validate(path, 'x11')['checkCount'], 0)

    def test_original_wayland_has_no_new_scope_guard(self):
        path = self.report('ui-wayland', scope='other')
        self.assertEqual(self.validate(path, 'wayland')['trueCheckCount'], 14)

    def test_original_schema_equality_keeps_bool_int_semantics(self):
        self.validate(self.report(schema=True), 'x11')

    def test_embedded_and_worker_remain_strict_booleans(self):
        for field in ('embeddedUi', 'worker'):
            with self.subTest(field=field):
                path = self.report(**{field: 1})
                with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(AssertionError, 'embeddedUi-worker'):
                    evidence.validate(path, 'x11')
                path.with_suffix('.validation.json').unlink()

    def test_wayland_check_count_and_strict_true_are_preserved(self):
        for checks in ({str(i): True for i in range(13)}, {str(i): 1 for i in range(14)}):
            path = self.report('ui-wayland', checks=checks)
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(AssertionError, 'ui-wayland:checks'):
                evidence.validate(path, 'wayland')
            path.with_suffix('.validation.json').unlink()

    @unittest.skipIf(os.getuid() == 0, 'Non-root ownership preservation fixture')
    def test_recovery_preserves_private_bytes_mode_and_ignores_unlisted_files(self):
        path = self.root / 'ui-1.process.host.json'; path.write_bytes(b'synthetic private report'); path.chmod(0o600)
        unlisted = self.root / 'unlisted.json'; unlisted.write_bytes(b'untouched'); unlisted.chmod(0o400)
        before = path.read_bytes(), stat.S_IMODE(path.stat().st_mode)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(evidence.recover(self.root, os.getuid(), os.getgid()), 0)
        self.assertEqual((path.read_bytes(), stat.S_IMODE(path.stat().st_mode)), before)
        self.assertEqual(stat.S_IMODE(unlisted.stat().st_mode), 0o400)
        summary = json.loads((self.root / 'ownership-recovery.json').read_text())
        self.assertEqual(summary['recovered'], [path.name])

    @unittest.skipIf(os.getuid() == 0, 'Non-root ownership preservation fixture')
    def test_recovery_rejects_links_and_directory_but_recovers_other_known_report(self):
        outside = self.root.parent / (self.root.name + '-outside'); outside.write_bytes(b'outside')
        self.addCleanup(outside.unlink); outside.chmod(0o600)
        (self.root / 'ui-1.process.host.json').symlink_to(outside)
        os.link(outside, self.root / 'ui-2.process.host.json')
        (self.root / 'ui-3.process.host.json').mkdir()
        good = self.root / 'ui-wayland.process.host.json'; good.write_bytes(b'good'); good.chmod(0o600)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(evidence.recover(self.root, os.getuid(), os.getgid()), 1)
        summary = json.loads((self.root / 'ownership-recovery.json').read_text())
        self.assertEqual(len(summary['errors']), 3)
        self.assertEqual(summary['recovered'], [good.name])
        self.assertEqual(outside.read_bytes(), b'outside')
        self.assertEqual(stat.S_IMODE(outside.stat().st_mode), 0o600)


if __name__ == '__main__':
    unittest.main()
