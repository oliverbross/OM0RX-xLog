"""Pinned EUHFC and IARU HF plugins through the Python/SQLite host."""
from copy import deepcopy
from hashlib import sha256
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
CTY = {
    **deepcopy(fixtures.CTY),
    "DL2XYZ": {"entity": "Germany", "continent": "EU", "cq": 14, "itu": 28, "primary_pfx": "DL"},
    "DA0HQ": {"entity": "Germany", "continent": "EU", "cq": 14, "itu": 28, "primary_pfx": "DL"},
}
HASHES = {
    "euhfc": "2bec874fc12149a4ab76683b30459141c49f13f5d8423b2dd7c7e263ff68b683",
    "iaru_hf": "f8697ee440ee60b85ab88ea499f749294cf379130fa5a4b90fe7ccdb63bc3cde",
}


class ChampionshipHostCase(unittest.TestCase):
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
            "station": {"Call": "OM0RX", "GridSquare": "JN88", "IARUZone": 28},
            "frequencyHz": 14025000,
            "settings": {
                "SentExchange": self.sent_exchange,
                "ModeCategory": "CW",
                "OperatorCategory": "SINGLE-OP",
                "BandCategory": "ALL",
                "PowerCategory": "LOW",
            },
            "reference": {"id": "championship-test-cty-v1", "countries": deepcopy(CTY)},
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

    def log(self, call, exchange, minute, frequency=14025000):
        qso = uid()
        self.mutate(
            "qso_commit",
            qsoID=qso,
            timestamp=f"2026-10-21 12:{minute:02}:00",
            frequencyHz=frequency,
            fields={"callsign": call, "other_2": exchange},
        )
        return qso

    def assert_source(self):
        source = VENDOR / f"not1mm/plugins/{self.plugin_id}.py"
        self.assertEqual(sha256(source.read_bytes()).hexdigest(), HASHES[self.plugin_id])
        self.assertEqual(load_plugin(self.plugin_id).__file__, str(source))

    def switch_to_ssb(self):
        setup = self.read("setup_get")["setup"]
        setup["settings"]["ModeCategory"] = "SSB"
        return self.mutate("setup_save", setup=setup)


class EUHFCHostTests(ChampionshipHostCase):
    plugin_id = "euhfc"
    sent_exchange = "82"

    def test_original_scoring_band_mode_dupes_restart_and_export(self):
        self.assert_source()
        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual(
            (projection["pluginName"], projection["supportedModes"], projection["reservedSerial"]),
            ("EUHFC", ["CW", "SSB"], None),
        )
        self.assertEqual(
            (fields["other_1"]["visible"], fields["other_1"]["value"], fields["other_2"]["label"]),
            (False, "82", "Lic Year"),
        )

        first = self.log("DL1ABC", "17", 0)
        self.log("K1ABC", "17", 1)
        self.log("DL2XYZ", "44", 2, 7025000)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3, "points": 2, "countries": 0, "zones": 0,
            "multipliers": 2, "total": 4,
        })

        self.switch_to_ssb()
        self.log("DL1ABC", "17", 3)
        self.assertEqual(self.read("score")["score"]["total"], 6)
        duplicate_view = self.mutate("draft_apply", fields={"callsign": "DL1ABC", "other_2": "17"})
        self.assertTrue(duplicate_view["projection"]["dupe"])

        self.mutate("qso_correct", qsoID=first, fields={"other_2": "44"}, reason="Correct license year")
        corrected = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual((corrected["SentNr"], corrected["NR"], corrected["Points"]), (82, 44, 1))

        self.host.close()
        self.host = Host(self.root)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: EUHFC\r\n", export)
        self.assertEqual(len([line for line in export.splitlines() if line.startswith("QSO:")]), 4)

    def test_two_digit_exchange_validation_and_original_esm(self):
        for exchange in ("", "7", "123", "DX"):
            with self.subTest(exchange=exchange), self.assertRaisesRegex(HostError, "two digits"):
                self.mutate("qso_commit", fields={"callsign": "DL1ABC", "other_2": exchange})
        self.mutate("run_state", run=True)
        call = self.mutate("esm", field="callsign", fields={"callsign": "DL1ABC"})
        exchange = self.mutate("esm", field="other_2", fields={"other_2": "17"})
        self.assertEqual([action["key"] for action in call["actions"]], ["F2", "F3"])
        self.assertEqual([action["key"] for action in exchange["actions"]], ["F4"])
        self.assertEqual(self.read("log")["total"], 1)


