#!/usr/bin/env python3
"""Portable regressions for the private Linux vault runner, without a live vault."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock


spec = importlib.util.spec_from_file_location('linux_vault', Path(__file__).with_name('test-linux-vault.py'))
vault = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vault)


class PrivateVaultHarnessTests(unittest.TestCase):
    def test_child_environment_cannot_reach_the_invoking_home_bus_or_debug_overrides(self):
        inherited = {'HOME': '/invoking-home', 'PATH': '/fixture/toolchain',
                     'GNOME_KEYRING_CONTROL': '/invoking-control', 'GNOME_KEYRING_TEST_PATH': '/invoking-keyrings',
                     'DBUS_SESSION_BUS_ADDRESS': 'invoking-bus', 'DBUS_SYSTEM_BUS_ADDRESS': 'invoking-system-bus',
                     'DBUS_STARTER_ADDRESS': 'invoking-starter', 'DBUS_STARTER_BUS_TYPE': 'session',
                     'DISPLAY': ':99', 'WAYLAND_DISPLAY': 'invoking-display', 'XDG_SESSION_ID': 'invoking-session',
                     'G_MESSAGES_DEBUG': 'all', 'G_DEBUG': 'fatal-warnings', 'LD_PRELOAD': '/invoking-library'}
        before = inherited.copy()
        with tempfile.TemporaryDirectory(prefix='xlog-vault-harness-') as temporary:
            root = Path(temporary)
            env = vault.private_environment(root, inherited)
            self.assertEqual(inherited, before)
            self.assertEqual(env['PATH'], '/fixture/toolchain')
            self.assertEqual(env['HOME'], str(root / 'home'))
            self.assertEqual(env['XLOG_TEST_LINUX_VAULT_ROOT'], str(root))
            self.assertEqual(env['DBUS_SYSTEM_BUS_ADDRESS'], 'unix:path=' + str(root / 'absent-system-bus'))
            for key, folder in [('HOME', 'home'), ('XDG_DATA_HOME', 'data'), ('XDG_CONFIG_HOME', 'config'),
                                ('XDG_CACHE_HOME', 'cache'), ('XDG_RUNTIME_DIR', 'runtime')]:
                self.assertEqual(env[key], str(root / folder))
                self.assertTrue((root / folder).is_dir())
            for key in set(inherited) - {'HOME', 'PATH', 'DBUS_SYSTEM_BUS_ADDRESS'}:
                self.assertNotIn(key, env)

    def start(self, *, owned, probe_code=0, probe_error=b'', daemon_error=b''):
        temporary = tempfile.TemporaryDirectory(prefix='xlog-vault-harness-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        env = vault.private_environment(root, {})
        process = mock.Mock()
        process.poll.return_value = None

        def create_process(command, **options):
            self.assertFalse(any(vault.PASSWORD.decode() in str(argument) for argument in command))
            self.assertEqual(options['stdout'], subprocess.DEVNULL)
            options['stderr'].write(daemon_error)
            options['stderr'].flush()
            return process

        def execute(command, **options):
            self.assertEqual(options['env'], env)
            if command[0] == 'dbus-send':
                return subprocess.CompletedProcess(command, 0, b'boolean true' if owned else b'boolean false', b'')
            self.assertEqual(command, [str(root / 'vault-smoke'), 'probe'])
            return subprocess.CompletedProcess(command, probe_code, b'', probe_error)

        patches = [mock.patch.object(vault.subprocess, 'Popen', side_effect=create_process),
                   mock.patch.object(vault.subprocess, 'run', side_effect=execute),
                   mock.patch.object(vault.time, 'monotonic', side_effect=[0, 0, 11]),
                   mock.patch.object(vault.time, 'sleep')]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        return root, env, process

    def test_ready_requires_both_the_private_bus_name_and_successful_collection_probe(self):
        root, env, process = self.start(owned=True)
        self.assertIs(vault.start_daemon(root, env, 1), process)
        process.stdin.write.assert_called_once_with(vault.PASSWORD)
        process.stdin.close.assert_called_once()
        process.terminate.assert_not_called()

    def test_probe_failure_does_not_masquerade_as_a_missing_bus_and_stops_its_owned_child(self):
        root, env, process = self.start(owned=True, probe_code=1,
            probe_error=b'collection=0 error=0', daemon_error=b'private startup diagnostic')
        with self.assertRaises(RuntimeError) as failure:
            vault.start_daemon(root, env, 1)
        message = str(failure.exception)
        self.assertIn('bus_owned=True probe_exit=1', message)
        self.assertIn('collection=0 error=0', message)
        self.assertIn('private startup diagnostic', message)
        process.terminate.assert_called_once()
        process.wait.assert_called_once_with(timeout=5)

    def test_absent_bus_reports_that_probe_never_ran(self):
        root, env, process = self.start(owned=False)
        with self.assertRaisesRegex(RuntimeError, 'bus_owned=False probe_exit=not-run'):
            vault.start_daemon(root, env, 1)
        process.terminate.assert_called_once()

    def test_private_diagnostics_are_bounded_and_fixture_password_is_redacted(self):
        diagnostic = vault.bounded_diagnostic(b'x' * 10000 + vault.PASSWORD)
        self.assertLessEqual(len(diagnostic.encode()), vault.DIAGNOSTIC_BYTES)
        self.assertNotIn(vault.PASSWORD.decode(), diagnostic)
        self.assertIn('[fixture-password-redacted]', diagnostic)


if __name__ == '__main__':
    unittest.main()
