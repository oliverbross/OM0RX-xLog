#if os(macOS)
import Foundation
import Network
import XCTest
@testable import XCatIntegrationCore
@testable import XLogPrototypeSupport

final class LiveSpotBridgeTests: XCTestCase {
    func testIngressBoundsTasksBeforeActorAndRejectsOversizedPayloads() {
        let gate = SpotIngressGate(limit: 2)
        XCTAssertFalse(gate.admit(bytes: 0))
        XCTAssertFalse(gate.admit(bytes: 16_385))
        XCTAssertTrue(gate.admit(bytes: 100))
        XCTAssertTrue(gate.admit(bytes: 16_384))
        for _ in 0..<1_000 { XCTAssertFalse(gate.admit(bytes: 100)) }
        XCTAssertEqual(gate.droppedCount, 1_002)
        gate.finish()
        XCTAssertTrue(gate.admit(bytes: 100))
        gate.finish(); gate.finish()
    }

    private func spot(priority: Int = 3, source: String = "RUMlogNG Logbook") throws -> FlexSpot {
        try FlexSpot(frequencyHz: 14_074_000, callsign: "K1ABC", mode: "FT8",
                     source: source, spotter: "OM0RX", comment: "test",
                     timestamp: Int64(Date().timeIntervalSince1970), lifetimeSeconds: 600,
                     priority: priority, colorHex: "#FF453A")
    }

