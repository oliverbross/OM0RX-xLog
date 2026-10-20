"""Pinned ARRL DX SSB, NAQP SSB and Phone Weekly Test host coverage."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid


class PhonePluginHostCase(unittest.TestCase):
    plugin_id = ""
    sent_exchange = ""

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.call("session_create", {
            "sessionID": self.session,
            "workspaceGeneration": self.workspace,
            "operationID": uid(),
            "expectedRevision": 0,
            "pluginID": self.plugin_id,
            "station": {"Call": "OM0RX", "GridSquare": "JN88"},
            "frequencyHz": 14250000,
            "settings": {
                "SentExchange": self.sent_exchange,
                "ModeCategory": "SSB",
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "test-cty-v1", "countries": deepcopy(fixtures.CTY)},
        })

    def tearDown(self):
        self.host.close()
        self.temporary.cleanup()

    def call(self, method, params):
        result = self.host.dispatch({"id": uid(), "method": method, "params": params})
        if "revision" in result:
            self.revision = max(self.revision, result["revision"])
        return result

    def mutate(self, method, **kwargs):
        return self.call(method, {
            "sessionID": self.session,
            "operationID": uid(),
            "expectedRevision": self.revision,
            **kwargs,
        })

    def read(self, method, **kwargs):
        return self.call(method, {"sessionID": self.session, **kwargs})

    def log(self, call, name, section, minute, frequency):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=f"2026-10-20 09:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_1": name, "other_2": section},
        )
        return qso


class ARRLDXSSBHostTests(PhonePluginHostCase):
    plugin_id = "arrl_dx_ssb"
    sent_exchange = "100"
    source_hash = "357f333526a8cda2f654c84245056cf47cc95bbb0be0c1add64b1e53c3474387"

    def log(self, call, exchange, minute, frequency):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=f"2026-10-20 09:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_2": exchange},
        )
        return qso

    def test_original_source_layout_scoring_corrections_restart_and_export(self):
        source = VENDOR / "not1mm/plugins/arrl_dx_ssb.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), self.source_hash)
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))
        view = self.read("projection")["projection"]
        fields = {field["id"]: field for field in view["fields"]}
        self.assertEqual((view["pluginName"], view["mode"], view["supportedModes"]),
                         ("ARRL DX SSB", "SSB", ["SSB"]))
        self.assertEqual((fields["other_1"]["visible"], fields["other_2"]["label"]),
                         (False, "Power/State/Province"))
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]), ("59", "59"))
        with self.assertRaisesRegex(HostError, "does not support CW"):
            self.read("cw_context")
        self.assertEqual(self.mutate("function_key", key="F3")["actions"], [])

        first = self.log("K1ABC", "CT", 0, 14250000)
        second = self.log("K1ABC", "CT", 1, 7125000)
        self.log("DL1ABC", "500", 2, 14250000)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3,
            "points": 6,
            "countries": 0,
            "zones": 0,
            "states": 2,
            "multipliers": 2,
            "total": 12,
        })

        self.mutate("qso_correct", qsoID=first, fields={"other_2": "MA"}, reason="Correct state")
        corrected = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual((corrected["NR"], corrected["SentNr"], corrected["Points"]), ("MA", 100, 3))
        self.mutate("qso_delete", qsoID=second, reason="Remove second band")
        self.assertEqual(self.read("score")["score"]["total"], 3)

        self.host.close()
        self.host = Host(self.root)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: ARRL-DX-SSB\r\n", export)
        self.assertIn("CLAIMED-SCORE: 3\r\n", export)
        qso_lines = [line for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 2)
        self.assertTrue(any(all(token in line.split() for token in ("PH", "K1ABC", "MA"))
                            for line in qso_lines))


class NameSPCPhonePluginMixin:
    source_hash = ""
    contest_name = ""

    def test_original_source_layout_scoring_esm_corrections_and_export(self):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), self.source_hash)
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))
        view = self.read("projection")["projection"]
        fields = {field["id"]: field for field in view["fields"]}
        self.assertEqual((view["pluginName"], view["mode"], view["supportedModes"]),
                         (self.contest_name, "SSB", ["SSB"]))
        self.assertEqual((fields["sent"]["visible"], fields["receive"]["visible"]), (False, False))
        self.assertEqual((fields["other_1"]["label"], fields["other_2"]["label"]), ("Name", "State"))
        with self.assertRaisesRegex(HostError, "does not support CW"):
            self.read("cw_context")
        self.assertEqual(self.mutate("function_key", key="F3")["actions"], [])

        first = self.log("K1ABC", "JOHN", "CT", 0, 14250000)
        second = self.log("K1ABC", "JOHN", "CT", 1, 7125000)
        self.log("DL1ABC", "HANS", "", 2, 14250000)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3,
            "points": 2,
            "countries": 0,
            "zones": 0,
            # This is the pinned plugin's SQL exactly: an empty DX section is
            # distinct from its literal excluded value "DX".
            "sections": 3,
            "multipliers": 3,
            "total": 6,
        })
        projection = self.read("projection")["projection"]
        values = {field["id"]: field["value"] for field in projection["fields"]}
        self.assertEqual((values["other_1"], values["other_2"]), ("", ""))

        self.mutate("qso_correct", qsoID=first,
                    fields={"other_1": "JACK", "other_2": "MA"}, reason="Correct exchange")
        corrected = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual((corrected["Name"], corrected["Sect"], corrected["SentNr"]),
                         ("JACK", "MA", self.sent_exchange))
        self.mutate("qso_delete", qsoID=second, reason="Remove second band")
        self.assertEqual(self.read("score")["score"]["total"], 2)

        self.host.close()
        self.host = Host(self.root)
        export = self.read("export")["content"]
        self.assertIn(f"CONTEST: {load_plugin(self.plugin_id).cabrillo_name}\r\n", export)
        self.assertIn("CLAIMED-SCORE: 2\r\n", export)
        qso_lines = [line for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(qso_lines), 2)
        self.assertTrue(any("PH" in line.split() and self.sent_exchange in line
                            and all(token in line.split() for token in ("JACK", "MA"))
                            for line in qso_lines))


class NAQPSSBHostTests(NameSPCPhonePluginMixin, PhonePluginHostCase):
    plugin_id = "naqp_ssb"
    sent_exchange = "OLIVER DX"
    contest_name = "NAQP SSB"
    source_hash = "551b57f984cbaf4697a3ae9b146ad6f3519a14cc8df0dc9c3f30a7c5fea7c2bc"


class PhoneWeeklyTestHostTests(NameSPCPhonePluginMixin, PhonePluginHostCase):
    plugin_id = "phone_weekly_test"
    sent_exchange = "OLIVER DX"
    contest_name = "PHONE WEEKLY TEST"
    source_hash = "94770e46c5f16dae2d1bb0482f37011ff48678b49fa547c28cb4902f35bdefae"

    def test_10_metres_is_outside_the_original_plugin_band_set(self):
        with self.assertRaisesRegex(HostError, "160 through 15 metres"):
            self.mutate("draft_apply", frequencyHz=28500000, fields={})


if __name__ == "__main__":
    unittest.main()
