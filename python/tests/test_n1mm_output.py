from copy import deepcopy
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import uuid
from unittest.mock import patch
from xml.etree.ElementTree import fromstring

from contest_host.host import Host, HostError
from contest_host.n1mm import N1MMOutput


def uid():
    return str(uuid.uuid4())


class Datagram:
    def __init__(self, sink):
        self.sink = sink

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def sendto(self, packet, destination):
        self.sink.append((packet, destination))


class Recorder:
    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        return lambda destinations, values, **kwargs: self.calls.append((name, destinations, deepcopy(values), kwargs))


class N1MMOutputTests(unittest.TestCase):
    def test_invalid_optional_packet_does_not_block_an_independent_valid_packet(self):
        sent, receipts = [], []
        output = N1MMOutput(lambda **_: Datagram(sent), lambda *row: receipts.append(row))
        output.contact("127.0.0.1:12061", {"comment": "invalid\x00xml"})
        output.score("127.0.0.1:12063", {"score": 9})
        self.assertEqual([fromstring(packet).tag for packet, _ in sent], ["scoreinfo"])
        self.assertEqual([row[-2] for row in receipts], ["failed", "attempting", "sent_unverified"])

    def test_all_packet_roots_and_space_separated_destinations_are_intercepted(self):
        sent = []
        output = N1MMOutput(lambda **_: Datagram(sent))
        destinations = "127.0.0.1:12060 127.0.0.2:12061"
        output.radio(destinations, {"Freq": "1402500"})
        output.contact(destinations, {"call": "K1ABC"})
        output.contact(destinations, {"call": "K1ABC"}, replace=True)
        output.delete(destinations, {"call": "K1ABC"})
        output.lookup(destinations, {"call": "K1ABC"})
        output.score(destinations, {"score": 6})
        roots = [fromstring(packet).tag for packet, _ in sent[::2]]
        self.assertEqual(roots, ["RadioInfo", "contactinfo", "contactreplace", "contactdelete", "lookupinfo", "scoreinfo"])
        lookup = fromstring(sent[8][0])
        self.assertEqual((lookup.findtext("app"), lookup.findtext("countryprefix"),
                          lookup.findtext("continent"), lookup.findtext("zone")),
                         ("NOT1MM", "K", "NA", "5"))
        score = fromstring(sent[10][0])
        self.assertEqual((score.findtext("app"), score.findtext("score"), score.findtext("class/ops")),
                         ("NOT1MM", "6", "SINGLE-OP"))
        self.assertEqual([destination for _, destination in sent[:2]],
                         [("127.0.0.1", 12060), ("127.0.0.2", 12061)])


