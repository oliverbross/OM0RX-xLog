import Foundation
import Testing
@testable import XLogPrototypeSupport

@Suite("Observed rotor motion")
struct RotorObservationTests {
    @Test func northCrossingAndArrival() {
        var rotor = RotorObservation()
        rotor.observe(359)
        rotor.request(5, label: "DX target")
        #expect(rotor.moving != true)
        rotor.observe(1)
        #expect(rotor.direction == "CW")
        #expect(rotor.moving == true)
        rotor.observe(4); rotor.observe(4); rotor.observe(4)
        #expect(rotor.moving == false)
        #expect(rotor.status.hasPrefix("At target"))
        #expect(rotor.target == 5)
        #expect(rotor.label == "DX target")
    }
    @Test func stoppedShortIsNotArrival() {
        var rotor = RotorObservation()
        let now = Date()
        rotor.observe(53, now: now)
        rotor.request(180, label: "Test", now: now)
        rotor.observe(53, now: now.addingTimeInterval(6))
        rotor.observe(53, now: now.addingTimeInterval(7))
        #expect(rotor.status.hasPrefix("Stopped short"))
        rotor.stopRequested()
        #expect(rotor.target == nil)
    }
    @Test func newTargetGetsFreshMotionGracePeriod() {
        var rotor = RotorObservation()
        let now = Date()
        rotor.observe(173, now: now)
        rotor.request(175, label: "First", now: now)
        rotor.observe(176, now: now.addingTimeInterval(1))
        rotor.observe(176, now: now.addingTimeInterval(2))
        rotor.observe(176, now: now.addingTimeInterval(3))
        rotor.request(173, label: "Return", now: now.addingTimeInterval(20))
        rotor.observe(176, now: now.addingTimeInterval(21))
        rotor.observe(176, now: now.addingTimeInterval(22))
        #expect(rotor.status == "Turn requested · waiting for motion")
        rotor.observe(172, now: now.addingTimeInterval(23))
        rotor.observe(172, now: now.addingTimeInterval(24))
        rotor.observe(172, now: now.addingTimeInterval(25))
        #expect(rotor.status.hasPrefix("At target"))
    }
}