    func testMatchingRemoteAgentAckIsRequired() throws {
        let expected = try spot()
        let accepted = Data(#"{"success":true,"result":{"accepted":true,"callsign":"K1ABC","frequency_hz":14074000}}"#.utf8)
        XCTAssertNoThrow(try RemoteAgentStateDecoder.spotCommandResponse(accepted, expected: expected))
        for response in [
            #"{"success":true}"#,
            #"{"success":true,"result":{"accepted":false,"callsign":"K1ABC","frequency_hz":14074000}}"#,
            #"{"success":true,"result":{"accepted":true,"callsign":"K2XYZ","frequency_hz":14074000}}"#,
            #"{"success":true,"result":{"accepted":true,"callsign":"K1ABC","frequency_hz":14075000}}"#,
            #"{"success":false,"result":{"accepted":true,"callsign":"K1ABC","frequency_hz":14074000}}"#
        ] {
            XCTAssertThrowsError(try RemoteAgentStateDecoder.spotCommandResponse(Data(response.utf8), expected: expected))
        }
    }

    func testSharedBrokerDeduplicatesAcrossFeedSourcesAndAllowsPriorityUpgrade() async throws {
        let counter = DeliveryCounter()
        let broker = SpotForwardBroker { _ in try await counter.record() }
        let first = try await broker.forward(spot(priority: 3))
        let duplicate = try await broker.forward(spot(priority: 3, source: "xLog xCluster"))
        let upgrade = try await broker.forward(spot(priority: 5, source: "xLog xCluster"))
        let count = await counter.value()
        XCTAssertTrue(first)
        XCTAssertFalse(duplicate)
        XCTAssertTrue(upgrade)
        XCTAssertEqual(count, 2)
    }

    func testContestClassificationCanRepaintAnAcceptedSpot() async throws {
        let recorder = ProviderRecorder()
        let broker = SpotForwardBroker { spot, _ in await recorder.record(spot.colorHex) }
        let multiplier = try spot(priority: 5)
        let dupe = try FlexSpot(frequencyHz: multiplier.frequencyHz, callsign: multiplier.callsign,
                                 mode: multiplier.mode, source: "xLog Contest", spotter: multiplier.spotter,
                                 comment: multiplier.comment, timestamp: multiplier.timestamp,
                                 lifetimeSeconds: multiplier.lifetimeSeconds, priority: 2,
                                 colorHex: "#AEB5B7")
        let first = try await broker.forward(multiplier, replacingExisting: true)
        let second = try await broker.forward(dupe, replacingExisting: true)
        let colors = await recorder.value()
        XCTAssertTrue(first)
        XCTAssertTrue(second)
        XCTAssertEqual(colors, ["#FF453A", "#AEB5B7"])
    }

    func testBrokerRoutesSameSpotIndependentlyToFlexAndTCI() async throws {
        let recorder = ProviderRecorder()
        let broker = SpotForwardBroker { _, provider in await recorder.record(provider) }
        let value = try spot()
        let flex = try await broker.forward(value, provider: "direct_agent")
        let tci = try await broker.forward(value, provider: "direct_tci")
        let providers = await recorder.value()
        XCTAssertTrue(flex)
        XCTAssertTrue(tci)
        XCTAssertEqual(providers, ["direct_agent", "direct_tci"])
    }

    func testRejectedDeliveryCanRetryWithoutFalseSuccess() async throws {
        let counter = DeliveryCounter(rejectFirst: true)
        let broker = SpotForwardBroker { _ in try await counter.record() }
        let value = try spot()
        do {
            _ = try await broker.forward(value)
            XCTFail("Rejected ACK must not count as accepted")
        } catch {}
        let retried = try await broker.forward(value)
        let count = await counter.value()
        XCTAssertTrue(retried)
        XCTAssertEqual(count, 2)
    }

    func testReplacementWaitsForPendingDeliveryAndCannotLoseTheNewClassification() async throws {
        let gate = GatedDelivery()
        let broker = SpotForwardBroker { _ in await gate.deliver() }
        let low = try spot(priority: 1)
        let high = try spot(priority: 5)
        let first = Task { try await broker.forward(low) }
        await gate.waitStarted()
        let pendingUpgrade = Task { try await broker.forward(high, replacingExisting: true) }
        try await Task.sleep(for: .milliseconds(20))
        let beforeRelease = await gate.value()
        XCTAssertEqual(beforeRelease, 1, "Replacement must wait behind the in-flight delivery")
        await gate.release()
        let firstAccepted = try await first.value
        let acceptedUpgrade = try await pendingUpgrade.value
        XCTAssertTrue(firstAccepted)
        let deliveredCount = await gate.value()
        XCTAssertTrue(acceptedUpgrade)
        XCTAssertEqual(deliveredCount, 2)
    }

    func testRemovalWaitsForPendingDeliveryAndUsesTheSameIdentity() async throws {
        let gate = GatedDelivery(), removed = ProviderRecorder()
        let broker = SpotForwardBroker(deliver: { _, _ in await gate.deliver() },
                                       remove: { spot, _ in await removed.record("\(spot.callsign)|\(spot.frequencyHz)") })
        let value = try spot()
        let first = Task { try await broker.forward(value) }
        await gate.waitStarted()
        let removal = Task { try await broker.remove(value) }
        try await Task.sleep(for: .milliseconds(20))
        let beforeRelease = await removed.value()
        XCTAssertTrue(beforeRelease.isEmpty)
        await gate.release()
        let forwarded = try await first.value
        let wasRemoved = try await removal.value
        let identities = await removed.value()
        XCTAssertTrue(forwarded)
        XCTAssertTrue(wasRemoved)
        XCTAssertEqual(identities, ["K1ABC|14074000"])
    }

    func testRepaintRemovesAndReaddsOnTheRadioThatAcceptedTheOriginalSpot() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-target-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let routing = TargetedSpotRouting(radio1Available: false)
        let broker = SpotForwardBroker(inventoryURL: directory.appendingPathComponent("spots.json"),
            targetedDeliver: { spot, provider, preferred in
                try await routing.add(spot: spot, provider: provider, preferred: preferred)
            }, targetedRemove: { spot, provider, radioID in
                try await routing.remove(spot: spot, provider: provider, radioID: radioID)
            })
        let original = try spot(priority: 5, source: "xLog Contest")
        let originalAccepted = try await broker.forward(original, replacingExisting: true)
        XCTAssertTrue(originalAccepted)
        await routing.setRadio1Available(true)
        let originalRemoved = try await broker.remove(original)
        XCTAssertTrue(originalRemoved)
        let grey = try FlexSpot(frequencyHz: original.frequencyHz, callsign: original.callsign, mode: original.mode,
                                source: "xLog Contest", spotter: original.spotter, comment: original.comment,
                                timestamp: original.timestamp, lifetimeSeconds: original.lifetimeSeconds,
                                priority: 1, colorHex: "#AEB5B7")
        let greyAccepted = try await broker.forward(grey, replacingExisting: true)
        XCTAssertTrue(greyAccepted)
        let repaintEvents = await routing.events()
        XCTAssertEqual(repaintEvents, [
            "add:direct_agent:radio2:K1ABC:14074000",
            "remove:direct_agent:radio2:K1ABC:14074000",
            "add:direct_agent:radio2:K1ABC:14074000",
        ])
    }

