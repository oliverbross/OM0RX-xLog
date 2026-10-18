import ast
import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "compare_cw_unique_call.py"
SPEC = importlib.util.spec_from_file_location("compare_cw_unique_call", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CompareCWUniqueCallTests(unittest.TestCase):
    def test_exact_pinned_sources_match_shared_policy_goldens(self):
        source = Path("/Users/oliver/Documents/Projects/contest-sw")
        result = MODULE.compare(source)
        self.assertEqual(result["upstreamRevision"], MODULE.PIN)
        self.assertEqual(len(result["results"]), 3)
        for plugin in result["results"]:
            self.assertEqual(plugin["cases"], {
                "acceptedPoints": 1, "duplicatePoints": 0,
                "uniqueCallMultipliers": 2, "score": 6,
            })

    def test_hash_mismatch_fails_before_compilation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "plugin.py"
            path.write_text("raise RuntimeError('must not execute')\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "source hash mismatch"):
                MODULE.load_functions(path, "0" * 64)

    def test_allowlist_rejects_side_effect_call(self):
        with tempfile.TemporaryDirectory() as folder:
            forbidden = Path(folder) / "forbidden"
            source = f"""
def points(self):
    open({str(forbidden)!r}, 'w')
def show_mults(self):
    return 0
def calc_score(self):
    return 0
"""
            path = Path(folder) / "plugin.py"
            path.write_text(source, encoding="utf-8")
            digest = __import__("hashlib").sha256(source.encode()).hexdigest()
            with self.assertRaisesRegex(ValueError, "unreviewed call 'open'"):
                MODULE.load_functions(path, digest)
            self.assertFalse(forbidden.exists())


if __name__ == "__main__":
    unittest.main()
