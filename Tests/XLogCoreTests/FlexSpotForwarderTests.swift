import Foundation
import Testing
@testable import XLogCore

@Suite("FLEX spot forwarding")
struct FlexSpotForwarderTests {
    @Test func buildsRUMlogCompatibleEscapedXML() {
        let spot = ClusterSpot(
            id: UUID(), receivedAt: Date(timeIntervalSince1970: 1_700_000_000),
            callsign: "vk8nsb", frequencyKHz: 7_175, band: "40m", mode: "SSB",
            country: "Australia", continent: "OC", latitude: nil, longitude: nil,
            comment: "POTA & SOTA <test>", callStatus: "New Callsign", dxccStatus: "Worked",
            specialTags: ["POTA"], score: 42, source: "DX Summit",
            statusHex: "#2F8FFF", bandHex: "#4A9CFF", modeHex: "#F3B23C"
        )
        let xml = String(decoding: FlexSpotForwarder.rumlogXML(for: spot), as: UTF8.self)
        #expect(xml.contains("<dxcall>VK8NSB</dxcall>"))
        #expect(xml.contains("<frequency>7175.000</frequency>"))
        #expect(xml.contains("POTA &amp; SOTA &lt;test&gt;"))
        #expect(xml.contains("<bandNotCfd>1</bandNotCfd>"))
        #expect(xml.contains("<dxccNotCfd>1</dxccNotCfd>"))
    }
}
