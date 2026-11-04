"""Generate native-boundary frames with the actual Host and default WPX macros.

Only disposable protocol data; the native test supplies its own owner/lease epoch.
No renderer suppression marker or synthetic exchange is added here.
"""
import json
import sys

from test_tlf_cw_host import TLFCWHostTests
from test_wave2_messages_host import uid


def main():
    case = TLFCWHostTests()
    case.setUp()
    try:
        case.native_owner = json.loads(sys.argv[1])
        case.mutate("run_state", run=True)
        frames = []
        stream = uid()
        for method, call in [("early_cw_start", "OM0"), ("early_cw_append", "OM0R"), ("early_cw_finish", "OM0RX")]:
            before = case.call("cw_context")
            result = case.early(method, stream, call)
            case.call("output_claim", {"operationID": result["operationID"], "revision": result["revision"]})
            case.call("cw_outcome", {"outputOperationID": result["operationID"], "outcome": "accepted",
                "acceptanceLevel": "native_queue", "providerID": "winkeyer", "generation": 7})
            frames.append({"operation": method.replace("early_cw_", "early_"), "before": before,
                           "after": case.call("cw_context"), "result": result})
        before = case.call("cw_context")
        params = {"operationID": uid(), "expectedRevision": before["revision"], "field": "callsign", "cwProviderContext": {"providerID": "winkeyer", "generation": 7},
                  "cwContinuationAdmission": case.continuation(result, generation=7)}
        result = case.call("esm", params)
        frames.append({"operation": "esm", "before": before, "after": case.call("cw_context"), "result": result,
                       "admission": params["cwContinuationAdmission"]})
        replay = case.call("esm", params)
        frames.append({"operation": "esm", "before": case.call("cw_context"), "after": case.call("cw_context"), "result": replay})
        assert result["projection"]["reservedSerial"] == 1 and case.call("log")["total"] == 0
        case.mutate("esm", field="other_2", fields={"callsign": "OM0RX", "other_2": "3"})
        logged = case.call("log")
        assert logged["total"] == 1 and logged["rows"][0]["SentNr"] == 1
        print(json.dumps({"frames": frames, "serialBeforeLog": 1, "qsoCountBeforeLog": 0,
                          "qsoCountAfterLog": logged["total"], "nextSerial": case.call("projection")["projection"]["reservedSerial"]}))
    finally:
        case.tearDown()


if __name__ == "__main__":
    main()