    func testContestTransitionWithdrawsOnlyPersistedNormalSpotsBeforePublishing() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-transition-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let inventoryURL = directory.appendingPathComponent("spots.json"), routing = TargetedSpotRouting(radio1Available: false)
        let normal = SpotForwardBroker(inventoryURL: inventoryURL, targetedDeliver: { spot, provider, preferred in
            try await routing.add(spot: spot, provider: provider, preferred: preferred)
        }, targetedRemove: { spot, provider, radioID in
            try await routing.remove(spot: spot, provider: provider, radioID: radioID)
        })
        let offBandCW = try spot(priority: 3, source: "xLog xCluster")
        let normalAccepted = try await normal.forward(offBandCW)
        XCTAssertTrue(normalAccepted)

        let contest = SpotForwardBroker(inventoryURL: inventoryURL, targetedDeliver: { spot, provider, preferred in
            try await routing.add(spot: spot, provider: provider, preferred: preferred)
        }, targetedRemove: { spot, provider, radioID in
            try await routing.remove(spot: spot, provider: provider, radioID: radioID)
        })
        let withdrawn = try await contest.withdrawNormalForwardedSpots()
        XCTAssertEqual(withdrawn, 1)
        await routing.setRadio1Available(true)
        let contestSpot = try FlexSpot(frequencyHz: 7_125_000, callsign: "DL1AAA", mode: "SSB",
                                       source: "xLog Contest", spotter: "W1AW", comment: "CQ TEST",
                                       timestamp: Int64(Date().timeIntervalSince1970), lifetimeSeconds: 600,
                                       priority: 5, colorHex: "#00E51B")
        let contestAccepted = try await contest.forward(contestSpot, replacingExisting: true)
        XCTAssertTrue(contestAccepted)
        let transitionEvents = await routing.events()
        XCTAssertEqual(transitionEvents, [
            "add:direct_agent:radio2:K1ABC:14074000",
            "remove:direct_agent:radio2:K1ABC:14074000",
            "add:direct_agent:radio1:DL1AAA:7125000",
        ])
    }

    func testReplacementContestWorkerRetriesPersistedContestWithdrawal() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-recovery-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let inventoryURL = directory.appendingPathComponent("spots.json")
        let routing = TargetedSpotRouting(radio1Available: false)
        func broker() -> SpotForwardBroker {
            SpotForwardBroker(inventoryURL: inventoryURL, targetedDeliver: { spot, provider, preferred in
                try await routing.add(spot: spot, provider: provider, preferred: preferred)
            }, targetedRemove: { spot, provider, radioID in
                try await routing.remove(spot: spot, provider: provider, radioID: radioID)
            })
        }
        let contestSpot = try spot(priority: 5, source: "xLog Contest")
        let forwarded = try await broker().forward(contestSpot, replacingExisting: true)
        XCTAssertTrue(forwarded)

        await routing.setRemovalAccepted(false)
        do {
            _ = try await broker().withdrawContestForwardedSpots()
            XCTFail("Rejected contest withdrawal must retain the durable inventory")
        } catch {}

        await routing.setRemovalAccepted(true)
        let withdrawn = try await broker().withdrawContestForwardedSpots()
        let events = await routing.events()
        XCTAssertEqual(withdrawn, 1)
        XCTAssertEqual(events, [
            "add:direct_agent:radio2:K1ABC:14074000",
            "remove:direct_agent:radio2:K1ABC:14074000",
            "remove:direct_agent:radio2:K1ABC:14074000",
        ])
    }

    func testReplacementContestWorkerRetiresExpiredReceiptsWithoutBlockingOnRadioRemoval() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-expired-recovery-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let inventoryURL = directory.appendingPathComponent("spots.json")
        let old = Date().timeIntervalSince1970 - 601
        let document = """
        {"version":1,"spots":[{"provider":"direct_agent","radioID":"radio1","callsign":"DL1AAA","frequencyHz":7125000,"owner":"contesting","acceptedAt":\(old)}]}
        """
        try Data(document.utf8).write(to: inventoryURL)
        let routing = TargetedSpotRouting(radio1Available: true)
        await routing.setRemovalAccepted(false)
        let broker = SpotForwardBroker(inventoryURL: inventoryURL, targetedDeliver: { spot, provider, preferred in
            try await routing.add(spot: spot, provider: provider, preferred: preferred)
        }, targetedRemove: { spot, provider, radioID in
            try await routing.remove(spot: spot, provider: provider, radioID: radioID)
        })

        let withdrawn = try await broker.withdrawContestForwardedSpots()
        XCTAssertEqual(withdrawn, 1)
        let events = await routing.events()
        XCTAssertEqual(events, [])
        let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: inventoryURL)) as? [String: Any]
        XCTAssertEqual((saved?["spots"] as? [[String: Any]])?.count, 0)
    }

    func testReplacementWorkerShutdownRetiresContestInventoryWithoutPublication() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-shutdown-recovery-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let inventoryURL = directory.appendingPathComponent("spots.json")
        let routing = TargetedSpotRouting(radio1Available: false)
        func broker() -> SpotForwardBroker {
            SpotForwardBroker(inventoryURL: inventoryURL, targetedDeliver: { spot, provider, preferred in
                try await routing.add(spot: spot, provider: provider, preferred: preferred)
            }, targetedRemove: { spot, provider, radioID in
                try await routing.remove(spot: spot, provider: provider, radioID: radioID)
            })
        }
        func replacementWorker() -> LiveClusterMethods {
            let durableInventory = broker()
            return LiveClusterMethods(
                logbook: LiveLogbookMethods(supportDirectory: directory, inheritNativePreferences: false),
                configurationURL: directory.appendingPathComponent("cluster.json"),
                retirePersistedContestSpots: {
                    _ = try await durableInventory.withdrawContestForwardedSpots()
                })
        }
        let contestSpot = try spot(priority: 5, source: "xLog Contest")
        let forwarded = try await broker().forward(contestSpot, replacingExisting: true)
        XCTAssertTrue(forwarded)

        await routing.setRemovalAccepted(false)
        let failedRetirement = await replacementWorker().terminate()
        XCTAssertFalse(failedRetirement)

        await routing.setRemovalAccepted(true)
        let recoveredRetirement = await replacementWorker().terminate()
        let events = await routing.events()
        XCTAssertTrue(recoveredRetirement)
        XCTAssertEqual(events, [
            "add:direct_agent:radio2:K1ABC:14074000",
            "remove:direct_agent:radio2:K1ABC:14074000",
            "remove:direct_agent:radio2:K1ABC:14074000",
        ])
    }

    func testAcceptedDedupeCacheIsBoundedUnderManyDistinctSpots() async throws {
        let broker = SpotForwardBroker { _ in }
        let original = try spot()
        for index in 0..<4_200 {
            let unique = try FlexSpot(frequencyHz: original.frequencyHz,
                                      callsign: "K\(index)ABC", mode: original.mode,
                                      source: original.source, spotter: original.spotter,
                                      comment: original.comment, timestamp: original.timestamp,
                                      lifetimeSeconds: original.lifetimeSeconds,
                                      priority: original.priority, colorHex: original.colorHex)
            _ = try await broker.forward(unique)
        }
        let size = await broker.cacheSizeForTesting()
        XCTAssertLessThanOrEqual(size, 4_096)
    }

    func testNativeParserPreservesCategoryStyleAndSourceIdentity() throws {
        let xml = Data("<spot><dxcall>K1ABC</dxcall><frequency>14074</frequency><mode>FT8</mode><dxccnotcfd>1</dxccnotcfd><spottercall>OM0RX</spottercall></spot>".utf8)
        let parsed = try RUMlogSpotParser.parse(xml, feed: .logbook)
        XCTAssertEqual(parsed.category, .dxccNotConfirmed)
        let converted = try parsed.flexSpot(feed: .logbook,
                                            style: SpotBridgeConfiguration.defaultStyles[.dxccNotConfirmed]!)
        XCTAssertEqual(converted.source, "RUMlogNG Logbook")
        XCTAssertEqual(converted.priority, 5)
        XCTAssertEqual(converted.colorHex, "#FF453A")
        XCTAssertEqual(converted.frequencyHz, 14_074_000)
    }

    func testParserRejectsHugeFiniteFrequencyWithoutIntegerTrap() throws {
        func xml(_ frequency: String) -> Data {
            Data("<spot><dxcall>K1ABC</dxcall><frequency>\(frequency)</frequency></spot>".utf8)
        }
        for invalid in ["1e100", "60000001", "99.999", "NaN", "Infinity"] {
            XCTAssertThrowsError(try RUMlogSpotParser.parse(xml(invalid), feed: .logbook), invalid)
        }
        XCTAssertEqual(try RUMlogSpotParser.parse(xml("14074.25"), feed: .logbook).frequencyHz, 14_074_250)
        XCTAssertEqual(try RUMlogSpotParser.parse(xml("100"), feed: .logbook).frequencyHz, 100_000)
        XCTAssertEqual(try RUMlogSpotParser.parse(xml("60000000"), feed: .logbook).frequencyHz, 60_000_000)
    }

    func testOptInDualPortLifecycleWithoutOpeningSockets() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let delivered = DeliveryCounter()
        let broker = SpotForwardBroker { _ in try await delivered.record() }
        let logbook = FakeSpotReceiver()
        let contest = FakeSpotReceiver()
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    broker: broker, workspaceAvailable: { true },
                                    receiverFactory: { feed, data, event in
                                        let receiver = feed == .logbook ? logbook : contest
                                        receiver.onData = data
                                        receiver.onEvent = event
                                        return receiver
                                    })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        XCTAssertEqual(initial["running"] as? Bool, false)
        let initialConfig = initial["configuration"] as? [String: Any]
        XCTAssertEqual(initialConfig?["enabled"] as? Bool, false)
        var enabled = initialConfig!
        enabled["enabled"] = true
        _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": enabled])
        XCTAssertNil(logbook.port)
        let started = try await bridge.handle(method: "spot_bridge_start", params: [:])
        XCTAssertEqual(started["running"] as? Bool, true)
        XCTAssertEqual(logbook.port, 12_062)
        XCTAssertEqual(contest.port, 12_063)
        let xml = Data("<spot><dxcall>K1ABC</dxcall><frequency>14074</frequency><mode>FT8</mode><newmulti>1</newmulti></spot>".utf8)
        await bridge.ingest(xml, feed: .contest)
        let forwarded = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        XCTAssertEqual(forwarded["accepted_count"] as? Int, 1)
        let deliveredCount = await delivered.value()
        XCTAssertEqual(deliveredCount, 1)
        let stopped = try await bridge.handle(method: "spot_bridge_stop", params: [:])
        XCTAssertEqual(stopped["running"] as? Bool, false)
        XCTAssertEqual((stopped["configuration"] as? [String: Any])?["enabled"] as? Bool, false)
        XCTAssertEqual(logbook.stopCount, 1)
        XCTAssertEqual(contest.stopCount, 1)
    }

    func testStoppedReceiverCallbackCannotForwardIntoRestartedGeneration() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let delivered = DeliveryCounter()
        let broker = SpotForwardBroker { _ in try await delivered.record() }
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    broker: broker, workspaceAvailable: { true },
                                    receiverFactory: { _, data, event in
                                        let receiver = FakeSpotReceiver()
                                        receiver.onData = data
                                        receiver.onEvent = event
                                        StaleReceiverStore.shared.append(receiver)
                                        return receiver
                                    })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        var enabled = initial["configuration"] as! [String: Any]
        enabled["enabled"] = true
        _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": enabled])
        _ = try await bridge.handle(method: "spot_bridge_start", params: [:])
        let old = StaleReceiverStore.shared.first!
        _ = try await bridge.handle(method: "spot_bridge_stop", params: [:])
        _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": enabled])
        _ = try await bridge.handle(method: "spot_bridge_start", params: [:])
        let xml = Data("<spot><dxcall>K1ABC</dxcall><frequency>14074</frequency><mode>FT8</mode></spot>".utf8)
        old.onData?(xml)
        old.onEvent?("UDP listener failed: stale")
        try await Task.sleep(for: .milliseconds(50))
        let snapshot = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        let count = await delivered.value()
        XCTAssertEqual(count, 0)
        XCTAssertEqual(snapshot["running"] as? Bool, true)
        await bridge.stopForShutdown()
        StaleReceiverStore.shared.clear()
    }

    func testPartialBindFailureStopsBothInjectedReceivers() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let logbook = FakeSpotReceiver()
        let contest = FakeSpotReceiver(failStart: true)
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    workspaceAvailable: { true },
                                    receiverFactory: { feed, _, _ in feed == .logbook ? logbook : contest })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        var enabled = initial["configuration"] as! [String: Any]
        enabled["enabled"] = true
        _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": enabled])
        do {
            _ = try await bridge.handle(method: "spot_bridge_start", params: [:])
            XCTFail("A failed contest bind must roll back the logbook listener")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "spot_bridge_bind_failed")
        }
        XCTAssertEqual(logbook.stopCount, 1)
        XCTAssertEqual(contest.stopCount, 1)
        let snapshot = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        XCTAssertEqual(snapshot["running"] as? Bool, false)
    }

    func testConfigurationRejectsUnknownStyleAndPortCollisionWithoutBinding() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    workspaceAvailable: { true },
                                    receiverFactory: { _, _, _ in FakeSpotReceiver() })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        var config = initial["configuration"] as! [String: Any]
        config["contestPort"] = 12_062
        do {
            _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": config])
            XCTFail("Equal ports must be rejected")
        } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
        config["contestPort"] = 12_063
        var styles = config["styles"] as! [String: Any]
        styles["unrecognizedStyle"] = ["priority": 5, "colorHex": "#FF453A", "lifetimeSeconds": 600]
        config["styles"] = styles
        do {
            _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": config])
            XCTFail("Unknown category must be rejected")
        } catch let failure as WorkerFailure { XCTAssertEqual(failure.code, "invalid_params") }
    }

    func testActualLoopbackPortCollisionAndDualPortRollback() async throws {
        let temporary = try loopbackEphemeralListener()
        let freePort = temporary.port
        temporary.listener.cancel()
        let blocked = try loopbackEphemeralListener()
        defer { blocked.listener.cancel() }
        XCTAssertNotEqual(freePort, blocked.port)

        let collisionProbe = UDPSpotReceiver(label: "xlog.spot.collision", onDatagram: { _ in })
        XCTAssertThrowsError(try collisionProbe.start(port: blocked.port))
        collisionProbe.stop()

        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    workspaceAvailable: { true })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        var config = initial["configuration"] as! [String: Any]
        config["enabled"] = true
        config["logbookPort"] = Int(freePort)
        config["contestPort"] = Int(blocked.port)
        _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": config])
        do {
            _ = try await bridge.handle(method: "spot_bridge_start", params: [:])
            XCTFail("Occupied contest port must reject the pair")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "spot_bridge_bind_failed")
        }
        let snapshot = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        XCTAssertEqual(snapshot["running"] as? Bool, false)
        let releasedProbe = UDPSpotReceiver(label: "xlog.spot.rollback", onDatagram: { _ in })
        try releasedProbe.start(port: freePort)
        releasedProbe.stop()
    }

    func testDTORejectsBooleanAndFractionalNumbers() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-spot-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let bridge = LiveSpotBridge(configurationURL: directory.appendingPathComponent("spot-bridge.json"),
                                    workspaceAvailable: { true },
                                    receiverFactory: { _, _, _ in FakeSpotReceiver() })
        let initial = try await bridge.handle(method: "spot_bridge_snapshot", params: [:])
        let valid = initial["configuration"] as! [String: Any]
        var bad = valid
        bad["enabled"] = 1
        await assertBadConfiguration(bad, bridge: bridge)
        bad = valid
        bad["logbookPort"] = true
        await assertBadConfiguration(bad, bridge: bridge)
        bad = valid
        bad["contestPort"] = 12_063.5
        await assertBadConfiguration(bad, bridge: bridge)
        bad = valid
        var styles = bad["styles"] as! [String: Any]
        var first = styles["newMultiplier"] as! [String: Any]
        first["priority"] = true
        styles["newMultiplier"] = first
        bad["styles"] = styles
        await assertBadConfiguration(bad, bridge: bridge)
    }

    private func assertBadConfiguration(_ configuration: [String: Any], bridge: LiveSpotBridge) async {
        do {
            _ = try await bridge.handle(method: "spot_bridge_configure", params: ["configuration": configuration])
            XCTFail("Invalid numeric configuration was accepted")
        } catch let failure as WorkerFailure {
            XCTAssertEqual(failure.code, "invalid_params")
        } catch {
            XCTFail("Unexpected configuration error: \(error)")
        }
    }

    private func loopbackEphemeralListener() throws -> (listener: NWListener, port: UInt16) {
        let parameters = NWParameters.udp
        parameters.allowLocalEndpointReuse = false
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        let ready = DispatchSemaphore(value: 0)
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready, .failed: ready.signal()
            default: break
            }
        }
        listener.newConnectionHandler = { $0.cancel() }
        listener.start(queue: DispatchQueue(label: "xlog.spot.ephemeral"))
        guard ready.wait(timeout: .now() + 3) == .success,
              let port = listener.port?.rawValue, port >= 1_024 else {
            listener.cancel()
            throw NSError(domain: "loopback-port", code: 1)
        }
        return (listener, port)
    }
}

