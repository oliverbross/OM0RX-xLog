import copy
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from contest_host.operating_rules import calculate


class OperatingRulesTests(unittest.TestCase):
    def setUp(self):
        self.rows = []
        self.desk = SimpleNamespace(state={"pluginID": "cq_wpx_cw", "settings": {
            "OperatorCategory": "SINGLE-OP", "TransmitterCategory": "ONE", "BandCategory": "ALL",
            "OverlayCategory": "N/A", "StartDate": "2026-05-30 00:00:00"},
            "operatingPlan": {"ruleProfileID": "wpx-2026-single-op", "note": "Rest later"}},
            database=SimpleNamespace(fetch_all_contacts_asc=lambda: self.rows))
        self.params = {"now": "2026-06-01T00:00:00Z"}

    def row(self, stamp, band=14, identity=None, mode="CW"):
        return {"ID": identity or str(len(self.rows)), "TS": stamp, "Band": band, "Mode": mode}

    def test_empty_clock_minute_boundaries_not_elapsed_sixty_minutes(self):
        for second_qso, empty, qualifies in [("01:00:00", 59, False), ("01:01:00", 60, True), ("01:02:00", 61, True)]:
            with self.subTest(second_qso=second_qso):
                self.rows = [self.row("2026-05-30 00:00:59", identity="a"), self.row("2026-05-30 " + second_qso, identity="b")]
                result = calculate(self.desk, self.params)
                self.assertEqual(result["offTime"]["gaps"][0]["emptyMinutes"], empty)
                self.assertEqual(result["offTime"]["gaps"][0]["qualifiesLogCriterion"], qualifies)
                self.assertEqual(result["offTime"]["qualifyingLogOffMinutes"], empty if qualifies else 0)
                self.assertIsNone(result["offTime"]["observedOffAirMinutes"])

    def test_allowance_below_at_above_and_no_mutation(self):
        start = datetime(2026, 5, 30, tzinfo=timezone.utc)
        for minutes, status in [(2159, "below-log-limit"), (2160, "at-log-limit"), (2161, "over-log-limit")]:
            self.rows = [self.row((start + timedelta(minutes=m)).isoformat(), identity=str(m)) for m in range(0, minutes, 30)]
            self.rows.append(self.row((start + timedelta(minutes=minutes - 1)).isoformat(), identity="last"))
            before = copy.deepcopy((self.rows, self.desk.state))
            result = calculate(self.desk, self.params)
            self.assertEqual(result["allowance"]["reconstructedMinutes"], minutes)
            self.assertEqual(result["allowance"]["status"], status)
            self.assertEqual(result["compliance"], "unverified")
            self.assertEqual((self.rows, self.desk.state), before)

    def test_correction_delete_import_recalculate_from_current_rows(self):
        self.rows = [self.row("2026-05-30 00:00:00", identity="a"), self.row("2026-05-30 01:01:00", identity="b")]
        self.assertEqual(calculate(self.desk, self.params)["offTime"]["qualifyingLogOffMinutes"], 60)
        self.rows[1]["TS"] = "2026-05-30 01:00:00"
        self.assertEqual(calculate(self.desk, self.params)["offTime"]["qualifyingLogOffMinutes"], 0)
        self.rows.pop()
        self.assertEqual(calculate(self.desk, self.params)["allowance"]["reconstructedMinutes"], 1)
        self.rows.insert(0, self.row("2026-05-30 01:02:00", identity="import"))
        self.assertEqual(calculate(self.desk, self.params)["offTime"]["qualifyingLogOffMinutes"], 61)

    def multi(self):
        self.desk.state["settings"]["OperatorCategory"] = "MULTI-OP"
        self.desk.state["operatingPlan"]["ruleProfileID"] = "wpx-2026-multi-one"

    def test_band_counters_utc_midnight_mode_and_correction(self):
        self.multi()
        self.rows = [self.row("2026-05-30 23:59:59", 14, "a"),
                     self.row("2026-05-31 00:00:00", 7, "b"),
                     self.row("2026-05-31 00:01:00", 7, "c", "SSB"),
                     self.row("2026-05-31 00:02:00", 14, "d")]
        result = calculate(self.desk, self.params)["bandChanges"]
        self.assertEqual(result["hours"], [{"hourUTC": "2026-05-31T00:00:00Z", "changes": 2, "limit": 10, "status": "below-log-limit"}])
        self.rows[1]["Band"] = self.rows[2]["Band"] = 14
        self.assertEqual(calculate(self.desk, self.params)["bandChanges"]["changes"], [])

    def test_band_limit_below_at_above(self):
        self.multi()
        for changes, status in [(9, "below-log-limit"), (10, "at-log-limit"), (11, "over-log-limit")]:
            self.rows = [self.row(f"2026-05-30 00:{m:02d}:00", 7 if m % 2 else 14, str(m)) for m in range(changes + 1)]
            self.assertEqual(calculate(self.desk, self.params)["bandChanges"]["hours"][0]["status"], status)

    def test_unknown_observation_is_unavailable_never_zero_or_violation(self):
        self.multi()
        self.rows = [self.row("2026-05-30 00:00:00", 14, "a"), self.row("2026-05-30 00:00:00", 7, "b"),
                     self.row("2026-05-30 00:02:00", "", "c")]
        result = calculate(self.desk, {**self.params, "observedIntervals": [{"seconds": 1000}]})
        self.assertEqual(result["bandChanges"]["unknownOrderOrBandQSOs"], 3)
        self.assertFalse(result["bandChanges"]["complete"])
        self.assertEqual(result["bandChanges"]["hours"], [])
        for key in ("observedOperatingSeconds", "observedStyleSeconds", "observedOperatorSeconds", "observedLaneSeconds"):
            self.assertIsNone(result[key])
        self.assertEqual(result["receiverEvidence"], "unknown")

    def test_edition_category_and_overlay_must_match_and_singleband_retained(self):
        self.desk.state["settings"]["BandCategory"] = "20M"
        self.assertEqual(calculate(self.desk, self.params)["profile"]["categoryBand"], "20M")
        for change in ({"StartDate": "2025-05-30 00:00:00"}, {"OverlayCategory": "CLASSIC"}, {"OperatorCategory": "MULTI-OP"}):
            original = copy.deepcopy(self.desk.state["settings"])
            self.desk.state["settings"].update(change)
            result = calculate(self.desk, self.params)
            self.assertIsNone(result["profile"])
            self.assertIsNone(result["allowance"])
            self.assertTrue(result["unverifiedReason"])
            self.desk.state["settings"] = original
        self.desk.state["operatingPlan"] = {}
        self.assertIsNone(calculate(self.desk, self.params)["profile"])

    def test_retrospective_equivalence_utc_offsets_invalid_and_future(self):
        self.rows = [self.row("2026-05-30T09:30:00+09:30", identity="valid"),
                     self.row("bad", identity="bad"), self.row("2026-06-01T00:00:00Z", identity="outside")]
        now = {"now": "2026-05-30T02:00:00Z"}
        result = calculate(self.desk, now)
        self.assertEqual(result, calculate(self.desk, {"now": "2026-05-30T11:30:00+09:30"}))
        self.assertEqual(result["lastQsoUTC"], "2026-05-30T00:00:00Z")
        self.assertEqual(result["invalidTimestampQSOs"], 1)
        self.assertEqual(result["excludedPeriodOrFutureQSOs"], 1)
        self.assertEqual(result["inferredInactivitySeconds"], 7200)
        with self.assertRaises(ValueError):
            calculate(self.desk, {"now": "bad"})


if __name__ == "__main__":
    unittest.main()
