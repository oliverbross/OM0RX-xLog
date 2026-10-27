"""WAE/QTC fixtures with independent arithmetic, using the real host owner."""
from copy import deepcopy
import unittest
from contest_host.host import Host, HostError
import test_host as fixtures


class QTCTests(unittest.TestCase):
    setUp = fixtures.HostTests.setUp
    tearDown = fixtures.HostTests.tearDown
    call = fixtures.HostTests.call
    mutate = fixtures.HostTests.mutate
    read = fixtures.HostTests.read

    def create_wae(self, plugin="wae_cw", own="OM0RX"):
        self.session, self.workspace, self.revision = fixtures.uid(), fixtures.uid(), 0
        create = deepcopy(self.create)
        create.update(sessionID=self.session, workspaceGeneration=self.workspace, operationID=fixtures.uid(),
                      pluginID=plugin, mode=plugin[4:].upper(), station={"Call": own, "GridSquare": "JN88", "CQZone": "15"})
        create["settings"]["SentExchange"] = "#"
        return self.call("session_create", create)

    def qtc(self, action, **values):
        return self.mutate("strategy_apply", workspaceGeneration=self.workspace, action=action, **values)

    def view(self, **values):
        return self.read("strategy", section="qtc", workspaceGeneration=self.workspace, expectedRevision=self.revision, **values)

    def log(self, call, serial, minute=0):
        qso = fixtures.uid()
        self.mutate("qso_commit", qsoID=qso, timestamp=f"2026-08-08 08:{minute:02}:00", fields={"callsign": call, "other_2": serial})
        return qso

    def receive(self, items=None, **values):
        return self.qtc("qtc_create", batchID="receive-1", number=1, direction="receive", counterpart="K1ABC",
                        timestamp="2026-08-08 09:00:00", frequencyHz=14025000,
                        items=items or [{"time": "0800", "callsign": "DL1ABC", "serial": "12"}], **values)

    def test_partial_batch_restart_receipt_replay_and_independent_score_export(self):
        self.create_wae()
        self.log("K1ABC", "21")
        self.receive([{"time": f"08{i:02}", "callsign": f"DL{i}ABC", "serial": str(i+1)} for i in range(10)])
        params = {"sessionID": self.session, "workspaceGeneration": self.workspace, "expectedRevision": self.revision,
                  "operationID": fixtures.uid(), "action": "qtc_confirm", "batchID": "receive-1", "index": 0}
        before = deepcopy(self.host.database(self.session).state(self.session)["draft"])
        first = self.call("strategy_apply", params)
        self.assertEqual(first["actions"], [])
        self.host.close(); self.host = Host(self.root)
        self.assertTrue(self.call("strategy_apply", params)["replayed"])
        self.assertEqual(self.view()["score"]["qtcPoints"], 1)
        self.assertEqual(self.view()["score"]["total"], 4)  # (one QSO + one QTC) * W1 on 20m weighted 2.
        self.assertEqual(self.read("log")["total"], 1)
        self.assertEqual(self.host.database(self.session).state(self.session)["draft"], before)
        payload = self.read("export")["content"]
        self.assertEqual(payload.count("QSO:"), 1); self.assertEqual(payload.count("QTC:"), 1)
        self.assertIn("OM0RX 1/10 K1ABC 0800 DL0ABC 1", payload)
        self.qtc("qtc_cancel", batchID="receive-1")
        self.assertEqual(self.view()["score"]["qtcPoints"], 1)
        with self.assertRaises(HostError): self.qtc("qtc_confirm", batchID="receive-1", index=1)
        self.qtc("qtc_resume", batchID="receive-1")
        self.qtc("qtc_item", batchID="receive-1", index=1, item={"time":"0811", "callsign":"DL1XYZ", "serial":"77"})
        self.qtc("qtc_confirm", batchID="receive-1", index=1)
        self.assertEqual(self.view()["score"]["total"], 6)
        with self.assertRaises(HostError): self.qtc("qtc_header", batchID="receive-1", number=2)
        with self.assertRaises(HostError): self.qtc("qtc_item", batchID="receive-1", index=1, item={"time":"0811", "callsign":"DL1XYZ", "serial":"99"})

    def test_sender_sources_counterpart_exclusion_and_immutable_snapshot(self):
        self.create_wae(own="K1ABC")
        qso = self.log("OM1ABC", "13")
        self.log("DL1ABC", "9", 1)
        sources = self.view(counterpart="DL1ABC", direction="send")["eligibleSources"]
        self.assertEqual([row["sourceQSOID"] for row in sources], [qso])
        self.qtc("qtc_create", batchID="sent-1", number=1, direction="send", counterpart="DL1ABC",
                 timestamp="2026-08-08 09:00:00", frequencyHz=14025000, items=[{"sourceQSOID": qso}])
        self.qtc("qtc_confirm", batchID="sent-1", index=0)
        snapshot = self.view()["batches"][0]["items"][0]
        self.mutate("qso_correct", qsoID=qso, fields={"other_2": "99"})
        self.assertEqual(self.view()["batches"][0]["items"][0], snapshot)
        self.assertEqual(self.view(counterpart="DL1ABC", direction="send")["eligibleSources"], [])
        self.qtc("qtc_repeat", batchID="sent-1", index=0, fields="serial")
        self.assertEqual(self.view()["score"]["qtcPoints"], 1)
        self.assertIn("OM1ABC 13", self.read("export")["content"])

    def test_direction_continent_unknown_and_quota_guards(self):
        self.create_wae()
        with self.assertRaises(HostError):
            self.qtc("qtc_create", batchID="bad", number=1, direction="send", counterpart="K1ABC", items=[])
        self.assertIn("Resolve", self.view(counterpart="UNKNOWN")["eligibility"])
        self.create_wae("wae_rtty")
        self.assertIsNone(self.view(counterpart="K1ABC", direction="send")["eligibility"])
        self.assertIn("different continents", self.view(counterpart="DL1ABC")["eligibility"])
        self.receive([{"time": f"08{i:02}", "callsign": f"DL{i}ABC", "serial": str(i+1)} for i in range(10)])
        with self.assertRaises(HostError):
            self.qtc("qtc_create", batchID="over", number=2, direction="receive", counterpart="K1ABC", timestamp="2026-08-08 10:00:00", frequencyHz=14025000,
                     items=[{"time": "1000", "callsign": "DL1XYZ", "serial": "12"}])

    def test_zero_serial_only_new_multiplier_and_nonqualifying_eu_qso(self):
        self.create_wae()
        self.log("K1ABC", "000")
        self.log("DL1ABC", "5", 1)
        current = self.view()["score"]
        self.assertEqual((current["points"], current["multipliers"], current["total"]), (1, 2, 2))
        self.mutate("qso_delete", qsoID=self.read("log")["rows"][-1]["ID"])
        self.assertEqual(self.view()["score"]["total"], 0)

    def test_three_reviewed_modes_share_serial_log_score_and_export_authority(self):
        for mode in ("cw", "ssb", "rtty"):
            with self.subTest(mode=mode):
                self.create_wae("wae_"+mode)
                self.log("K1ABC", "21")
                self.assertEqual((self.view()["score"]["points"], self.view()["score"]["multipliers"], self.view()["score"]["total"]), (1,2,2))
                exported = self.read("export")["content"]
                self.assertIn("CONTEST: WAE-DX-"+mode.upper(), exported)
                self.assertEqual(exported.count("QSO:"),1)


if __name__ == "__main__": unittest.main()
