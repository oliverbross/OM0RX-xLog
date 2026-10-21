"""Pinned Not1MM utility and dupe-type-4 plugins through the bounded host."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from contest_host.host import Host, HostError
from contest_host.store import CALLHISTORY_COLUMNS
from contest_host.upstream import VENDOR, load_plugin
import test_host as fixtures


uid = fixtures.uid
HASHES = {
    "dxpedition": "7af5440718a7d4910b3c4eeac31a927001c63f6ef806370aa74de0f8b0993bc8",
    "general_logging": "e016498859d98cc915c2e1bfd1c3aa616fcba827c579ede193347ef39766f26d",
    "randomgram": "d93f7009517c4d179062ddd74327dbb90f9800a5e4ecfe6660fda310596112e9",
    "qso_party_rst": "f3d97ca32cdd4a6779153e82d4d75ff1daca2aed27107a514b09e5dcb7e033ef",
    "qso_party_sn": "1d1ba1669c7308eff804b1c589a35fa523df210c23e1c88db46070e247330325",
}
CASES = {
    "dxpedition": ({"callsign": "K1ABC", "sent": "599", "receive": "579"}, 0),
    "general_logging": ({"callsign": "K1ABC", "other_1": "Alice", "other_2": "portable"}, 0),
    "randomgram": ({"callsign": "K1ABC", "other_1": "ABC", "other_2": "XYZ"}, 2),
    "qso_party_rst": ({"callsign": "K1ABC", "other_1": "NEW"}, 2),
    "qso_party_sn": ({"callsign": "K1ABC", "receive": "42", "other_1": "NEW"}, 2),
}


class Type4UtilityPluginTests(unittest.TestCase):
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
            "settings": {"SentExchange": "NIT", "ModeCategory": "CW",
                         "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL",
                         "PowerCategory": "LOW"},
            "reference": {"id": "type4-cty-v1", "countries": deepcopy(fixtures.CTY)},
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

    def test_exact_source_catalog_layout_and_dxpedition_running_facade(self):
        expected = {
            "dxpedition": ("DX-Pedition", ["CW", "SSB"]),
            "general_logging": ("General Logging", ["CW", "SSB"]),
            "randomgram": ("RandomGram", ["CW"]),
            "qso_party_rst": ("QSO PARTY RST", ["CW", "SSB"]),
            "qso_party_sn": ("QSO PARTY SN", ["CW", "SSB"]),
        }
        for plugin_id, digest in HASHES.items():
            with self.subTest(plugin=plugin_id):
                source = VENDOR / f"not1mm/plugins/{plugin_id}.py"
                self.assertEqual(sha256(source.read_bytes()).hexdigest(), digest)
                self.assertEqual(load_plugin(plugin_id).__file__, str(source))
                self.assertEqual(load_plugin(plugin_id).dupe_type, 4)
                host, _, session, _ = self.create(plugin_id)
                try:
                    view = self.read(host, session, "projection")["projection"]
                    self.assertEqual((view["pluginName"], view["supportedModes"]), expected[plugin_id])
                    self.assertTrue(view["allowDuplicateCommit"])
                    self.assertFalse(view["dupe"])
                    self.assertEqual(view["dupeExplanation"], "Duplicate checking disabled.")
                    self.assertEqual(view["exportFormats"],
                                     ["cabrillo", "adif"] if plugin_id.startswith("qso_party_") else ["adif"])
                    if plugin_id == "dxpedition":
                        self.assertTrue(view["run"])
                    fields = {item["id"]: item for item in view["fields"]}
                    self.assertEqual(fields["other_2"]["visible"], plugin_id in {"general_logging", "randomgram"})
                    if plugin_id == "qso_party_sn":
                        self.assertEqual((view["reservedSerial"], fields["sent"]["value"], fields["sent"]["readOnly"]),
                                         (1, "001", True))
                finally:
                    host.close()

    def test_repeated_calls_commit_and_zero_or_simple_score(self):
        for plugin_id, (fields, points) in CASES.items():
            with self.subTest(plugin=plugin_id):
                host, _, session, revision = self.create(plugin_id)
                try:
                    for second in (0, 1):
                        _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                                  timestamp=f"2026-10-21 10:00:0{second}", fields=fields)
                    rows = self.read(host, session, "log")["rows"]
                    self.assertEqual([row["Points"] or 0 for row in rows], [points, points])
                    score = self.read(host, session, "score")["score"]
                    self.assertEqual(score["qsos"], 2)
                    self.assertEqual(score["points"], points * 2)
                    self.assertEqual(score["multipliers"], 1 if plugin_id.startswith("qso_party_") else 0)
                    self.assertEqual(score["total"], points * 2 if plugin_id.startswith("qso_party_") else 0)
                finally:
                    host.close()

    def test_received_fields_clear_between_contacts_and_log_returns_raw_fields(self):
        cases = {
            "general_logging": (
                {"callsign": "K1ABC", "other_1": "Alice", "other_2": "portable"},
                {"callsign": "DL1ABC"},
            ),
            "qso_party_rst": (
                {"callsign": "K1ABC", "other_1": "NEW"},
                {"callsign": "DL1ABC", "other_1": "CA"},
            ),
            "qso_party_sn": (
                {"callsign": "K1ABC", "receive": "42", "other_1": "NEW"},
                {"callsign": "DL1ABC", "receive": "43", "other_1": "TX"},
            ),
        }
        for plugin_id, (first_fields, second_fields) in cases.items():
            with self.subTest(plugin=plugin_id):
                host, _, session, revision = self.create(plugin_id)
                try:
                    _, revision = self.mutate(
                        host, session, revision, "qso_commit", qsoID=uid(),
                        timestamp="2026-10-21 10:30:00", fields=first_fields,
                    )
                    projection = self.read(host, session, "projection")["projection"]
                    projected = {item["id"]: item["value"] for item in projection["fields"]}
                    self.assertEqual(projected["other_1"], "")
                    if plugin_id == "qso_party_sn":
                        self.assertEqual((projection["reservedSerial"], projected["sent"]), (2, "002"))

                    _, revision = self.mutate(
                        host, session, revision, "qso_commit", qsoID=uid(),
                        timestamp="2026-10-21 10:30:01", fields=second_fields,
                    )
                    rows = list(reversed(self.read(host, session, "log")["rows"]))
                    first_raw = {"callsign": "", "sent": "599", "receive": "599",
                                 "other_1": "", "other_2": ""}
                    second_raw = dict(first_raw)
                    if plugin_id == "qso_party_sn":
                        first_raw["sent"], second_raw["sent"] = "001", "002"
                    first_raw.update(first_fields)
                    second_raw.update(second_fields)
                    self.assertEqual(rows[0]["raw_fields"], first_raw)
                    self.assertEqual(rows[1]["raw_fields"], second_raw)
                    if plugin_id == "general_logging":
                        self.assertEqual(rows[1]["Name"], "")
                    else:
                        self.assertEqual(rows[1]["Exchange1"], second_fields["other_1"])
                    if plugin_id == "qso_party_sn":
                        projection = self.read(host, session, "projection")["projection"]
                        projected = {item["id"]: item["value"] for item in projection["fields"]}
                        self.assertEqual((projection["reservedSerial"], projected["sent"]), (3, "003"))
                finally:
                    host.close()

    def test_correction_preserves_historical_rover_location_and_cabrillo(self):
        host, _, session, revision = self.create("qso_party_rst")
        qso_id = uid()
        try:
            _, revision = self.mutate(host, session, revision, "rover_location", location="FN20")
            _, revision = self.mutate(
                host, session, revision, "qso_commit", qsoID=qso_id,
                timestamp="2026-10-21 10:45:00",
                fields={"callsign": "K1ABC", "receive": "579", "other_1": "NEW"},
            )
            _, revision = self.mutate(host, session, revision, "rover_location", location="FN21")
            _, revision = self.mutate(
                host, session, revision, "qso_correct", qsoID=qso_id,
                fields={"receive": "589"}, reason="Correct received report",
            )
            row = self.read(host, session, "log")["rows"][0]
            self.assertEqual((row["RoverLocation"], row["RCV"]), ("FN20", "589"))
            qso_line = next(
                line for line in self.read(host, session, "export")["content"].splitlines()
                if line.startswith("QSO:")
            )
            self.assertIn("FN20", qso_line)
            self.assertNotIn("FN21", qso_line)
        finally:
            host.close()

    def test_draft_commit_edit_delete_restart_replay_and_historical_sent_fields(self):
        host, root, session, revision = self.create("qso_party_sn")
        first, second = uid(), uid()
        try:
            draft, revision = self.mutate(host, session, revision, "draft_apply",
                                           fields={"callsign": "K1ABC", "receive": "42", "other_1": "NEW"})
            self.assertEqual({item["id"]: item["value"] for item in draft["projection"]["fields"]}["sent"], "001")
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=first,
                                      timestamp="2026-10-21 11:00:00",
                                      fields={"callsign": "K1ABC", "receive": "42", "other_1": "NEW"})
            self.assertEqual({item["id"]: item["value"] for item in self.read(host, session, "projection")["projection"]["fields"]}["sent"], "002")
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=second,
                                      timestamp="2026-10-21 11:00:01",
                                      fields={"callsign": "K1ABC", "receive": "43", "other_1": "OLD"})
            setup = self.read(host, session, "setup_get")["setup"]
            setup["settings"]["SentExchange"] = "NEWSETUP"
            _, revision = self.mutate(host, session, revision, "setup_save", setup=setup)
            _, revision = self.mutate(host, session, revision, "qso_correct", qsoID=first,
                                      fields={"other_1": "OLD"}, reason="Correct county")
            row = next(row for row in self.read(host, session, "log")["rows"] if row["ID"] == first)
            self.assertEqual((row["SentNr"], row["NR"], row["Exchange1"]), (1, 42, "OLD"))
            _, revision = self.mutate(host, session, revision, "qso_delete", qsoID=second,
                                      reason="Remove test QSO")
            _, revision = self.mutate(host, session, revision, "recalculate")
        finally:
            host.close()
        host = Host(root)
        try:
            rows = self.read(host, session, "log")["rows"]
            self.assertEqual(len(rows), 1)
            self.assertEqual((rows[0]["SentNr"], rows[0]["NR"]), (1, 42))
            view = self.read(host, session, "projection")["projection"]
            self.assertEqual((view["reservedSerial"], {item["id"]: item["value"] for item in view["fields"]}["sent"]),
                             (3, "003"))
            self.assertEqual(self.read(host, session, "score")["score"]["total"], 2)
        finally:
            host.close()

    def test_exports_and_esm_function_keys(self):
        for plugin_id in HASHES:
            with self.subTest(plugin=plugin_id):
                host, _, session, revision = self.create(plugin_id)
                try:
                    fields = CASES[plugin_id][0]
                    _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                              timestamp="2026-10-21 12:00:00", fields=fields)
                    adif = self.read(host, session, "export_prepare", format="adif")
                    self.assertEqual(adif["format"], "adif")
                    if plugin_id.startswith("qso_party_"):
                        cabrillo = self.read(host, session, "export")["content"]
                        self.assertIn("CONTEST: QSO_PARTY\r\n", cabrillo)
                        self.assertIn("QSO:", cabrillo)
                    else:
                        with self.assertRaisesRegex(HostError, "does not provide CABRILLO export") as caught:
                            self.read(host, session, "export")
                        self.assertEqual(caught.exception.code, "export_unsupported")
                    view, revision = self.mutate(host, session, revision, "draft_apply",
                                                 fields={"callsign": "K1ABC"})
                    action, revision = self.mutate(host, session, revision, "function_key", key="F2")
                    self.assertEqual(action["actions"][0]["kind"], "function_key")
                finally:
                    host.close()

    def test_qso_party_serial_replay_and_same_second_tie(self):
        host, root, session, revision = self.create("qso_party_sn")
        first_operation, first_qso = uid(), uid()
        try:
            request = {"id": uid(), "method": "qso_commit", "params": {
                "sessionID": session, "operationID": first_operation, "expectedRevision": revision,
                "qsoID": first_qso, "timestamp": "2026-10-21 13:00:00",
                "fields": {"callsign": "K1ABC", "receive": "41", "other_1": "NEW"}}}
            first = host.dispatch(request)
            revision = first["revision"]
            replay = host.dispatch(request)
            self.assertTrue(replay["replayed"])
            self.assertEqual(replay["revision"], revision)
            _, revision = self.mutate(host, session, revision, "qso_commit", qsoID=uid(),
                                      timestamp="2026-10-21 13:00:00",
                                      fields={"callsign": "DL1ABC", "receive": "42", "other_1": "NEW"})
            rows = self.read(host, session, "log")["rows"]
            self.assertEqual([row["SentNr"] for row in reversed(rows)], [1, 2])
            self.assertEqual(sum(row["IsMultiplier1"] for row in rows), 1)
        finally:
            host.close()
        host = Host(root)
        try:
            self.assertEqual(sum(row["IsMultiplier1"] for row in self.read(host, session, "log")["rows"]), 1)
            view = self.read(host, session, "projection")["projection"]
            self.assertEqual((view["reservedSerial"], {item["id"]: item["value"] for item in view["fields"]}["sent"]),
                             (3, "003"))
        finally:
            host.close()

    def test_qso_party_locations_are_bounded_and_parameterized(self):
        for plugin_id in ("qso_party_rst", "qso_party_sn"):
            with self.subTest(plugin=plugin_id):
                host, root, session, revision = self.create(plugin_id)
                try:
                    for index, location in enumerate(("O'BRIEN", "St John/2"), start=1):
                        fields = {"callsign": f"K{index}ABC", "other_1": location}
                        if plugin_id == "qso_party_sn":
                            fields["receive"] = str(40 + index)
                        _, revision = self.mutate(
                            host, session, revision, "qso_commit", qsoID=uid(),
                            timestamp=f"2026-10-21 14:00:0{index}", fields=fields,
                        )
                    _, revision = self.mutate(host, session, revision, "recalculate")
                    rows_before = self.read(host, session, "log")["rows"]
                    identities_before = [row["ID"] for row in rows_before]
                    self.assertEqual(
                        {row["Exchange1"] for row in rows_before}, {"O'BRIEN", "ST JOHN/2"}
                    )
                    self.assertEqual(sum(row["IsMultiplier1"] for row in rows_before), 2)

                    invalid_locations = ("", "X';DELETE--", "NEW\nDROP", "NEW\x7f", "A" * 16)
                    for location in invalid_locations:
                        with self.subTest(plugin=plugin_id, rejected=repr(location)):
                            with self.assertRaises(HostError):
                                self.mutate(
                                    host, session, revision, "qso_commit", qsoID=uid(),
                                    fields={"callsign": "DL1ABC", "receive": "43",
                                            "other_1": location},
                                )
                            self.assertEqual(
                                [row["ID"] for row in self.read(host, session, "log")["rows"]],
                                identities_before,
                            )
                finally:
                    host.close()

                host = Host(root)
                try:
                    _, revision = self.mutate(host, session, revision, "recalculate")
                    restarted = self.read(host, session, "log")["rows"]
                    self.assertEqual([row["ID"] for row in restarted], identities_before)
                    self.assertEqual(sum(row["IsMultiplier1"] for row in restarted), 2)
                finally:
                    host.close()

    def test_dxpedition_prev_call_persists_between_native_esm_requests(self):
        host, _, session, revision = self.create("dxpedition")
        try:
            first, revision = self.mutate(host, session, revision, "esm", field="callsign",
                                          fields={"callsign": "K1ABC"})
            self.assertEqual([action["key"] for action in first["actions"]], ["F2", "F3"])
            self.assertEqual(self.read(host, session, "log")["total"], 0)
            second, revision = self.mutate(host, session, revision, "esm", field="callsign",
                                           fields={"callsign": "K1ABC"})
            self.assertEqual([action["key"] for action in second["actions"]], ["F4"])
            self.assertEqual(self.read(host, session, "log")["total"], 1)
            self.assertEqual({item["id"]: item["value"] for item in second["projection"]["fields"]}["callsign"], "")
            _, revision = self.mutate(host, session, revision, "draft_apply", fields={"callsign": ""})
            fresh, revision = self.mutate(host, session, revision, "esm", field="callsign",
                                          fields={"callsign": "DL1ABC"})
            self.assertEqual([action["key"] for action in fresh["actions"]], ["F2", "F3"])
            self.assertEqual(self.read(host, session, "log")["total"], 1)
        finally:
            host.close()

    def test_qso_party_callhistory_exch1_aliases_match_original_plugins(self):
        for plugin_id in ("qso_party_rst", "qso_party_sn"):
            with self.subTest(plugin=plugin_id):
                host, _, session, revision = self.create(plugin_id)
                try:
                    view = self.read(host, session, "projection")["projection"]
                    workspace = view["workspaceGeneration"]
                    history = {column: "" for column in CALLHISTORY_COLUMNS}
                    history.update(Call="K1ABC", Exch1="NEW")
                    generation, digest = uid(), "a" * 64
                    scope = {"sessionID": session, "workspaceGeneration": workspace,
                             "generation": generation, "digest": digest}
                    host.dispatch({"id": uid(), "method": "history_stage_begin",
                                   "params": {**scope, "rowCount": 1}})
                    host.dispatch({"id": uid(), "method": "history_stage_chunk",
                                   "params": {**scope, "offset": 0, "rows": [history]}})
                    host.dispatch({"id": uid(), "method": "history_stage_commit",
                                   "params": {**scope, "rowCount": 1}})
                    result, revision = self.mutate(host, session, revision, "draft_apply",
                                                   fields={"callsign": "K1ABC"})
                    self.assertEqual(result["projection"]["history"], "K1ABC, NEW")
                finally:
                    host.close()


if __name__ == "__main__":
    unittest.main()
