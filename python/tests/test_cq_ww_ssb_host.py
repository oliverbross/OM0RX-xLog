"""Original source-pinned CQ WW SSB plugin through the production host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures

uid = fixtures.uid


class CQWWSSBHostTests(unittest.TestCase):
    source_hash = "9ec3762986761232042389f0334b4887271772d18025f3dd0fdc820782105b3b"

    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.host = Host(self.root)
        self.session, self.workspace, self.revision = uid(), uid(), 0
        self.create = {
            "sessionID": self.session,
            "workspaceGeneration": self.workspace,
            "operationID": uid(),
            "expectedRevision": 0,
            "pluginID": "cq_ww_ssb",
            "station": {"Call": "OM0RX", "GridSquare": "JN88"},
            "frequencyHz": 14250000,
            "settings": {
                "SentExchange": "15",
                "ModeCategory": "SSB",
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "test-cty-v1", "countries": deepcopy(fixtures.CTY)},
        }
        self.call("session_create", self.create)

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

    def log(self, call="K1ABC", zone="5", minute=0, frequency=14250000):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=f"2026-10-20 08:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_2": zone},
        )
        return qso

    def test_original_source_catalog_layout_reports_and_zone_validation(self):
        source = VENDOR / "not1mm/plugins/cq_ww_ssb.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), self.source_hash)
        self.assertEqual(load_plugin("cq_ww_ssb").__file__, str(source))
        catalog = self.host.dispatch({"id": uid(), "method": "catalog", "params": {}})["plugins"]
        item = next(plugin for plugin in catalog if plugin["id"] == "cq_ww_ssb")
        self.assertEqual((item["name"], item["modes"], item["sentExchangeHint"]),
                         ("CQ WW SSB", ["SSB"], "CQ Zone No."))
        view = self.read("projection")["projection"]
        fields = {field["id"]: field for field in view["fields"]}
        self.assertEqual((view["mode"], view["supportedModes"]), ("SSB", ["SSB"]))
        self.assertEqual((fields["sent"]["value"], fields["receive"]["value"]), ("59", "59"))
        self.assertEqual((fields["other_1"]["value"], fields["other_1"]["visible"]), ("15", False))
        self.assertEqual((fields["other_2"]["label"], view["nextField"]), ("CQ Zone", "other_2"))
        for zone in ("", "0", "41", " 5"):
            with self.subTest(zone=zone), self.assertRaisesRegex(HostError, "CQ zone must be 1 to 40"):
                self.mutate("qso_commit", fields={"callsign": "K1ABC", "other_2": zone})
        setup = self.read("setup_get")["setup"]
        setup["settings"]["SentExchange"] = "41"
        with self.assertRaisesRegex(HostError, "Sent CQ zone must be 1 to 40"):
            self.mutate("setup_save", setup=setup)
        setup["settings"].update(SentExchange="15", ModeCategory="CW")
        with self.assertRaisesRegex(HostError, "requires SSB"):
            self.mutate("setup_save", setup=setup)

    def test_original_scoring_country_zone_multipliers_and_band_dupes(self):
        self.log()
        self.log("DL1ABC", "14", 1)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 2, "points": 4, "countries": 2, "zones": 2,
            "multipliers": 4, "total": 16,
        })
        self.log(minute=2)
        self.assertEqual(self.read("score")["score"]["points"], 4)
        self.log(minute=3, frequency=7125000)
        score = self.read("score")
        self.assertEqual(score["score"], {
            "qsos": 4, "points": 7, "countries": 3, "zones": 3,
            "multipliers": 6, "total": 42,
        })
        self.assertEqual(len(score["matrices"]["countries"]), 3)
        self.assertEqual(len(score["matrices"]["zones"]), 3)

    def test_unresolved_contacts_do_not_create_cq_ww_multipliers(self):
        self.log("XX1TEST", "10")
        unresolved = self.read("score")
        self.assertEqual(unresolved["score"], {
            "qsos": 1, "points": 0, "countries": 0, "zones": 0,
            "multipliers": 0, "total": 0,
        })
        self.assertEqual(unresolved["matrices"], {"countries": [], "zones": []})

        self.log("K1ABC", "5", minute=1)
        resolved = self.read("score")
        self.assertEqual(resolved["score"], {
            "qsos": 2, "points": 3, "countries": 1, "zones": 1,
            "multipliers": 2, "total": 6,
        })
        self.assertEqual(resolved["matrices"]["countries"], [
            {"value": "K", "band": 14.0, "qsos": 1},
        ])
        self.assertEqual(resolved["matrices"]["zones"], [
            {"value": 5, "band": 14.0, "qsos": 1},
        ])

    def test_valid_same_country_zero_point_qso_keeps_both_multipliers(self):
        self.log("OM1ABC", "15")
        self.assertEqual(self.read("score")["score"], {
            "qsos": 1, "points": 0, "countries": 1, "zones": 1,
            "multipliers": 2, "total": 0,
        })

    def test_same_band_duplicate_cannot_add_a_mistyped_zone_multiplier(self):
        first = self.log("K1ABC", "5", minute=1)
        duplicate = self.log("K1ABC", "4", minute=0)
        score = self.read("score")
        self.assertEqual(score["score"], {
            "qsos": 2, "points": 3, "countries": 1, "zones": 1,
            "multipliers": 2, "total": 6,
        })
        self.assertEqual(score["matrices"]["zones"], [
            {"value": 5, "band": 14.0, "qsos": 1},
        ])

        self.mutate("qso_correct", qsoID=duplicate,
                    fields={"callsign": "DL1ABC", "other_2": "14"}, reason="Correct duplicate")
        self.assertEqual(self.read("score")["score"]["total"], 16)
        self.mutate("qso_correct", qsoID=duplicate,
                    fields={"callsign": "K1ABC", "other_2": "4"}, reason="Restore duplicate")
        self.assertEqual(self.read("score")["score"]["total"], 6)

        self.mutate("qso_delete", qsoID=first, reason="Promote retained duplicate")
        promoted = self.read("score")
        self.assertEqual(promoted["score"], {
            "qsos": 1, "points": 3, "countries": 1, "zones": 1,
            "multipliers": 2, "total": 6,
        })
        self.assertEqual(promoted["matrices"]["zones"], [
            {"value": 4, "band": 14.0, "qsos": 1},
        ])

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 6)
        export = self.read("export")["content"]
        self.assertIn("CLAIMED-SCORE: 6\r\n", export)
        self.assertEqual(sum(line.startswith("QSO:") for line in export.splitlines()), 1)

    def test_unresolved_correction_transitions_rebuild_delete_restart_and_export(self):
        unresolved = self.log("XX1TEST", "10")
        self.mutate("qso_correct", qsoID=unresolved,
                    fields={"callsign": "K1ABC", "other_2": "5"}, reason="Resolve call")
        self.assertEqual(self.read("score")["score"]["total"], 6)

        self.mutate("qso_correct", qsoID=unresolved,
                    fields={"callsign": "XX1TEST", "other_2": "10"}, reason="Restore unresolved call")
        self.assertEqual(self.read("score")["score"], {
            "qsos": 1, "points": 0, "countries": 0, "zones": 0,
            "multipliers": 0, "total": 0,
        })

        own_country = self.log("OM1ABC", "15", minute=1)
        self.log("K1ABC", "5", minute=2)
        self.assertEqual(self.read("score")["score"]["total"], 12)
        self.mutate("qso_delete", qsoID=own_country, reason="Audit deletion")
        self.assertEqual(self.read("score")["score"]["total"], 6)

        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 2, "points": 3, "countries": 1, "zones": 1,
            "multipliers": 2, "total": 6,
        })
        export = self.read("export")["content"]
        self.assertIn("CLAIMED-SCORE: 6\r\n", export)
        self.assertEqual(sum(line.startswith("QSO:") for line in export.splitlines()), 2)

    def test_ssb_esm_commits_without_cw_output_and_guards_cw_context(self):
        self.assertEqual(self.mutate("function_key", key="F1")["actions"], [])
        with self.assertRaisesRegex(HostError, "does not support CW"):
            self.read("cw_context")
        sandp_call = self.mutate("esm", field="callsign", fields={"callsign": "K1ABC"})
        self.assertEqual(sandp_call["actions"], [])
        sandp_exchange = self.mutate("esm", field="other_2", fields={"other_2": "5"})
        self.assertEqual(sandp_exchange["actions"], [])
        self.assertEqual(self.read("log")["total"], 1)
        self.mutate("run_state", run=True)
        run_call = self.mutate("esm", field="callsign", fields={"callsign": "DL1ABC"})
        self.assertEqual(run_call["actions"], [])
        run_exchange = self.mutate("esm", field="other_2", fields={"other_2": "14"})
        self.assertEqual(run_exchange["actions"], [])
        self.assertEqual(self.read("log")["total"], 2)

    def test_correction_delete_restart_and_cabrillo_ph_output(self):
        self.mutate("draft_apply", fields={"sent": "57", "receive": "58"})
        first = self.log(frequency=7125000)
        second = self.log(minute=1)
        self.mutate("qso_correct", qsoID=first,
                    fields={"callsign": "DL1ABC", "other_2": "14"}, reason="Correct call")
        self.assertEqual(self.read("score")["score"]["total"], 16)
        self.mutate("qso_delete", qsoID=second, reason="Remove duplicate")
        self.assertEqual(self.read("score")["score"]["total"], 2)
        self.host.close()
        self.host = Host(self.root)
        self.assertEqual(self.read("score")["score"]["total"], 2)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: CQ-WW-SSB\r\n", export)
        self.assertIn("CATEGORY-MODE: SSB\r\n", export)
        self.assertIn("CLAIMED-SCORE: 2\r\n", export)
        lines = [line.split() for line in export.splitlines() if line.startswith("QSO:")]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0][1:3], ["7125", "PH"])
        self.assertEqual(lines[0][5:], ["OM0RX", "57", "15", "DL1ABC", "58", "14"])
        self.assertNotIn("CW", lines[0])


if __name__ == "__main__":
    unittest.main()