class IARUHFHostTests(ChampionshipHostCase):
    plugin_id = "iaru_hf"
    sent_exchange = "28"

    def test_original_points_zone_and_hq_multipliers_restart_and_export(self):
        self.assert_source()
        projection = self.read("projection")["projection"]
        fields = {field["id"]: field for field in projection["fields"]}
        self.assertEqual(
            (projection["pluginName"], projection["supportedModes"], fields["other_1"]["value"],
             fields["other_2"]["label"]),
            ("IARU HF", ["CW", "SSB"], "28", "ITU Zone"),
        )

        first = self.log("DL1ABC", "28", 0)
        self.log("K1ABC", "8", 1)
        self.log("DA0HQ", "DARC", 2)
        self.assertEqual(self.read("score")["score"], {
            "qsos": 3, "points": 7, "countries": 0, "zones": 2,
            "headquarters": 1, "multipliers": 3, "total": 21,
        })
        self.mutate("qso_correct", qsoID=first, fields={"other_2": "29"}, reason="Correct ITU zone")
        corrected = next(row for row in self.read("log")["rows"] if row["ID"] == first)
        self.assertEqual((corrected["SentNr"], corrected["NR"], corrected["ZN"]), (28, 29, 29))

        self.host.close()
        self.host = Host(self.root)
        export = self.read("export")["content"]
        self.assertIn("CONTEST: IARU-HF\r\n", export)
        self.assertIn("CLAIMED-SCORE:", export)
        self.assertEqual(len([line for line in export.splitlines() if line.startswith("QSO:")]), 3)

    def test_received_zone_or_hq_validation_and_phone_esm_is_nontransmitting(self):
        for exchange in ("", "0", "91", "DARC-1", "a"):
            with self.subTest(exchange=exchange), self.assertRaisesRegex(HostError, "ITU zone 1 to 90 or an HQ"):
                self.mutate("qso_commit", fields={"callsign": "DL1ABC", "other_2": exchange})
        setup = self.read("setup_get")["setup"]
        del setup["station"]["IARUZone"]
        with self.assertRaisesRegex(HostError, "station IARU zone"):
            self.mutate("setup_save", setup=setup)
        self.switch_to_ssb()
        self.mutate("run_state", run=True)
        self.mutate("esm", field="callsign", fields={"callsign": "DL1ABC"})
        result = self.mutate("esm", field="other_2", fields={"other_2": "28"})
        self.assertEqual(result["actions"], [])
        self.assertEqual(self.read("log")["total"], 1)


class ChampionshipRelocationTests(unittest.TestCase):
    def test_both_pinned_modules_load_after_python_tree_relocation(self):
        with TemporaryDirectory() as directory:
            relocated = Path(directory) / "python"
            source = Path(__file__).resolve().parents[1]
            shutil.copytree(source / "contest_host", relocated / "contest_host")
            shutil.copytree(source / "vendor", relocated / "vendor")
            completed = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    (
                        "from contest_host.upstream import load_plugin; "
                        "print(load_plugin('euhfc').name); "
                        "print(load_plugin('iaru_hf').name)"
                    ),
                ],
                check=True,
                capture_output=True,
                text=True,
                cwd=directory,
                env={**os.environ, "PYTHONPATH": str(relocated)},
            )
            self.assertEqual(completed.stdout.splitlines(), ["EUHFC", "IARU HF"])


if __name__ == "__main__":
    unittest.main()
