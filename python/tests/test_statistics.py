from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import uuid

from contest_host.host import Host, HostError
from contest_host.statistics import calculate_statistics


CTY = {
    "OM0RX": {"entity": "Slovak Republic", "continent": "EU", "cq": 15,
              "itu": 28, "primary_pfx": "OM"},
}


def uid():
    return str(uuid.uuid4())


class StatisticsTests(unittest.TestCase):
    def test_mode_aliases_distinct_calls_wpx_points_and_band_order(self):
        rows = []
        modes = ["CW", "CW-U", "CW-L", "CW-R", "CWR", "LSB", "USB", "SSB", "FM", "AM",
                 "FT8", "FT4", "RTTY", "PSK31", "FSK441", "MSK144", "JT65", "JT9", "Q65",
                 "PKTUSB", "PKTLSB", "SOMETHING-NEW"]
        for index, mode in enumerate(modes):
            rows.append({"Band": 14, "Call": "K1ABC" if index % 2 else "DL1ABC", "Mode": mode,
                         "WPXPrefix": "K1" if index % 3 else "", "Points": index - 2})
        rows += [
            {"Band": 1.8, "Call": "K1ABC", "Mode": "cw", "WPXPrefix": "K1", "Points": 3},
            {"Band": 0, "Call": "N0BAND", "Mode": "unknown", "WPXPrefix": "N0", "Points": 4},
            {"Band": 7, "Call": "K1ABC", "Mode": " ssb ", "WPXPrefix": "K1", "Points": 5},
        ]
        statistics = calculate_statistics(rows)
        self.assertEqual([row["band"] for row in statistics["rows"]], ["14.0", "7.0", "1.8", "0.0"])
        by_band = {row["band"]: row for row in statistics["rows"]}
        self.assertEqual({key: by_band["14.0"][key] for key in ("qsos", "calls", "cw", "phone", "digital", "wpx")},
                         {"qsos": 22, "calls": 2, "cw": 5, "phone": 5, "digital": 9, "wpx": 2})
        self.assertEqual(by_band["0.0"], {"band": "0.0", "qsos": 1, "calls": 1, "cw": 0,
                                          "phone": 0, "digital": 0, "wpx": 1, "points": 4})
        self.assertEqual(statistics["total"]["calls"], 3)
        self.assertEqual(statistics["total"]["wpx"], 5)
        self.assertEqual(statistics["total"]["qsos"], len(rows))
        self.assertEqual(statistics["total"]["cw"], 5)
        self.assertEqual(statistics["total"]["phone"], 5)
        self.assertEqual(statistics["total"]["digital"], 9)

    def test_empty(self):
        self.assertEqual(calculate_statistics([]), {"rows": [], "total": {
            "band": "TOTAL", "qsos": 0, "calls": 0, "cw": 0, "phone": 0,
            "digital": 0, "wpx": 0, "points": 0,
        }})


class StatisticsHostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.host = Host(Path(self.temporary.name).resolve() / "host")
        self.session = uid()
        self.revision = 0
        self.call("session_create", {"sessionID": self.session, "workspaceGeneration": uid(),
            "operationID": uid(), "expectedRevision": 0, "pluginID": "cq_ww_cw",
            "station": {"Call": "OM0RX", "GridSquare": "JN88", "CQZone": "15"}, "frequencyHz": 14025000,
            "settings": {"SentExchange": "15", "OperatorCategory": "SINGLE-OP",
                         "BandCategory": "ALL", "PowerCategory": "LOW"},
            "reference": {"id": "statistics-cty-v1", "countries": deepcopy(CTY)}})

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def call(self, method, params):
        result = self.host.dispatch({"id": uid(), "method": method, "params": params})
        self.revision = max(self.revision, result.get("revision", 0))
        return result

    def test_score_statistics_use_full_current_contest_and_do_not_mutate(self):
        store = self.host.database(self.session)
        base = store.get_empty().copy()
        start = datetime(2026, 10, 20, 0, 0)
        for index in range(151):
            row = {**base, "ID": uid(), "TS": (start + timedelta(seconds=index)).isoformat(" "),
                   "Call": f"K{index % 17}ABC", "ContestNR": store.current_contest,
                   "Band": (14.0, 7.0, 0.0)[index % 3],
                   "Mode": ("CW-R", "USB", "FT8", "ALIEN")[index % 4],
                   "WPXPrefix": "" if index % 5 == 0 else f"K{index % 7}", "Points": index % 4}
            store.log_contact(row)
        # A different contest in the same DXLOG must not leak into this score read.
        store.log_contact({**base, "ID": uid(), "TS": "2026-10-21 00:00:00", "Call": "FOREIGN",
                           "ContestNR": store.current_contest + 1, "Band": 28.0, "Mode": "CW",
                           "WPXPrefix": "F1", "Points": 999})
        store.conn.commit()
        operations = store.exec_sql("SELECT count(*) AS n FROM xlog_operation")["n"]
        changes = store.conn.total_changes

        result = self.call("contest_score", {"sessionID": self.session,
                                              "expectedRevision": self.revision})
        statistics = result["statistics"]
        self.assertEqual(statistics["total"]["qsos"], 151)
        self.assertEqual(statistics["total"]["calls"], 17)
        self.assertEqual(statistics["total"]["points"], sum(index % 4 for index in range(151)))
        self.assertEqual([row["band"] for row in statistics["rows"]], ["14.0", "7.0", "0.0"])
        self.assertEqual(statistics["total"]["wpx"], sum(row["wpx"] for row in statistics["rows"]))
        self.assertEqual(store.exec_sql("SELECT count(*) AS n FROM xlog_operation")["n"], operations)
        self.assertEqual(store.conn.total_changes, changes)
        self.assertEqual(result["revision"], self.revision)

        with self.assertRaises(HostError) as error:
            self.call("score", {"sessionID": self.session, "expectedRevision": self.revision - 1})
        self.assertEqual(error.exception.code, "stale_revision")
