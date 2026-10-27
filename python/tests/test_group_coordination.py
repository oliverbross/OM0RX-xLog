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
