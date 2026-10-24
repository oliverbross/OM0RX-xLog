from datetime import datetime, UTC
import unittest

from contest_host.rates import calculate_rates


class RatesTimelineTests(unittest.TestCase):
    def test_wall_clock_rate_boundary_and_unknown_style_survive_bad_timestamp(self):
        rows = [{"ID":"a","TS":"2026-10-25 12:00:00","IsRunQSO":1},
                {"ID":"b","TS":"2026-10-25 12:01:00","IsRunQSO":None},
                {"ID":"c","TS":"broken","IsRunQSO":0}]
        result = calculate_rates(rows, datetime(2026,10,25,12,30,tzinfo=UTC))
        self.assertEqual(result["lastHourQsoPerHour"], 2)
        self.assertEqual(result["sinceHourQso"], 2)
        self.assertEqual(result["searchAndPounceQso"], 0)
        self.assertEqual(result["unknownStyleQso"], 1)
        self.assertEqual(result["invalidTimestampQso"], 1)

    def test_hourly_timeline_keeps_utc_day_and_quiet_hours(self):
        rows = [{"ID": str(index), "TS": stamp, "IsRunQSO": 0} for index, stamp in enumerate([
            "2026-10-24 23:59:00", "2026-10-25T02:00:00+02:00", "2026-10-25 02:15:00",
            "2026-10-25 04:00:00", "invalid"])]
        result = calculate_rates(rows, datetime(2026, 10, 25, 3, 0, tzinfo=UTC))
        self.assertEqual(result["hourly"], [
            {"hourUTC": "2026-10-24T23:00:00Z", "qsos": 1},
            {"hourUTC": "2026-10-25T00:00:00Z", "qsos": 1},
            {"hourUTC": "2026-10-25T01:00:00Z", "qsos": 0},
            {"hourUTC": "2026-10-25T02:00:00Z", "qsos": 1},
            {"hourUTC": "2026-10-25T03:00:00Z", "qsos": 0},
        ])
        self.assertEqual(result["lastQsoAt"], "2026-10-25T02:15:00Z")

    def test_empty_and_old_logs_are_bounded_without_losing_last_qso_time(self):
        at = datetime(2026, 10, 25, 3, 0, tzinfo=UTC)
        empty = calculate_rates([], at)
        self.assertEqual(empty["hourly"], [])
        self.assertIsNone(empty["lastQsoAt"])
        result = calculate_rates([{"ID": "old", "TS": "2020-01-01 00:00:00", "IsRunQSO": 0}], at)
        self.assertEqual(len(result["hourly"]), 168)
        self.assertEqual(sum(row["qsos"] for row in result["hourly"]), 0)
        self.assertEqual(result["lastQsoAt"], "2020-01-01T00:00:00Z")
