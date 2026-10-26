import Foundation
import XCTest
@testable import XCWCore

final class CWClusterClientProtocolTests:XCTestCase {
    func testFragmentedLoginMixedNewlinesAndExplicitHistoryOnly() {
        var parser=CWClusterClientProtocol()
        XCTAssertEqual(parser.feed(Data("VK8".utf8)),[])
        let login=parser.feed(Data("RX\r".utf8))
        XCTAssertTrue(login.contains(.authenticated("VK8RX")))
        XCTAssertFalse(login.contains{if case .history=$0{return true};return false})
        XCTAssertEqual(parser.feed(Data("\nsh/d".utf8)),[])
        XCTAssertEqual(parser.feed(Data("x/12\nSH/DX 2\r\nsh/dx\n".utf8)),[.history(12),.history(2),.history(100)])
        XCTAssertEqual(parser.feed(Data("quit\n".utf8)),[.close("client_quit")])
        XCTAssertEqual(parser.feed(Data("SH/DX\n".utf8)),[])
    }
    func testFragmentedTelnetNegotiationDeclinesUnsupportedOptions() {
        var parser=CWClusterClientProtocol()
        XCTAssertEqual(parser.feed(Data([255])),[])
        XCTAssertEqual(parser.feed(Data([251])),[])
        XCTAssertEqual(parser.feed(Data([1,255,253,3])),[.send(Data([255,254,1])),.send(Data([255,252,3]))])
        XCTAssertEqual(parser.feed(Data([255,250,24,1,255])),[])
        let actions=parser.feed(Data([240]+Array("logger-1\r\n".utf8)))
        XCTAssertTrue(actions.contains(.authenticated("logger-1")))
        XCTAssertEqual(parser.clientName,"logger-1")
    }
    func testMalformedInputBudgetsAndBoundedSubnegotiation() {
        var long=CWClusterClientProtocol()
        XCTAssertTrue(long.feed(Data(repeating:65,count:513)).contains(.close("command_limit")))
        var sub=CWClusterClientProtocol()
        XCTAssertTrue(sub.feed(Data([255,250]+Array(repeating:1,count:257))).contains(.close("negotiation_limit")))
        var escaped=CWClusterClientProtocol()
        XCTAssertTrue(escaped.feed(Data([255,255,255,255,255,255])).contains(.close("protocol_limit")))
        var commands=CWClusterClientProtocol()
        _ = commands.feed(Data("logger\n".utf8))
        let replies=commands.feed(Data("sh/dx/101\nptt on\nrm -rf /\n".utf8))
        XCTAssertTrue(replies.contains(.close("protocol_limit")))
        XCTAssertFalse(replies.contains{if case .history=$0{return true};return false})
    }
    func testDiagnosticsCannotBecomeDXLinesAndInputIsCapped() {
        XCTAssertFalse(String(decoding:CWClusterClientProtocol.greeting,as:UTF8.self).hasPrefix("DX de"))
        var parser=CWClusterClientProtocol()
        let help=parser.feed(Data("help\n".utf8))
        for case .send(let bytes) in help {XCTAssertTrue(String(decoding:bytes,as:UTF8.self).hasPrefix("# "))}
        XCTAssertEqual(parser.feed(Data(repeating:65,count:4097)),[.close("input_limit")])
    }
}
