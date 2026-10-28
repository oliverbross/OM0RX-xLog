"""Boundary tests complement the real relocated-runtime staging smoke."""
import importlib.util
import plistlib
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("relocation", Path(__file__).with_name("relocate-contest-python.py"))
relocation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relocation)


class RelocationBoundaryTests(unittest.TestCase):
    def bootstrap(self, root):
        bundle = root / "bootstrap/OM0RX-xLog Contesting Worker Bootstrap.app"
        (bundle / "Contents").mkdir(parents=True)
        with (bundle / "Contents/Info.plist").open("wb") as stream:
            plistlib.dump({"CFBundleIdentifier": "com.oliverbross.xlog.contesting-test",
                          "CFBundleExecutable": "xlog-prototype-worker", "LSMinimumSystemVersion": "14.0"}, stream)
        return bundle

    def test_explicit_private_bootstrap_does_not_relax_production_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            bundle = self.bootstrap(root)
            self.assertEqual(relocation.validated_bundle_target(bundle, root), (bundle, "14.0"))
            with self.assertRaisesRegex(RuntimeError, "Unexpected candidate bundle"):
                relocation.validated_bundle_target(bundle)
            with self.assertRaisesRegex(RuntimeError, "Unexpected acceptance bootstrap"):
                relocation.validated_bundle_target(bundle, root / "bootstrap")

    def test_canonical_system_tmp_bootstrap_is_accepted(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as directory:
            root = Path(directory).resolve()
            bundle = self.bootstrap(root)
            self.assertEqual(relocation.validated_bundle_target(bundle, root), (bundle, "14.0"))

    def test_private_bootstrap_rejects_wrong_identity_links_and_existing_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            bundle = self.bootstrap(root)
            info = bundle / "Contents/Info.plist"
            original = info.read_bytes()
            with info.open("wb") as stream:
                plistlib.dump({"CFBundleIdentifier": "com.oliverbross.xlog", "LSMinimumSystemVersion": "14.0"}, stream)
            with self.assertRaisesRegex(RuntimeError, "identity is invalid"):
                relocation.validated_bundle_target(bundle, root)
            info.write_bytes(original)
            alias = root / "alias.app"; alias.symlink_to(bundle)
            with self.assertRaisesRegex(RuntimeError, "Unexpected acceptance bootstrap"):
                relocation.validated_bundle_target(alias, root)
            (bundle / "Contents/Resources/Not1MM").mkdir(parents=True)
            with self.assertRaisesRegex(RuntimeError, "destination must be new"):
                relocation.validated_bundle_target(bundle, root)

    def system_ca_bundle(self):
        source = relocation.SYSTEM_CA_BUNDLE
        if not source.is_file():
            self.skipTest(f"System CA bundle is unavailable: {source}")
        return source

    def test_external_ca_symlink_becomes_verified_internal_regular_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            framework = root / "Python.framework"
            destination = framework / relocation.CA_BUNDLE_RELATIVE
            destination.parent.mkdir(parents=True)
            outside = root / "outside-ca.pem"
            shutil.copy2(self.system_ca_bundle(), outside)
            destination.symlink_to(outside)

            receipt = relocation.internalize_ca_bundle(framework, outside)

            self.assertTrue(destination.is_file())
            self.assertFalse(destination.is_symlink())
            self.assertEqual(destination.read_bytes(), outside.read_bytes())
            self.assertEqual(receipt["bundledPath"], str(relocation.CA_BUNDLE_RELATIVE))
            self.assertEqual(receipt["sha256"], relocation.digest(destination))
            self.assertGreater(receipt["certificateCount"], 0)
            self.assertEqual(relocation.validate_ca_bundle(framework, receipt)["sha256"], receipt["sha256"])
            changed = dict(receipt, sha256="0" * 64)
            with self.assertRaisesRegex(RuntimeError, "Bundled CA provenance changed"):
                relocation.validate_ca_bundle(framework, changed)

    def test_ca_selection_falls_back_to_the_system_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            source_runtime = Path(directory) / "runtime"
            source_runtime.mkdir()
            configured = '{"cafile": null, "openssl_cafile": "/missing/compiled/cert.pem"}'
            with patch.object(relocation, "run", return_value=configured):
                selected = relocation.source_ca_bundle(source_runtime, Path("python3.12"))
            self.assertEqual(selected, self.system_ca_bundle().resolve())

    def test_broken_or_invalid_ca_source_is_fatal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            framework = root / "Python.framework"
            broken = root / "broken.pem"
            broken.symlink_to(root / "missing.pem")
            with self.assertRaises((FileNotFoundError, RuntimeError)):
                relocation.internalize_ca_bundle(framework, broken)
            invalid = root / "invalid.pem"
            invalid.write_text("not a certificate bundle")
            with self.assertRaisesRegex(RuntimeError, "CA bundle"):
                relocation.internalize_ca_bundle(framework, invalid)

    def test_fat_static_archives_are_not_runtime_machos(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "libitclstub.a"
            archive.write_bytes(bytes.fromhex("cafebabe") + b"fat archive fixture")
            object_file = root / "stub.o"
            object_file.write_bytes(bytes.fromhex("feedfacf") + b"object fixture")
            extension = root / "_sqlite3.so"
            extension.write_bytes(bytes.fromhex("feedfacf") + b"bundle fixture")

            self.assertFalse(relocation.is_macho(archive))
            self.assertFalse(relocation.is_macho(object_file))
            self.assertTrue(relocation.is_macho(extension))
            self.assertEqual(relocation.machos(root), [extension])

    def test_packaging_provenance_is_allowlisted_and_exact(self):
        self.assertEqual(
            relocation.packaging_source_names("package-contesting-test-macos.sh"),
            ("relocate-contest-python.py", "stage-contest-python-macos.sh", "package-contesting-test-macos.sh"),
        )
        with self.assertRaisesRegex(RuntimeError, "Unexpected packaging script"):
            relocation.packaging_source_names("arbitrary-local-script.sh")

    def test_deployment_target_rejects_incompatible_runtime(self):
        with patch.object(relocation, "run", return_value="cmd LC_BUILD_VERSION\n platform MACOS\n minos 26.0\n"):
            with self.assertRaisesRegex(RuntimeError, "app promises 14.0"):
                relocation.check_minimum(Path("runtime"), "14.0")
        with patch.object(relocation, "run", return_value="cmd LC_BUILD_VERSION\n platform MACOS\n minos 14.0\n"):
            self.assertEqual(relocation.check_minimum(Path("runtime"), "14.0"), ["14.0"])

    def test_validator_rejects_external_or_escaping_linkage(self):
        with tempfile.TemporaryDirectory() as directory:
            framework = Path(directory) / "Python.framework"
            image = framework / "Versions/3.12/Python"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"fake test image")
            outside = Path(directory) / "outside.dylib"
            outside.write_bytes(b"fake external library")
            with patch.object(relocation, "machos", return_value=[image]), \
                 patch.object(relocation, "check_minimum", return_value=["14.0"]), \
                 patch.object(relocation, "install_ids", return_value=[]), \
                 patch.object(relocation, "rpaths", return_value=[]):
                for dependency in ("/opt/local/lib/libsqlite3.dylib", "/usr/lib/../../opt/local/lib/libsqlite3.dylib", "@rpath/libsqlite3.dylib", "@loader_path/../../../outside.dylib"):
                    with self.subTest(dependency=dependency), patch.object(relocation, "dependencies", return_value=[dependency]):
                        with self.assertRaises(RuntimeError):
                            relocation.validate(framework, "14.0")

    def test_validator_still_rejects_unrelated_external_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            framework = root / "Python.framework"
            image = framework / "Versions/3.12/Python"
            image.parent.mkdir(parents=True)
            image.write_bytes(b"fake test image")
            outside = root / "outside.txt"
            outside.write_text("outside")
            (framework / "unrelated-link").symlink_to(outside)
            with patch.object(relocation, "machos", return_value=[image]), \
                 patch.object(relocation, "check_minimum", return_value=["14.0"]), \
                 patch.object(relocation, "install_ids", return_value=[]), \
                 patch.object(relocation, "rpaths", return_value=[]), \
                 patch.object(relocation, "dependencies", return_value=[]), \
                 patch.object(relocation, "run", return_value="arm64"):
                with self.assertRaisesRegex(RuntimeError, "External/broken framework symlink"):
                    relocation.validate(framework, "14.0")

    def test_unresolved_source_library_is_fatal(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "image"
            with patch.object(relocation, "rpaths", return_value=[]):
                with self.assertRaisesRegex(RuntimeError, "Unresolved source dependency"):
                    relocation.source_dependency("@rpath/missing.dylib", source, source)


if __name__ == "__main__":
    unittest.main()
