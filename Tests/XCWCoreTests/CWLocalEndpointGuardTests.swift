import Foundation
import XCTest
@testable import XCWCore
final class CWLocalEndpointGuardTests:XCTestCase {
    func testDefaultOffAddsNoResolutionAndAdmissionIsBidirectional() throws {
        let calls=CWResolutionCount(),guardOwner=CWLocalEndpointGuard(resolve:{calls.record();return $0=="local-alias"})
        let inbound=UUID(),listener=UUID(),instance=UUID()
        try guardOwner.setInbound(owner:inbound,endpoints:[.init(host:"local-alias",port:7300)])
        XCTAssertEqual(calls.value,0)
        XCTAssertThrowsError(try guardOwner.reserveListener(owner:listener,port:7300,instance:instance))
        try guardOwner.reserveListener(owner:listener,port:7301,instance:instance)
        XCTAssertThrowsError(try guardOwner.setInbound(owner:inbound,endpoints:[.init(host:"local-alias",port:7301)]))
        guardOwner.releaseListener(owner:listener)
        try guardOwner.setInbound(owner:inbound,endpoints:[.init(host:"external",port:7300)])
        try guardOwner.reserveListener(owner:listener,port:7300,instance:instance)
        XCTAssertTrue(guardOwner.isOwnGreeting("# OM0RX-xLog Local CW instance=\(instance)"))
        XCTAssertFalse(guardOwner.isOwnGreeting("# OM0RX-xLog Local CW instance=\(UUID())"))
        guardOwner.releaseListener(owner:listener)
        XCTAssertFalse(guardOwner.isOwnGreeting("# OM0RX-xLog Local CW instance=\(instance)"))
    }
    func testLocalAddressFormsAndNonLocalLiteral() {
        for host in ["localhost","LOCALHOST.","127.0.0.1","127.23.4.5","::1","[::1]","::ffff:127.0.0.1"] {
            XCTAssertTrue(CWLocalEndpointGuard.resolvesLocally(host),host)
        }
        XCTAssertFalse(CWLocalEndpointGuard.resolvesLocally("192.0.2.1"))
        XCTAssertFalse(CWLocalEndpointGuard.resolvesLocally("cluster.example.invalid"))
    }
}
private final class CWResolutionCount:@unchecked Sendable {
    private let lock=NSLock();private var count=0
    func record(){lock.lock();count+=1;lock.unlock()}
    var value:Int{lock.lock();defer{lock.unlock()};return count}
}
