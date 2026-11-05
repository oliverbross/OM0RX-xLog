#!/usr/bin/env python3
"""Actual Linux fake-child lifecycle checks; never launches xLog or a GUI."""
import argparse
import importlib.util
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('linux-process-receipts.py')
spec = importlib.util.spec_from_file_location('receipts', SCRIPT)
receipts = importlib.util.module_from_spec(spec); spec.loader.exec_module(receipts)

@unittest.skipUnless(sys.platform == 'linux', 'Requires actual Linux /proc and timeout; not a macOS mock pass')
class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='xlog-process-receipts-'); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def package(self, body):
        package = self.root / 'package'; (package / 'bin').mkdir(parents=True)
        executable = package / 'bin/xlog-prototype'; executable.write_text('#!/bin/sh\n' + body + '\n'); executable.chmod(0o700)
        launch = package / 'launch'; launch.write_text('#!/bin/sh\nexec "$(dirname "$0")/bin/xlog-prototype" "$@"\n'); launch.chmod(0o700)
        return package

    def args(self, package):
        return argparse.Namespace(package=package, report=self.root/'ui.json', log=self.root/'ui.log', png=self.root/'ui.png', backend='x11')

    def term_ignoring_package(self):
        package = self.package('exit 1'); ready = self.root/'host-ready'
        (package/'bin/xlog-prototype').write_text('#!' + sys.executable + '\nimport signal,time\nfrom pathlib import Path\n'
            'signal.signal(signal.SIGTERM, signal.SIG_IGN)\nPath(' + repr(str(ready)) + ').write_text("ready")\ntime.sleep(30)\n')
        return package, ready

    def await_ready(self, child, ready):
        deadline = time.monotonic() + 3
        while not ready.exists() and time.monotonic() < deadline:
            self.assertIsNone(child.poll()); time.sleep(0.01)
        self.assertTrue(ready.exists(), 'Fake host did not install TERM ignore')

    def test_actual_nonzero_host_and_wrapper_wait_are_preserved(self):
        args = self.args(self.package('exit 7'))
        self.assertEqual(receipts.session(args), 7)
        session = json.loads(args.report.with_suffix('.session.json').read_text())
        host = json.loads(args.report.with_suffix('.process.json').read_text())
        self.assertEqual(host['actualHostWaitReturnCode'], 7)
        self.assertEqual(session['wrapperWaitReturnCode'], 7)
        self.assertEqual(session['returnedExitCode'], 7)
        self.assertNotEqual(session['status'], 'passed')

    def test_zero_without_observed_native_worker_is_incomplete_not_EOF(self):
        args = self.args(self.package('exit 0'))
        self.assertEqual(receipts.session(args), 1)
        host = json.loads(args.report.with_suffix('.process.json').read_text())
        self.assertEqual(host['actualHostWaitReturnCode'], 0)
        self.assertEqual(host['workerOutcome'], 'unobserved-unknown')
        self.assertEqual(host['workerEOF'], 'unknown-not-observed')
        self.assertIsNone(host['workerWaitReturnCode'])

    def test_original_nonzero_survives_session_receipt_failure(self):
        args = self.args(self.package('exit 9')); real_save = receipts.save; calls = 0
        def failing_save(path, value):
            nonlocal calls
            if Path(path) == args.report.with_suffix('.session.json'):
                calls += 1
                if calls >= 2: raise OSError('synthetic receipt failure')
            return real_save(path, value)
        with patch.object(receipts, 'save', failing_save): self.assertEqual(receipts.session(args), 9)
        host = json.loads(args.report.with_suffix('.process.json').read_text())
        self.assertEqual(host['actualHostWaitReturnCode'], 9)

    def test_already_exited_7_survives_report_screenshot_failure_before_wait(self):
        args = self.args(self.package('printf "{}" > "$2"\nexit 7')); real_run = subprocess.run
        def screenshot_failure(argv, **kwargs):
            if argv[0] == 'import': raise subprocess.CalledProcessError(3, argv)
            return real_run(argv, **kwargs)
        with patch.object(receipts.subprocess, 'run', screenshot_failure): self.assertEqual(receipts.session(args), 7)
        value = json.loads(args.report.with_suffix('.session.json').read_text())
        self.assertEqual(value['wrapperWaitObservedBeforeFailureCleanup'], 7)
        self.assertEqual(value['wrapperWaitReturnCode'], 7); self.assertEqual(value['returnedExitCode'], 7)
        self.assertFalse(value['forcedApplicationSignals'])

    def test_first_startup_receipt_failure_cleans_original_Popen_boundedly(self):
        created = []; real_popen = subprocess.Popen; real_save = receipts.save; calls = 0
        def spawn(*args, **kwargs):
            child = real_popen(*args, **kwargs); created.append(child); return child
        def failing_first(path, value):
            nonlocal calls
            calls += 1
            if calls == 1: raise OSError('synthetic first-write failure')
            return real_save(path, value)
        started = time.monotonic()
        with patch.object(receipts.subprocess, 'Popen', spawn):
            with self.assertRaises(OSError): receipts.Owned([sys.executable, '-c', 'import time; time.sleep(30)'], self.root/'start.json', writer=failing_first)
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual(len(created), 1); self.assertIsNotNone(created[0].poll())
        result = json.loads((self.root/'start.json').read_text())
        self.assertFalse(result['ordinaryExit']); self.assertIn('TERM', result['cleanupSignals'])

    def test_ignoring_TERM_escalates_only_original_owned_child_and_is_not_ordinary(self):
        child = receipts.Owned([sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print("ready",flush=True); time.sleep(30)'],
                               self.root/'owned.json', stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.proc.stdout.readline(), 'ready\n')
            started = time.monotonic(); self.assertTrue(child.cleanup()); self.assertLess(time.monotonic()-started, 5)
            self.assertEqual(child.value['cleanupSignals'], ['TERM', 'KILL']); self.assertFalse(child.value['ordinaryExit'])
            self.assertEqual(child.value['actualWaitReturnCode'], -signal.SIGKILL)
        finally:
            if child.proc.poll() is None: child.cleanup()
            child.proc.stdout.close()

    def test_received_signal_prevents_ordinary_even_when_host_returns_zero(self):
        package = self.package('exit 1'); ready = self.root/'zero-exit-host-ready'
        (package/'bin/xlog-prototype').write_text('#!' + sys.executable + '\nimport signal,sys,time\nfrom pathlib import Path\n'
            'signal.signal(signal.SIGTERM, lambda _signal, _frame: sys.exit(0))\nPath(' + repr(str(ready)) + ').write_text("ready")\ntime.sleep(30)\n')
        report = self.root/'ui.json'; receipt = report.with_suffix('.process.json')
        child = subprocess.Popen([sys.executable, str(SCRIPT), 'supervise', str(package), str(report), str(receipt)])
        try:
            self.await_ready(child, ready)
            self.assertIsNone(child.poll()); child.send_signal(signal.SIGTERM)
            self.assertEqual(child.wait(timeout=3), 1)
            value = json.loads(receipt.read_text()); self.assertEqual(value['actualHostWaitReturnCode'], 0)
            self.assertIn(signal.SIGTERM, value['receivedSignals']); self.assertFalse(value['hostNormalExit'])
        finally:
            if child.poll() is None: child.terminate(); child.wait(timeout=3)

    def test_reused_PID_is_not_signalled_or_published_as_unrelated_current_task(self):
        with patch.object(receipts, 'identity', return_value={'pid': 9, 'startTicks': 999, 'argv': ['private-unrelated']}):
            value = receipts.original_state({'pid': 9, 'startTicks': 100})
        self.assertEqual(value, {'state': 'original-absent-pid-reused'}); self.assertNotIn('private-unrelated', json.dumps(value))

    def test_identity_discards_exe_argv_if_PID_is_reused_during_read(self):
        first = {'pid': 9, 'ppid': 4, 'startTicks': 100, 'state': 'S'}
        second = {**first, 'startTicks': 999}
        with patch.object(receipts, 'stat_identity', side_effect=[first, second]), \
             patch.object(receipts.os, 'readlink', return_value='/private-unrelated-image'), \
             patch.object(receipts.Path, 'read_bytes', return_value=b'private-unrelated-argv\0'):
            value = receipts.identity(9)
        self.assertIsNone(value)

    def test_identity_discards_exe_argv_if_task_vanishes_during_read(self):
        first = {'pid': 9, 'ppid': 4, 'startTicks': 100, 'state': 'S'}
        with patch.object(receipts, 'stat_identity', side_effect=[first, FileNotFoundError()]), \
             patch.object(receipts.os, 'readlink', return_value='/old-image'), \
             patch.object(receipts.Path, 'read_bytes', return_value=b'old-argv\0'):
            value = receipts.identity(9)
        self.assertIsNone(value)

    def test_full_supervisor_interrupt_reaps_TERM_ignoring_original_host(self):
        package, ready = self.term_ignoring_package(); report = self.root/'ui.json'; receipt = report.with_suffix('.process.json')
        child = subprocess.Popen([sys.executable, str(SCRIPT), 'supervise', str(package), str(report), str(receipt)])
        try:
            self.await_ready(child, ready); started = time.monotonic(); child.send_signal(signal.SIGTERM)
            self.assertEqual(child.wait(timeout=5), 128 + signal.SIGKILL)
            self.assertLess(time.monotonic() - started, 5)
            value = json.loads(receipt.read_text())
            self.assertEqual(value['actualHostWaitReturnCode'], -signal.SIGKILL)
            self.assertIn(signal.SIGTERM, value['receivedSignals']); self.assertFalse(value['hostNormalExit'])
            self.assertEqual(value['hostCleanup']['cleanupSignals'], ['TERM', 'KILL'])
            self.assertTrue(receipts.absent(receipts.original_state(value['hostCleanup']['initialIdentity'])))
        finally:
            if child.poll() is None: child.kill(); child.wait(timeout=2)

    def test_full_session_timeout_reaps_TERM_ignoring_host_and_preserves_124(self):
        package, _ready = self.term_ignoring_package(); args = self.args(package); real_popen = subprocess.Popen; invoked = []
        def short_test_timeout(argv, **kwargs):
            actual = list(argv)
            if actual[0] == 'timeout':
                # Exercise real GNU timeout + full supervisors quickly. This
                # injection changes ONLY the fake-child test execution; the
                # source session must still request its unchanged100s timeout.
                self.assertEqual(actual[1], '100'); invoked.append(tuple(actual)); actual[1] = '0.5'
            return real_popen(actual, **kwargs)
        started = time.monotonic()
        with patch.object(receipts.subprocess, 'Popen', short_test_timeout): self.assertEqual(receipts.session(args), 124)
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual(len(invoked), 1)
        value = json.loads(args.report.with_suffix('.process.json').read_text())
        session = json.loads(args.report.with_suffix('.session.json').read_text())
        self.assertIn(signal.SIGTERM, value['receivedSignals']); self.assertFalse(value['hostNormalExit'])
        self.assertEqual(value['actualHostWaitReturnCode'], -signal.SIGKILL)
        self.assertEqual(value['hostCleanup']['cleanupSignals'], ['TERM', 'KILL'])
        self.assertTrue(receipts.absent(receipts.original_state(value['hostCleanup']['initialIdentity'])))
        self.assertEqual(session['wrapperWaitReturnCode'], 124); self.assertEqual(session['returnedExitCode'], 124)

if __name__ == '__main__': unittest.main()
