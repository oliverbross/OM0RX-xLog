import Foundation
import Testing
@testable import XLogCore

@Suite("Public opportunity feed parsing")
struct OpportunityFeedTests {
    @Test("Four public portable programmes retain only observed call, reference and bounded frequency")
    func portable() throws {
        let now = Date(timeIntervalSince1970: 1_760_000_000)
        let cases: [(String, String, String)] = [
            ("pota", "OM-0001", "OM0RX/P"),
            ("sota", "FL/VO-209", "F/HB9DIZ/P"),
            ("wwff", "OMFF-0123", "OM1ABC/P"),
            ("wwbota", "OM-CAS-1", "OM2ABC/P")]
        for (source, ref, call) in cases {
            let bytes = try JSONSerialization.data(withJSONObject: [["activator": call, "reference": ref,
                "frequency": "14074", "mode": "FT8", "name": "Observed name"]])
            let values = try OpportunityFeedParser.parse(bytes, source: source, observedAt: now)
            #expect(values.count == 1)
            #expect(values[0].callsign == call)
            #expect(values[0].reference == ref)
            #expect(values[0].frequencyHz == 14_074_000)
            #expect(values[0].sourceURL.hasPrefix("https://"))
        }
    }

    @Test("WWBOTA multi-reference spot keeps each real reference on one observed call")
    func wwbotaReferences() throws {
        let body = try JSONSerialization.data(withJSONObject: [["activator": "OM0RX/P", "frequency": "14074",
            "references": [["reference": "OM-CAS-1", "name": "First castle"], ["reference": "OM-CAS-2", "name": "Second castle"]]]])
        let values = try OpportunityFeedParser.parse(body, source: "wwbota", observedAt: Date())
        #expect(Set(values.map(\.reference)) == Set(["OM-CAS-1", "OM-CAS-2"]))
        #expect(values.allSatisfy { $0.callsign == "OM0RX/P" && $0.frequencyHz == 14_074_000 })
    }

    @Test("Huge finite and invalid frequencies cannot trap or become fake spots")
    func frequencyBoundary() throws {
        let valid = try JSONSerialization.data(withJSONObject: [
            ["activator": "OM0RX", "reference": "OM-0001", "frequencyHz": 100_000],
            ["activator": "OM0RX", "reference": "OM-0002", "frequencyHz": 1_000_000_000],
            ["activator": "OM0RX", "reference": "OM-0003", "frequencyHz": 1e100]])
        let values = try OpportunityFeedParser.parse(valid, source: "pota", observedAt: Date())
        #expect(Set(values.compactMap(\.frequencyHz)) == Set([100_000, 1_000_000_000]))
    }

    @Test("425DXN dates and classification come from publisher fields, schema drift fails closed")
    func calendar() throws {
        let body = Data(#"[{"from":"2026-10-01","to":"2026-10-20","cal":"DX1ABC: Island (EU-001)"},{"from":"2026-10-12","to":"2026-10-13","cal":"AM42SDC: special calls"}]"#.utf8)
        let values = try OpportunityFeedParser.parse(body, source: "425dxn", observedAt: Date())
        #expect(values.count == 2)
        #expect(values.map(\.kind).contains("dxpedition"))
        #expect(values.map(\.kind).contains("special_event"))
        #expect(values.allSatisfy { $0.frequencyHz == nil && $0.sourceURL.contains("425dxn.org") })
        let drift = Data(#"[{"cal":"DX1ABC","from":"2026-10-01"}]"#.utf8)
        #expect(throws: OpportunityFeedError.schemaChanged) { try OpportunityFeedParser.parse(drift, source: "425dxn", observedAt: Date()) }
    }

    @Test("ADXO labelled text retains exact announced aliases and UTC date range")
    func adxo() throws {
        let body = Data(#"""
        <html><body>
        <p>Oct 20 - Nov 2, 2026</p>
        <p>DXCC: Christmas Island</p>
        <p>Callsign: VK9X1 / VK9X2</p>
        <p>QSL: via M0OXO</p>
        <p>Source: NG3K</p>
        <p>Info: 160-6 metres</p>
        <p>Jan 1 - Jan 2, 2025</p><p>DXCC: Old</p><p>Callsign: OLD1A</p>
        </body></html>
        """#.utf8)
        let now = ISO8601DateFormatter().date(from: "2026-10-24T12:00:00Z")!
        let values = try OpportunityFeedParser.parse(body, source: "adxo", observedAt: now)
        #expect(values.count == 1)
        #expect(values[0].callsign == "VK9X1")
        #expect(values[0].callsigns == ["VK9X1", "VK9X2"])
        #expect(values[0].qslRoute == "via M0OXO")
        #expect(values[0].source == "NG3K ADXO")
        #expect(values[0].startsAt == ISO8601DateFormatter().date(from: "2026-10-20T00:00:00Z"))
        #expect(values[0].endsAt == ISO8601DateFormatter().date(from: "2026-11-02T23:59:59Z")?.addingTimeInterval(0.999))
    }

    @Test("ADXO valid catalogue outside the 30-day horizon is a healthy empty response")
    func adxoValidEmpty() throws {
        let body = Data(#"<p>Jan 1 - Jan 2, 2025</p><p>DXCC: Old</p><p>Callsign: OLD1A</p>"#.utf8)
        let now = ISO8601DateFormatter().date(from: "2026-10-24T12:00:00Z")!
        let values = try OpportunityFeedParser.parse(body, source: "adxo", observedAt: now)
        #expect(values.isEmpty)
    }
}
