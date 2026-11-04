import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[2] / "tools/normalize-cqrlog-country.py"


class CountryPackNormalizerTests(unittest.TestCase):
    def source(self, root):
        checkout = root / "source"
        checkout.mkdir()
        subprocess.run(["git", "init", "--quiet", str(checkout)], check=True)
        directory = checkout / "data/dxcc"
        directory.mkdir(parents=True)
        for name in ("Country.tab", "CallResolution.tbl", "AreaOK1RR.tbl", "CountryDel.tab", "Exceptions.tab", "Ambiguous.tbl"):
            (directory / name).write_text("OM|SLOVAKIA|EU||48N|19E|28|15|504||\n" if name == "Country.tab" else "")
        subprocess.run(["git", "-C", str(checkout), "add", "data"], check=True)
        subprocess.run(["git", "-C", str(checkout), "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false",
                        "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture"], check=True)
        revision = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
        return checkout, revision

    def test_pinned_objects_are_independent_of_dirty_source_files(self):
        spec = importlib.util.spec_from_file_location("country_normalizer_fixture", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            checkout, revision = self.source(root)
            first, second = root / "first.json", root / "second.json"
            with mock.patch.object(module, "REVISION", revision), contextlib.redirect_stdout(io.StringIO()):
                with mock.patch.object(sys, "argv", [str(SCRIPT), str(checkout), str(first)]):
                    module.main()
                (checkout / "data/dxcc/Country.tab").write_text("DL|UNCOMMITTED CHANGE|EU||48N|19E|28|14|230||\n")
                with mock.patch.object(sys, "argv", [str(SCRIPT), str(checkout), str(second)]):
                    module.main()
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertTrue(first.read_bytes().endswith(b"\n"))
            self.assertFalse(first.read_bytes().endswith(b"\r\n"))

    def test_optimized_python_still_rejects_a_different_revision(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            checkout, _ = self.source(root)
            output = root / "pack.json"
            result = subprocess.run([sys.executable, "-O", str(SCRIPT), str(checkout), str(output)],
                                    capture_output=True, text=True, env=os.environ.copy())
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
