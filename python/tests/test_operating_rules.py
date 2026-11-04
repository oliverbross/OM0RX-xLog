import copy
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from contest_host.operating_rules import calculate, validate_plan


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

    def profile(self, plugin, profile, start, single=False):
        self.desk.state["pluginID"] = plugin
        self.desk.state["settings"].update(StartDate=start+" 00:00:00", PowerCategory="HIGH",
                                          OperatorCategory="SINGLE-OP" if single else "MULTI-OP")
        self.desk.state["operatingPlan"] = {"ruleProfileID": profile, "note": ""}
        self.params = {"now": start+"T23:59:59Z"}

    def declare(self, roles):
        candidates = calculate(self.desk, self.params)["roleCandidates"]
        self.desk.state["operatingPlan"].update(schema=2, signalRoles=[
            {"kind": "qso", "id": row["id"], "sourceDigest": row["sourceDigest"], "role": roles[row["id"]],
             "declaredUTC": "2026-11-04T00:00:00Z"} for row in candidates if row["id"] in roles])

    def test_cqww_independent_functional_clocks_use_logged_minute_precision(self):
        self.profile("cq_ww_cw", "cqww-2026-multi-one", "2026-11-28")
        for seconds in ("01", "58"):
            self.rows = [{**self.row(f"2026-11-28 14:00:{seconds}", 14, "run"), "CountryPrefix": "K", "ZN": "5"},
                         {**self.row("2026-11-28 14:03:42", 7, "multi"), "CountryPrefix": "JA", "ZN": "25"},
                         {**self.row("2026-11-28 14:10:00", 21, "next"), "CountryPrefix": "K", "ZN": "5"}]
            self.declare({"run": "run", "multi": "multiplier", "next": "run"})
            result=calculate(self.desk, {"now": "2026-11-28T14:10:00Z"})["bandDwell"]
            run, multiplier=result["clocks"]
            self.assertEqual(run["eligibleUTC"], "2026-11-28T14:20:00Z")
            self.assertEqual(multiplier["eligibleUTC"], "2026-11-28T14:13:00Z")
            self.assertEqual(multiplier["remainingSeconds"], 180)
            self.assertTrue(result["complete"])
            self.assertFalse(any(item["status"]=="early-band-change" for item in result["events"]))

    def test_cqww_retains_early_and_nonmultiplier_activity_and_never_uses_radio_role(self):
        self.profile("cq_ww_cw", "cqww-2026-multi-one", "2026-11-28")
        self.rows = [{**self.row("2026-11-28 14:00:58", 14, "a"), "CountryPrefix": "K", "ZN": "5"},
                     {**self.row("2026-11-28 14:09:59", 7, "b"), "CountryPrefix": "JA", "ZN": "25"},
                     {**self.row("2026-11-28 14:11:00", 14, "not-new"), "CountryPrefix": "K", "ZN": "5"},
                     {**self.row("2026-11-28 14:12:00", 21, "unattributed"), "Run1Run2": "1", "IsRunQSO": 1}]
        self.declare({"a":"run", "b":"run", "not-new":"multiplier"})
        before=copy.deepcopy((self.rows,self.desk.state))
        result=calculate(self.desk,self.params)["bandDwell"]
        self.assertEqual([row["status"] for row in result["events"]], ["clock-start","early-band-change","not-a-new-multiplier"])
        self.assertEqual(result["unknownRoleOrBandIDs"], ["unattributed"])
        self.assertFalse(result["complete"])
        self.assertEqual(before,(self.rows,self.desk.state))
        self.rows.reverse()
        self.assertEqual(calculate(self.desk,self.params)["bandDwell"],result)
        next(row for row in self.rows if row["ID"]=="a")["TS"]="2026-11-28 13:59:58"
        self.assertIn("a",calculate(self.desk,self.params)["bandDwell"]["unknownRoleOrBandIDs"])

    def test_wae_qtc_only_activity_breaks_qualifying_off_period(self):
        self.profile("wae_cw", "wae-2026-single-op", "2026-08-08", single=True)
        self.rows=[self.row("2026-08-08 00:00:00",identity="a"),self.row("2026-08-08 01:01:00",identity="b")]
        self.assertEqual(calculate(self.desk,self.params)["offTime"]["qualifyingLogOffMinutes"],60)
        self.desk.state["qtc"]={"schema":1,"batches":[{"id":"partial","timestamp":"2026-08-08 00:30:00","frequencyHz":14025000,
            "status":"cancelled","items":[{"time":"2359","status":"pending"}]}]}
        result=calculate(self.desk,self.params)
        self.assertEqual(result["qtcActivityCount"],1)
        self.assertEqual(result["offTime"]["qualifyingLogOffMinutes"],0)
        self.assertEqual(result["allowance"]["reconstructedMinutes"],62)
        self.assertIn("QSO-and-declared-QTC",result["allowance"]["basis"])

    def test_wae_main_clock_includes_qtc_band_activity_and_missing_cq_stays_unknown(self):
        self.profile("wae_ssb", "wae-2026-multi-one", "2026-09-12")
        self.rows=[self.row("2026-09-12 00:00:00",14,"main")]
        self.declare({"main":"main"})
        self.desk.state["qtc"]={"batches":[{"id":"qtc-only","timestamp":"2026-09-12 00:09:59","frequencyHz":7100000}]}
        result=calculate(self.desk,self.params)["bandDwell"]
        self.assertEqual(result["events"][-1]["status"],"early-band-change")
        self.assertEqual(result["clocks"][0]["eligibleUTC"],"2026-09-12T00:19:59Z")
        self.assertEqual(result["unobservedCQActivity"],"unknown")

    def test_wae_attempt_and_operator_activity_minutes_are_not_empty_even_before_ack(self):
        self.profile("wae_cw", "wae-2026-single-op", "2026-08-08", single=True)
        self.rows=[self.row("2026-08-08 00:00:00",identity="a"),self.row("2026-08-08 01:01:00",identity="b")]
        self.desk.state["qtc"]={"batches":[{"id":"batch","timestamp":"2026-08-08 00:00:00","frequencyHz":14025000}]}
        self.desk.state["qtcOperating"]={"schema":1,"attempts":[{"operationID":"send-attempt","batchID":"batch","requestedUTC":"2026-08-08T00:30:00Z","state":"prepared"}],
                                        "activities":[{"operationID":"receive-ack","batchID":"batch","atUTC":"2026-08-08T00:45:00Z"}]}
        result=calculate(self.desk,self.params)
        self.assertEqual(result["qtcActivityCount"],3)
        self.assertEqual(result["offTime"]["qualifyingLogOffMinutes"],0)
        self.assertTrue(result["offTime"]["completeLogTimestamps"])
        self.desk.state["qtcOperating"]["activityCoverageComplete"]=False
        result=calculate(self.desk,self.params)
        self.assertFalse(result["offTime"]["completeLogTimestamps"])
        self.assertEqual(result["invalidQTCActivity"],1)
        self.desk.state["qtcOperating"].pop("activityCoverageComplete")
        self.desk.state["qtcOperating"]["schema"]=99
        result=calculate(self.desk,self.params)
        self.assertEqual(result["invalidQTCActivity"],1)
        self.assertFalse(result["offTime"]["completeLogTimestamps"])

    def test_profiles_reject_other_editions_categories_modes_and_validate_old_plans(self):
        old={"ruleProfileID":"wpx-2026-single-op","note":"old bank untouched"}
        self.assertEqual(validate_plan(old),old)
        with self.assertRaises(ValueError):validate_plan({**old,"ruleProfileID":"wpx-2027-single-op"})
        with self.assertRaises(ValueError):validate_plan({**old,"schema":2,"signalRoles":[{"id":"a"}]})
        self.profile("wae_rtty","wae-2026-single-op","2026-11-14",single=True)
        self.assertIsNone(calculate(self.desk,self.params)["profile"])
        self.profile("cq_ww_cw","cqww-2026-multi-one","2027-11-27")
        self.assertIsNone(calculate(self.desk,self.params)["profile"])
        self.assertEqual(calculate(self.desk,self.params)["publicationCandidates"][0]["status"],"no-verified-profile")


if __name__ == "__main__":
    unittest.main()
