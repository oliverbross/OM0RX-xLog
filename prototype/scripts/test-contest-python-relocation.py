"""Boundary tests complement the real relocated-runtime staging smoke."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("relocation", Path(__file__).with_name("relocate-contest-python.py"))
relocation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relocation)


class RelocationBoundaryTests(unittest.TestCase):
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

    def test_unresolved_source_library_is_fatal(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "image"
            with patch.object(relocation, "rpaths", return_value=[]):
                with self.assertRaisesRegex(RuntimeError, "Unresolved source dependency"):
                    relocation.source_dependency("@rpath/missing.dylib", source, source)


if __name__ == "__main__":
    unittest.main()