private actor DeliveryCounter {
    private var count = 0
    private let rejectFirst: Bool
    init(rejectFirst: Bool = false) { self.rejectFirst = rejectFirst }
    func record() throws {
        count += 1
        if rejectFirst && count == 1 { throw NSError(domain: "test", code: 1) }
    }
    func value() -> Int { count }
}

private actor ProviderRecorder {
    private var providers: [String] = []
    func record(_ provider: String) { providers.append(provider) }
    func value() -> [String] { providers }
}

private actor GatedDelivery {
    private var count = 0
    private var firstContinuation: CheckedContinuation<Void, Never>?
    private var startedContinuation: CheckedContinuation<Void, Never>?
    func deliver() async {
        count += 1
        if count == 1 {
            startedContinuation?.resume()
            startedContinuation = nil
            await withCheckedContinuation { firstContinuation = $0 }
        }
    }
    func waitStarted() async {
        if count > 0 { return }
        await withCheckedContinuation { startedContinuation = $0 }
    }
    func release() { firstContinuation?.resume(); firstContinuation = nil }
    func value() -> Int { count }
}

private actor TargetedSpotRouting {
    private var radio1Available: Bool
    private var removalAccepted = true
    private var recorded: [String] = []
    init(radio1Available: Bool) { self.radio1Available = radio1Available }
    func setRadio1Available(_ available: Bool) { radio1Available = available }
    func setRemovalAccepted(_ accepted: Bool) { removalAccepted = accepted }
    func add(spot: FlexSpot, provider: String, preferred: String?) throws -> String {
        let radioID: String
        if let preferred {
            radioID = preferred
        } else {
            radioID = radio1Available ? "radio1" : "radio2"
        }
        recorded.append("add:\(provider):\(radioID):\(spot.callsign):\(spot.frequencyHz)")
        return radioID
    }
    func remove(spot: FlexSpot, provider: String, radioID: String?) throws {
        guard let radioID else { throw NSError(domain: "missing-radio", code: 1) }
        recorded.append("remove:\(provider):\(radioID):\(spot.callsign):\(spot.frequencyHz)")
        if !removalAccepted { throw NSError(domain: "rejected-removal", code: 1) }
    }
    func events() -> [String] { recorded }
}

private final class FakeSpotReceiver: SpotDatagramReceiving, @unchecked Sendable {
    let failStart: Bool
    private(set) var port: UInt16?
    private(set) var stopCount = 0
    var onData: (@Sendable (Data) -> Void)?
    var onEvent: (@Sendable (String) -> Void)?
    init(failStart: Bool = false) { self.failStart = failStart }
    func start(port: UInt16) throws {
        if failStart { throw NSError(domain: "bind", code: 1) }
        self.port = port
    }
    func stop() { stopCount += 1; port = nil }
}

private final class StaleReceiverStore: @unchecked Sendable {
    static let shared = StaleReceiverStore()
    private let lock = NSLock()
    private var receivers: [FakeSpotReceiver] = []
    var first: FakeSpotReceiver? { lock.withLock { receivers.first } }
    func append(_ receiver: FakeSpotReceiver) { lock.withLock { receivers.append(receiver) } }
    func clear() { lock.withLock { receivers.removeAll() } }
}
#endif
