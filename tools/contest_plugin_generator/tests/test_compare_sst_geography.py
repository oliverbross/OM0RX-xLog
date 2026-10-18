import hashlib
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "compare_sst_geography.py"
SPEC = importlib.util.spec_from_file_location("compare_sst_geography", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class CompareSSTGeographyTests(unittest.TestCase):
    def test_exact_pinned_sources_make_the_dx_exclusion_visible(self):
        configured = os.environ.get("CONTEST_SW_ROOT")
        self.assertIsNotNone(
            configured,
            "CONTEST_SW_ROOT must point to the pinned read-only contest-sw checkout",
        )
        source = Path(configured)
        result = MODULE.compare(source)
        self.assertEqual(result["upstreamRevision"], MODULE.PIN)
        self.assertEqual(result["database"]["excludedSectionToken"], "DX")
        self.assertIn("Sect != 'DX'", result["database"]["query"])
        self.assertEqual(result["comparatorInput"], {
            "officialSampleRows": 12, "queryGuardRows": 2, "points": 12,
        })
        self.assertEqual(result["queryControls"], {
            "exactReviewedQuery": 7,
            "withoutDXFilter": 10,
            "withoutContestFilter": 8,
        })
        self.assertEqual(result["sourceOutcomes"], {
            "acceptedPoints": 1,
            "duplicatePoints": 0,
            "officialSampleSectionBandCount": 7,
            "officialSampleScore": 84,
        })

    def test_hash_mismatch_fails_before_compilation(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "plugin.py"
            path.write_text("raise RuntimeError('must not execute')\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "source hash mismatch"):
                MODULE.load_plugin_functions(path, "0" * 64)

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
            digest = hashlib.sha256(source.encode()).hexdigest()
            with self.assertRaisesRegex(ValueError, "unreviewed call 'open'"):
                MODULE.load_plugin_functions(path, digest)
            self.assertFalse(forbidden.exists())

    def test_sqlite_guard_rows_detect_weakened_filters(self):
        official, guards = MODULE.load_fixture_rows(MODULE.FIXTURE)
        connection, database = MODULE.sample_database(
            MODULE.EXPECTED_NODX_QUERY, official, guards
        )
        try:
            self.assertEqual(database.fetch_section_band_count_nodx(), {"sb_count": 7})
            without_dx = MODULE.EXPECTED_NODX_QUERY.replace(" and Sect != 'DX'", "")
            self.assertEqual(connection.execute(without_dx, (1,)).fetchone()[0], 10)
            without_contest = MODULE.EXPECTED_NODX_QUERY.replace(
                "where ContestNR = ? and Sect != 'DX'", "where Sect != 'DX'"
            )
            self.assertEqual(connection.execute(without_contest).fetchone()[0], 8)
        finally:
            connection.close()

    def test_database_query_shape_is_exact(self):
        with tempfile.TemporaryDirectory() as folder:
            source = """
class Database:
    def fetch_section_band_count_nodx(self):
        return self.exec_sql("select count(*) from changed")
"""
            path = Path(folder) / "database.py"
            path.write_text(source, encoding="utf-8")
            digest = hashlib.sha256(source.encode()).hexdigest()
            with self.assertRaisesRegex(ValueError, "reviewed no-DX query changed"):
                MODULE.inspect_nodx_query(path, digest)


if __name__ == "__main__":
    unittest.main()
