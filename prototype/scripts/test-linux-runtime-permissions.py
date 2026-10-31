#!/usr/bin/env python3
"""Regressions for Linux package permissions and application release metadata."""
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import stat
import tempfile
import unittest


runtime = runpy.run_path(str(Path(__file__).with_name('linux-runtime.py')))
normalize = runtime['normalize_permissions']


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


class PackageMetadataTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='xlog-linux-package-metadata-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.configuration = self.root / 'prototype/src-tauri/tauri.conf.json'
        self.configuration.parent.mkdir(parents=True)

    def write_configuration(self, version, product='OM0RX-xLog'):
        self.configuration.write_text(json.dumps({'productName': product, 'version': version}))

    def test_actual_version_beta_branding_credit_and_configuration_provenance(self):
        self.write_configuration('2.4.6-beta.1+fixture7')
        application = runtime['application_metadata'](self.root)
        self.assertEqual(application['version'], '2.4.6-beta.1+fixture7')
        self.assertEqual(application['productName'], 'OM0RX-xLog')
        self.assertEqual(application['releaseChannel'], 'beta')
        self.assertEqual(application['maintainer'], 'Oliver Bross <oliver@bross.eu>')
        self.assertEqual(application['applicationConfigurationSHA256'],
                         hashlib.sha256(self.configuration.read_bytes()).hexdigest())
        self.write_configuration('2.4.7')
        self.assertNotEqual(runtime['application_metadata'](self.root)['applicationConfigurationSHA256'],
                            application['applicationConfigurationSHA256'])

    def test_invalid_configuration_cannot_supply_a_release_filename_or_control_field(self):
        for version in ['', None, 123, '01.2.3', '1.2', '1.2.3-beta..1', '../1.2.3', '1.2.3\nInjected: value']:
            with self.subTest(version=version):
                self.write_configuration(version)
                with self.assertRaises(RuntimeError):
                    runtime['application_metadata'](self.root)
        self.write_configuration('2.4.6', product='Old Prototype')
        with self.assertRaises(RuntimeError):
            runtime['application_metadata'](self.root)

    def test_debian_user_metadata_is_beta_and_technical_acceptance_paths_remain(self):
        self.write_configuration('2.4.6-beta.1')
        application = runtime['application_metadata'](self.root)
        deb = self.root / 'deb-root'
        deb.mkdir()
        runtime['write_debian_metadata'](deb, application, ['libsqlite3-0', 'libsecret-1-0'])
        control = (deb / 'DEBIAN/control').read_text()
        self.assertIn('Package: om0rx-xlog\nVersion: 2.4.6~beta.1\n', control)
        self.assertIn('Maintainer: Oliver Bross <oliver@bross.eu>\n', control)
        self.assertIn('Depends: libsqlite3-0, libsecret-1-0\n', control)
        self.assertIn('OM0RX-xLog amateur-radio logging (beta)', control)
        self.assertNotIn('synthetic', control)
        self.assertNotIn('prototype@', control)
        for name in ['om0rx-xlog', 'om0rx-xlog-prototype']:
            command = deb / 'usr/bin' / name
            self.assertEqual(command.read_text(), '#!/bin/sh\nexec /opt/om0rx-xlog-prototype/launch "$@"\n')
            self.assertEqual(stat.S_IMODE(command.stat().st_mode), 0o755)
        desktop = (deb / 'usr/share/applications/om0rx-xlog-prototype.desktop').read_text()
        self.assertIn('Name=OM0RX-xLog Beta\n', desktop)
        self.assertIn('Exec=/opt/om0rx-xlog-prototype/launch\n', desktop)


class PackageContestRuntimeTests(unittest.TestCase):
    def test_staged_host_matches_worker_relative_locator_and_tracked_inventory(self):
        repository = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix='xlog-linux-contest-package-') as temporary:
            stage = Path(temporary) / 'package'
            (stage / 'bin').mkdir(parents=True)
            metadata = runtime['stage_contest_runtime'](repository, stage)
            self.assertTrue((stage / metadata['launcher']).is_file())
            self.assertEqual(metadata['executable'], '/usr/bin/python3.12')
            evidence_path = stage / metadata['evidence']
            self.assertEqual(metadata['evidenceSHA256'], hashlib.sha256(evidence_path.read_bytes()).hexdigest())
            evidence = json.loads(evidence_path.read_text())
            self.assertEqual(evidence['platform'], 'linux')
            self.assertEqual(evidence['python']['executable'], '/usr/bin/python3.12')
            self.assertTrue(evidence['host']['files'])
            self.assertTrue(any(name.startswith('Not1MM/python/vendor/not1mm/')
                                for name in evidence['host']['files']))
            for name, expected_digest in evidence['host']['files'].items():
                path = stage / 'bin' / name
                self.assertTrue(path.is_file())
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected_digest)
            self.assertFalse(list(stage.rglob('__pycache__')))
            self.assertFalse(list(stage.rglob('*.pyc')))

    def test_fixed_interpreter_and_ca_are_mandatory_runtime_dependencies(self):
        dependencies = {line.strip() for line in Path(__file__).with_name('linux-runtime-dependencies.txt')
                        .read_text().splitlines() if line.strip() and not line.startswith('#')}
        self.assertTrue({'python3.12', 'ca-certificates', 'libsecret-1-0'}.issubset(dependencies))


if __name__ == '__main__':
    unittest.main()
