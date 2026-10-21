"""First five remaining pinned Not1MM plugins through the bounded host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.plugins import FULL_PINNED_BANDS, PLUGIN_REGISTRY
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
HASHES = {
    "ca_qso_party": "0775e71559e17534f6b5817736eb0d89ae8926efd3028d2415d077ecfb6f7116",
    "canada_day": "6b72955add7b1b016493acc0ad8e2cf9188e63e104e06d1442fb6b79b5a54219",
    "cqws": "1aa412935a207a55152a80212a98bdd13409e05d83bb6c512ff52daf649f3720",
    "darc_schwaben": "77cca83fa1a57ed273f54ec2ada3dec8be377a96a669ff0926e0bfc369ecc237",
    "winter_field_day": "8cc5f8421909a482e52d08e0ce4144c772b04aa7c5364ffeb3f5f2b78bbbd489",
}
SETTINGS = {
    "ca_qso_party": "# ORAN/SBER",
    "canada_day": "# NT",
    "cqws": "DX",
    "darc_schwaben": "T01",
    "winter_field_day": "1O ORG",
}
FIELDS = {
    "ca_qso_party": ({"receive": "101", "other_1": "ALAM/SCLA"},
                     {"receive": "102", "other_1": "DX"}),
    "canada_day": ({"other_2": "ON"}, {"other_2": "42"}),
    "cqws": ({"other_2": "FD"}, {"other_2": "PT"}),
    "darc_schwaben": ({"other_2": "T01 JN58"}, {"other_2": "X01 JN59"}),
    "winter_field_day": ({"other_1": "1O", "other_2": "EMA"},
                         {"other_1": "2H", "other_2": "WMA"}),
}


class FirstRemainingPluginTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()

    def tearDown(self):
        self.temporary.cleanup()

    def create(self, plugin_id):
        root = Path(self.temporary.name).resolve() / f"{plugin_id}-{uid()}"
        host, session = Host(root), uid()
        result = host.dispatch({"id": uid(), "method": "session_create", "params": {
            "sessionID": session, "workspaceGeneration": uid(), "operationID": uid(),
            "expectedRevision": 0, "pluginID": plugin_id,
            "station": {"Call": "OM0RX", "GridSquare": "JN88XX"},
            "frequencyHz": 7025000, "mode": "CW",
            "settings": {"SentExchange": SETTINGS[plugin_id], "ModeCategory": "MIXED",
                         "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL",
                         "PowerCategory": "LOW"},
            "reference": {"id": "remaining-five-cty-v1", "countries": deepcopy(fixtures.CTY)},
        }})
        return host, root, session, result["revision"]

    @staticmethod
    def mutate(host, session, revision, method, **params):
        result = host.dispatch({"id": uid(), "method": method, "params": {
            "sessionID": session, "operationID": uid(), "expectedRevision": revision, **params}})
        return result, result["revision"]

    @staticmethod
    def read(host, session, method, **params):
        return host.dispatch({"id": uid(), "method": method,
                              "params": {"sessionID": session, **params}})

    def test_exact_sources_catalog_and_band_mode_contracts(self):
        self.assertEqual(len(PLUGIN_REGISTRY), 94)
        for plugin_id, digest in HASHES.items():
            with self.subTest(plugin=plugin_id):
                source = VENDOR / f"not1mm/plugins/{plugin_id}.py"
                self.assertEqual(sha256(source.read_bytes()).hexdigest(), digest)
                self.assertEqual(load_plugin(plugin_id).__file__, str(source))
                host, _, session, _ = self.create(plugin_id)
                try:
                    view = self.read(host, session, "projection")["projection"]
                    self.assertEqual(view["pluginName"], load_plugin(plugin_id).name)
                    self.assertEqual(view["supportedBands"], list(PLUGIN_REGISTRY[plugin_id].bands))
                    self.assertEqual(view["supportedModes"], list(PLUGIN_REGISTRY[plugin_id].modes))
                finally:
                    host.close()
        for plugin_id in ("canada_day", "cqws", "winter_field_day"):
            self.assertEqual(PLUGIN_REGISTRY[plugin_id].bands, FULL_PINNED_BANDS)
        self.assertEqual(PLUGIN_REGISTRY["winter_field_day"].modes,
                         ("CW", "SSB", "RTTY", "AM", "FM"))

    def test_each_plugin_lifecycle_recalculate_restart_and_exports(self):
        for plugin_id in HASHES:
            with self.subTest(plugin=plugin_id):
                host, root, session, revision = self.create(plugin_id)
                first, second = uid(), uid()
                try:
                    draft_fields = {"callsign": "K1ABC", **FIELDS[plugin_id][0]}
                    draft, revision = self.mutate(host, session, revision, "draft_apply", fields=draft_fields)
                    self.assertEqual(draft["projection"]["fields"][0]["value"], "K1ABC")
                    if plugin_id == "ca_qso_party":
                        self.assertEqual(draft["projection"]["allocatedSerialFieldID"], "sent")
                    for index, (qso_id, call, extra) in enumerate((
                            (first, "K1ABC", FIELDS[plugin_id][0]),
                            (second, "DL1ABC", FIELDS[plugin_id][1]))):
                        _, revision = self.mutate(
                            host, session, revision, "qso_commit", qsoID=qso_id,
                            timestamp=f"2026-10-21 10:00:0{index}", fields={"callsign": call, **extra})
                        if index == 0 and plugin_id in {"ca_qso_party", "winter_field_day"}:
                            cleared = {item["id"]: item["value"] for item in
                                       self.read(host, session, "projection")["projection"]["fields"]}
                            self.assertEqual(cleared["other_1"], "")
                            self.assertEqual(cleared["other_2"], "")
                            if plugin_id == "ca_qso_party":
                                self.assertEqual(cleared["receive"], "")
                    before = self.read(host, session, "score")["score"]
                    self.assertEqual(before["qsos"], 2)
                    _, revision = self.mutate(host, session, revision, "recalculate")
                    self.assertEqual(self.read(host, session, "score")["score"], before)
                    if plugin_id == "cqws":
                        self.assertEqual(before["total"], before["points"] * (1 + before["multipliers"]))
                    self.assertIn("QSO:", self.read(host, session, "export")["content"])
                    self.assertEqual(self.read(host, session, "export_prepare", format="adif")["format"], "adif")

                    setup = self.read(host, session, "setup_get")["setup"]
                    setup["settings"]["SentExchange"] = {
                        "ca_qso_party": "# ALAM", "canada_day": "FIXED", "cqws": "WS",
                        "darc_schwaben": "#", "winter_field_day": "2H EMA",
                    }[plugin_id]
                    _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
                    if plugin_id == "canada_day":
                        fields = {item["id"]: item["value"] for item in
                                  self.read(host, session, "projection")["projection"]["fields"]}
                        self.assertEqual(fields["other_1"], "FIXED")

                    correction = {"other_1": "SBER"} if plugin_id == "ca_qso_party" else {
                        "other_2": {"canada_day": "BC", "cqws": "WS", "darc_schwaben": "X01",
                                    "winter_field_day": "ORG"}[plugin_id]}
                    _, revision = self.mutate(host, session, revision, "qso_correct", qsoID=first,
                                              fields=correction, reason="Focused correction")
                    row = next(row for row in self.read(host, session, "log")["rows"] if row["ID"] == first)
                    historical = {
                        "ca_qso_party": ("SentNr", 1), "canada_day": ("SentNr", "001 NT"),
                        "cqws": ("SentNr", "DX"), "darc_schwaben": ("SentNr", "T01"),
                        "winter_field_day": ("MiscText", "1O ORG"),
                    }[plugin_id]
                    self.assertEqual(row[historical[0]], historical[1])
                    if plugin_id == "darc_schwaben":
                        self.assertEqual(row["Exchange1"], "")
                    cabrillo = self.read(host, session, "export")["content"]
                    if plugin_id == "ca_qso_party":
                        self.assertIn("ORAN", cabrillo)
                        self.assertNotIn(" ALAM ", cabrillo)
                    if plugin_id == "winter_field_day":
                        self.assertIn("1O ORG", cabrillo)
                    _, revision = self.mutate(host, session, revision, "qso_delete", qsoID=second,
                                              reason="Focused deletion")
                    _, revision = self.mutate(host, session, revision, "recalculate")
                finally:
                    host.close()
                host = Host(root)
                try:
                    self.assertEqual(len(self.read(host, session, "log")["rows"]), 1)
                    self.assertIn("QSO:", self.read(host, session, "export")["content"])
                    self.assertEqual(self.read(host, session, "export_prepare", format="adif")["format"], "adif")
                finally:
                    host.close()

    def test_cqp_county_lines_are_bounded_and_well_formed(self):
        host, _, session, revision = self.create("ca_qso_party")
        try:
            initial = {item["id"]: item["value"] for item in
                       self.read(host, session, "projection")["projection"]["fields"]}
            self.assertEqual(initial["receive"], "")
            for value in ("/ALAM", "ALAM/", "ALAM//SCLA", "ALAM/BOGUS"):
                with self.subTest(value=value), self.assertRaises(HostError):
                    self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                fields={"callsign": "K1ABC", "receive": "101", "other_1": value})
        finally:
            host.close()

    def test_cqp_same_second_multiplier_replay_is_stable(self):
        host, _, session, revision = self.create("ca_qso_party")
        try:
            for call in ("K1ABC", "DL1ABC"):
                _, revision = self.mutate(
                    host, session, revision, "qso_commit", qsoID=uid(),
                    timestamp="2026-10-21 10:00:00",
                    fields={"callsign": call, "receive": "101", "other_1": "ALAM"})
            rows = self.read(host, session, "log")["rows"]
            self.assertEqual({row["Call"]: row["IsMultiplier1"] for row in rows},
                             {"K1ABC": 1, "DL1ABC": 0})
        finally:
            host.close()

    def test_cqws_accepts_all_pinned_scoring_classes(self):
        host, _, session, revision = self.create("cqws")
        try:
            for index, exchange in enumerate(("SP", "CL", "HQ")):
                _, revision = self.mutate(
                    host, session, revision, "qso_commit", qsoID=uid(),
                    timestamp=f"2026-10-21 10:01:0{index}",
                    fields={"callsign": f"K1AB{index}", "other_2": exchange})
            self.assertEqual(self.read(host, session, "score")["score"]["points"], 7)
        finally:
            host.close()

    def test_darc_vhf_requires_locator_but_hf_does_not(self):
        host, _, session, revision = self.create("darc_schwaben")
        try:
            _, revision = self.mutate(host, session, revision, "draft_apply", frequencyHz=144300000)
            with self.assertRaises(HostError):
                self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                            fields={"callsign": "DL1ABC", "other_2": "T01"})
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      fields={"callsign": "DL1ABC", "other_2": "T01 JN58"})
            qso_id = self.read(host, session, "log")["rows"][0]["ID"]
            with self.assertRaises(HostError):
                self.mutate(host, session, revision, "qso_correct", qsoID=qso_id,
                            fields={"other_2": "T01"}, reason="Missing VHF grid")
            _, revision = self.mutate(host, session, revision, "draft_apply", frequencyHz=7025000)
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      fields={"callsign": "DL2ABC", "other_2": "T02"})
            hf_qso_id = next(row["ID"] for row in self.read(host, session, "log")["rows"]
                             if row["Call"] == "DL2ABC")
            _, revision = self.mutate(host, session, revision, "draft_apply", frequencyHz=144300000)
            self.mutate(host, session, revision, "qso_correct", qsoID=hf_qso_id,
                        fields={"other_2": "X02"}, reason="Valid historical HF exchange")
        finally:
            host.close()


if __name__ == "__main__":
    unittest.main()
