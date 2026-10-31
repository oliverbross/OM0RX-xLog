import Foundation
import Testing
@testable import XLogPrototypeSupport

@Suite("Portable JSON object equality")
struct JSONStructuralEqualityTests {
    @Test("Native and decoded nested values compare independently of dictionary order")
    func roundTrip() throws {
        let native: [String: Any] = ["owner": ["revision": 9_007_199_254_740_990, "active": true],
            "values": [1, 1.25, false, "Žluťoučký\0", NSNull()] as [Any]]
        let decoded = try JSONSerialization.jsonObject(with: JSONSerialization.data(withJSONObject: native)) as! [String: Any]
        #expect(jsonObjectsEqual(native, decoded))
        #expect(jsonObjectsEqual(decoded, native))
        #expect(jsonObjectsEqual(["b": ["y": 2, "x": 1], "a": 0], ["a": 0, "b": ["x": 1, "y": 2]]))
        #expect(jsonObjectsEqual(["revision": 1], ["revision": 1.0]))
    }

    @Test("Boolean values cannot authorize a numeric revision")
    func booleanAndNumber() {
        #expect(!jsonObjectsEqual(["revision": true], ["revision": 1]))
        #expect(!jsonObjectsEqual(["revision": false], ["revision": 0]))
        #expect(!jsonObjectsEqual(["nested": ["enabled": true]], ["nested": ["enabled": 1]]))
    }

    @Test("Arrays, missing fields and changed context retain their meaning")
    func structuralDifferences() {
        #expect(!jsonObjectsEqual(["bands": ["20m", "40m"]], ["bands": ["40m", "20m"]]))
        #expect(!jsonObjectsEqual(["value": NSNull()], [:]))
        #expect(!jsonObjectsEqual(["context": "old"], ["context": "new"]))
        #expect(!jsonObjectsEqual(["revision": "1"], ["revision": 1]))
    }

    @Test("Unsupported and non-finite values fail closed on either side")
    func invalidObjects() {
        for value: Any in [Date(timeIntervalSince1970: 0), Double.nan, Double.infinity, -Double.infinity] {
            let invalid: [String: Any] = ["value": value]
            #expect(!jsonObjectsEqual(invalid, invalid))
            #expect(!jsonObjectsEqual(invalid, ["value": 0]))
            #expect(!jsonObjectsEqual(["value": 0], invalid))
        }
    }
}
