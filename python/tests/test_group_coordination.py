import test_multi_operator_host as fixtures
from contest_host.host import Host, HostError
import unittest
uid=fixtures.uid


class GroupCoordinationTests(unittest.TestCase):
    setUp=fixtures.MultiOperatorHostTests.setUp
    tearDown=fixtures.MultiOperatorHostTests.tearDown
    call=fixtures.MultiOperatorHostTests.call
    # Reuse the real authority fixture; inherited authority/replica regressions
    # remain in their original suite and are not duplicated here.
    def presence(self, station, boot, sequence):
        return self.call("multi_coordination",requestID=uid(),senderStation=station,action="presence",presence={
            "bootID":boot,"sequence":sequence,"operator":"OM0RX","role":"helper","band":"20m","mode":"CW","laneID":"laneB","cursor":1,"queue":0,"context":"cq_wpx_cw/test-cty-v1"})

    def test_directed_receipt_restart_and_retired_presence_cannot_edit_drafts(self):
        boot_a,boot_b=uid(),uid()
        self.presence("A",boot_a,1);self.presence("B",boot_b,1)
        original=self.call("projection")["projection"]
        request=uid()
        params=dict(requestID=request,senderStation="A",action="send",message={"target":"B","kind":"pass","body":"Review before loading","call":"K1ABC","frequencyHz":14025000,"mode":"CW","laneID":"laneB"})
        first=self.call("multi_coordination",**params)
        self.assertEqual(len(first["directed"]),1)
        self.assertTrue(self.call("multi_coordination",**params)["replayed"])
        with self.assertRaises(HostError):self.call("multi_coordination",requestID=uid(),senderStation="A",action="acknowledge",messageID=request)
        ack=self.call("multi_coordination",requestID=uid(),senderStation="B",action="acknowledge",messageID=request)
        self.assertIsNotNone(ack["directed"][0]["acknowledgedUTC"])
        self.assertEqual(self.call("projection")["projection"],original)
        self.host.close();self.host=Host(self.root)
        read=self.call("multi_coordination",requestID=uid(),senderStation="B",action="read")
        self.assertEqual(read["directed"],ack["directed"])
        with self.assertRaises(HostError):self.presence("B",boot_b,1)
        self.presence("B",uid(),0)
        with self.assertRaises(HostError):self.presence("B",boot_b,100)

    def test_unknown_target_workspace_and_payload_reuse_fail_closed(self):
        self.presence("A",uid(),1)
        with self.assertRaises(HostError):self.call("multi_coordination",requestID=uid(),senderStation="A",action="send",message={"target":"missing","kind":"helper","body":"x","call":"K1ABC","frequencyHz":0,"mode":"","laneID":"laneA"})
        with self.assertRaises(HostError):self.call("multi_coordination",requestID=uid(),senderStation="A",action="read",workspaceGeneration=uid())

    def complete_message(self, **changes):
        return {"target":"B","kind":"pass","body":"RX observation; TX split unknown","call":"K1ABC",
                "frequencyHz":14025000,"mode":"CW","laneID":"laneB","schema":2,"version":1,
                "sessionID":self.session,"workspaceGeneration":self.workspace,"frequencyMeaning":"rx",
                "observedUTC":"2026-11-03T14:00:00Z","source":"operator","supersedesID":None,**changes}

    def test_complete_pass_old_records_and_lifecycle_survive_restart_without_draft_effects(self):
        self.presence("A",uid(),1);self.presence("B",uid(),1)
        old=uid();new=uid()
        self.call("multi_coordination",requestID=old,senderStation="A",action="send",message={
            "target":"B","kind":"pass","body":"old","call":"K1ABC","frequencyHz":0,"mode":"","laneID":"laneA"})
        self.call("multi_coordination",requestID=new,senderStation="A",action="send",message=self.complete_message())
        original=self.call("projection")["projection"]
        operation=uid();captured={"draftID":original["draftID"],"laneID":"laneB","bindingVersion":4,"generation":"connection-2"}
        args={"senderStation":"B","action":"recipient_action","messageID":new,"messageVersion":1,
              "operationID":operation,"event":"tune_requested","context":captured,"detail":""}
        request=uid()
        pending=self.call("multi_coordination",requestID=request,**args)
        self.assertTrue(self.call("multi_coordination",requestID=request,**args)["replayed"])
        with self.assertRaises(HostError):self.call("multi_coordination",requestID=uid(),**args)
        self.call("multi_coordination",requestID=uid(),**{**args,"event":"uncertain","detail":"connection lost"})
        self.assertEqual(self.call("projection")["projection"],original)
        with self.assertRaises(HostError):self.call("multi_coordination",requestID=uid(),**{**args,"event":"tune_accepted"})
        self.host.close();self.host=Host(self.root)
        read=self.call("multi_coordination",requestID=uid(),senderStation="B",action="read")
        message=next(item for item in read["directed"] if item["id"]==new)
        self.assertEqual([item["event"] for item in message["recipientActions"]],["tune_requested","uncertain"])
        legacy=next(item for item in read["directed"] if item["id"]==old)
        self.assertNotIn("schema",legacy)
        self.assertEqual((legacy["frequencyHz"],legacy["mode"]),(0,""))
        with self.assertRaises(HostError):self.call("multi_coordination",requestID=uid(),**{**args,"messageID":old,"messageVersion":0})

    def test_complete_pass_invalid_context_recipient_supersession_and_decline(self):
        self.presence("A",uid(),1);self.presence("B",uid(),1)
        for change in ({"frequencyHz":0},{"frequencyHz":10120000},{"mode":""},{"frequencyMeaning":"tx"},
                       {"sessionID":uid()},{"workspaceGeneration":uid()},{"version":2},{"observedUTC":"2100-01-01T00:00:00Z"}):
            with self.subTest(change=change),self.assertRaises(HostError):
                self.call("multi_coordination",requestID=uid(),senderStation="A",action="send",message=self.complete_message(**change))
        first=uid();second=uid()
        self.call("multi_coordination",requestID=first,senderStation="A",action="send",message=self.complete_message())
        self.call("multi_coordination",requestID=second,senderStation="A",action="send",message=self.complete_message(supersedesID=first,frequencyHz=14026000))
        with self.assertRaises(HostError):self.call("multi_coordination",requestID=uid(),senderStation="B",action="decline",messageID=first,messageVersion=1)
        with self.assertRaises(HostError):self.call("multi_coordination",requestID=uid(),senderStation="A",action="decline",messageID=second,messageVersion=1)
        result=self.call("multi_coordination",requestID=uid(),senderStation="B",action="decline",messageID=second,messageVersion=1)
        self.assertTrue(next(item for item in result["directed"] if item["id"]==first)["superseded"])
        args={"senderStation":"B","action":"recipient_action","messageID":second,"messageVersion":1,
              "operationID":uid(),"event":"load_requested","context":{},"detail":""}
        with self.assertRaises(HostError):self.call("multi_coordination",requestID=uid(),**args)
