#!/usr/bin/env python3
"""Regression for owner-only build-cache notices in root-installed packages."""
from pathlib import Path
import runpy
import shutil
import stat
import tempfile
import unittest


normalize = runpy.run_path(str(Path(__file__).with_name('linux-runtime.py')))['normalize_permissions']


class PackagePermissionTests(unittest.TestCase):
    def test_private_notices_and_helpers_remain_usable_after_install_clone(self):
        with tempfile.TemporaryDirectory(prefix='xlog-package-permissions-') as temporary:
            stage = Path(temporary) / 'package'
            notices = stage / 'notices/cargo-fnv'
            notices.mkdir(parents=True)
            for directory in [stage, notices.parent, notices]:
                directory.chmod(0o700)
            license_file = notices / 'LICENSE-APACHE'
            license_file.write_bytes(b'permission regression fixture')
            license_file.chmod(0o600)
            executable = stage / 'worker'
            executable.write_bytes(b'helper permission fixture')
            executable.chmod(0o700)
            before = license_file.read_bytes(), executable.read_bytes()

            normalize(stage)
            normalize(stage)  # Repeated normalization must retain contents/modes.
            installed = Path(temporary) / 'installed'
            shutil.copytree(stage, installed)
            for payload in [stage, installed]:
                for directory in [payload, payload / 'notices', payload / 'notices/cargo-fnv']:
                    self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o755)
                self.assertEqual(stat.S_IMODE((payload / 'notices/cargo-fnv/LICENSE-APACHE').stat().st_mode), 0o644)
                self.assertEqual(stat.S_IMODE((payload / 'worker').stat().st_mode), 0o755)
                self.assertEqual(before, ((payload / 'notices/cargo-fnv/LICENSE-APACHE').read_bytes(),
                                          (payload / 'worker').read_bytes()))

    def test_normalization_does_not_follow_outside_symlinks(self):
        with tempfile.TemporaryDirectory(prefix='xlog-package-permissions-') as temporary:
            stage = Path(temporary) / 'package'
            stage.mkdir()
            outside = Path(temporary) / 'outside'
            outside.write_bytes(b'outside fixture')
            outside.chmod(0o600)
            (stage / 'linked-notice').symlink_to(outside)
            with self.assertRaisesRegex(RuntimeError, 'Unexpected package symlink'):
                normalize(stage)
            self.assertEqual(stat.S_IMODE(outside.stat().st_mode), 0o600)


if __name__ == '__main__':
    unittest.main()