class N1MMHostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve() / "host"
        self.environment = patch.dict(os.environ, {"XLOG_CONTEST_N1MM_UDP_ALLOWED": "1"})
        self.environment.start()
        self.host = Host(self.root)
        self.recorder = Recorder()
        self.host.n1mm = self.recorder
        self.session, self.workspace, self.revision = uid(), uid(), 0
        countries = {
            "OM0RX": {"entity": "Slovak Republic", "continent": "EU", "cq": 15, "itu": 28, "primary_pfx": "OM"},
            "K1ABC": {"entity": "United States", "continent": "NA", "cq": 5, "itu": 8, "primary_pfx": "K"},
        }
        self.call("session_create", {"sessionID": self.session, "workspaceGeneration": self.workspace,
                  "operationID": uid(), "expectedRevision": 0, "pluginID": "cq_ww_cw",
                  "station": {"Call": "OM0RX", "GridSquare": "JN88", "CQZone": "15"}, "frequencyHz": 14025000,
                  "settings": {"SentExchange": "15", "OperatorCategory": "SINGLE-OP", "BandCategory": "ALL",
                               "PowerCategory": "LOW", "TransmitterCategory": "ONE"},
                  "reference": {"id": "test-cty-v1", "countries": countries}})
        setup = self.call("setup_get", {"sessionID": self.session})["setup"]
        setup["network"] = {
            "n1mmEnabled": True, "n1mmRadio": True, "n1mmContact": True,
            "n1mmLookup": True, "n1mmScore": True, "n1mmStationName": "Station A",
            "n1mmOperatorName": "OM0RX", "n1mmRadioDestinations": "127.0.0.1:12060",
            "n1mmContactDestinations": "127.0.0.1:12061 127.0.0.2:12061",
            "n1mmLookupDestinations": "127.0.0.1:12062", "n1mmScoreDestinations": "127.0.0.1:12063",
        }
        self.mutate("setup_save", setup=setup)
        self.recorder.calls.clear()

    def tearDown(self):
        self.host.close()
        self.environment.stop()
        self.temporary.cleanup()

    def call(self, method, params):
        result = self.host.dispatch({"id": uid(), "method": method, "params": params})
        self.revision = max(self.revision, result.get("revision", 0))
        return result

    def mutate(self, method, **values):
        return self.call(method, {"sessionID": self.session, "operationID": uid(),
                                  "expectedRevision": self.revision, **values})

    def test_radio_lookup_contact_replace_delete_and_score_events(self):
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": "5"})
        self.assertEqual([call[0] for call in self.recorder.calls], ["lookup"])
        lookup = self.recorder.calls[-1]
        self.assertEqual((lookup[1], lookup[2]["call"], lookup[2]["StationName"]),
                         ("127.0.0.1:12062", "K1ABC", "Station A"))

        self.recorder.calls.clear()
        self.mutate("draft_apply", frequencyHz=14026000)
        self.assertEqual([call[0] for call in self.recorder.calls], ["radio"])

        self.recorder.calls.clear()
        qso = uid()
        self.mutate("qso_commit", qsoID=qso, timestamp="2026-10-22 01:02:03")
        self.assertEqual([call[0] for call in self.recorder.calls], ["contact", "score"])
        contact = self.recorder.calls[0]
        self.assertEqual(contact[1], "127.0.0.1:12061 127.0.0.2:12061")
        self.assertEqual((contact[2]["ID"], contact[2]["call"], contact[2]["rxfreq"], contact[2]["points"]),
                         (qso, "K1ABC", "1402600", 3))

        self.recorder.calls.clear()
        self.mutate("qso_correct", qsoID=qso, reason="test", fields={"callsign": "OM0RX", "receive": "579"})
        self.assertEqual([call[0] for call in self.recorder.calls], ["contact", "score"])
        self.assertEqual(self.recorder.calls[0][3], {"replace": True})
        self.assertEqual((self.recorder.calls[0][2]["oldcall"], self.recorder.calls[0][2]["call"]),
                         ("K1ABC", "OM0RX"))

        self.recorder.calls.clear()
        self.mutate("qso_delete", qsoID=qso, reason="test")
        self.assertEqual([call[0] for call in self.recorder.calls], ["delete", "score"])
        self.assertEqual(self.recorder.calls[0][2]["ID"], qso)

    def test_missing_native_capability_prevents_output_even_when_user_enabled(self):
        self.host.n1mm_udp_allowed = False
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": "5"})
        self.assertEqual(self.recorder.calls, [])

    def test_operation_replay_does_not_resend_committed_packets(self):
        self.mutate("draft_apply", fields={"callsign": "K1ABC", "other_2": "5"})
        self.recorder.calls.clear()
        operation, qso = uid(), uid()
        params = {"sessionID": self.session, "operationID": operation,
                  "expectedRevision": self.revision, "qsoID": qso,
                  "timestamp": "2026-10-22 01:02:03"}
        first = self.call("qso_commit", params)
        first_calls = deepcopy(self.recorder.calls)
        replay = self.call("qso_commit", params)
        self.assertFalse(first["replayed"])
        self.assertTrue(replay["replayed"])
        self.assertEqual(self.recorder.calls, first_calls)

    def test_invalid_destination_is_rejected_before_setup_is_saved(self):
        setup = self.call("setup_get", {"sessionID": self.session})["setup"]
        setup["network"]["n1mmContactDestinations"] = "bad_name.example:12061"
        with self.assertRaisesRegex(HostError, "Invalid N1MM contact destination"):
            self.mutate("setup_save", setup=setup)

    def test_historical_operator_station_split_and_old_timestamp_are_distinct(self):
        state = self.host.database(self.session).state(self.session)
        values = self.host.n1mm_contact(state, {"ID": uid(), "Operator": "OLDOP", "StationPrefix": "OM0RX/P",
            "Freq": 7025, "TS": "2026-10-27 00:02:00", "_n1mm_oldtimestamp": "2026-10-26 23:59:00",
            "SentNr": "007", "_n1mm_lane": {"binding": {"radioID": "radio2"}, "receiveFrequencyHz": 7026000}})
        self.assertEqual((values["mycall"], values["operator"], values["rxfreq"], values["txfreq"], values["radionr"]),
                         ("OM0RX/P", "OLDOP", "702600", "702500", "2"))
        self.assertEqual((values["sntnr"], values["oldtimestamp"], values["SentExchange"]),
                         ("007", "2026-10-26 23:59:00", "15"))
        values = self.host.n1mm_contact(state, {"Freq": 7025, "_n1mm_lane": {"receiveFrequencyHz": None}})
        self.assertEqual((values["rxfreq"], values["operator"], values["radionr"]), ("", "", ""))

    def test_failed_destination_is_durable_independent_and_reviewed_retry_is_fenced(self):
        sent = []
        class FailFirstDestination(Datagram):
            def sendto(self, packet, destination):
                if destination[0] == "127.0.0.1":
                    raise OSError("synthetic optional consumer unavailable")
                super().sendto(packet, destination)
        self.host.n1mm = N1MMOutput(lambda **_: FailFirstDestination(sent), self.host.record_n1mm_delivery)
        qso = uid()
        self.mutate("qso_commit", qsoID=qso, timestamp="2026-10-27 00:00:00", fields={"callsign": "K1ABC", "other_2": "5"})
        self.assertEqual(len(self.call("log", {"sessionID": self.session})["rows"]), 1)
        status = self.call("n1mm_delivery", {"sessionID": self.session, "workspaceGeneration": self.workspace})
        contact = [row for row in status["rows"] if row["kind"] == "contactinfo"]
        self.assertEqual({row["outcome"] for row in contact}, {"failed", "sent_unverified"})
        self.assertFalse(status["remotePersistenceVerified"])
        self.assertTrue(any(fromstring(packet).tag == "contactinfo" for packet, _ in sent))
        failed = next(row for row in contact if row["outcome"] == "failed")
        self.host.close(); self.host = Host(self.root)
        self.host.n1mm = N1MMOutput(lambda **_: Datagram(sent), self.host.record_n1mm_delivery)
        params = {"sessionID": self.session, "workspaceGeneration": self.workspace, "deliveryID": failed["id"],
                  "sha256": failed["sha256"], "expectedAttempts": 1, "confirmUncertain": True}
        retried = self.call("n1mm_retry", params)
        updated = next(row for row in retried["rows"] if row["id"] == failed["id"])
        self.assertEqual((updated["outcome"], updated["attempts"]), ("sent_unverified", 2))
        self.assertEqual(len(self.call("log", {"sessionID": self.session})["rows"]), 1)
        with self.assertRaises(HostError) as error:
            self.call("n1mm_retry", params)
        self.assertEqual(error.exception.code, "stale_delivery")
        self.mutate("qso_correct", qsoID=qso, fields={"callsign": "OM0RX"}, reason="supersede old output")
        with self.assertRaises(HostError) as error:
            self.call("n1mm_retry", {**params, "expectedAttempts": 2})
        self.assertEqual(error.exception.code, "stale_delivery")


if __name__ == "__main__":
    unittest.main()
