import Foundation
import Testing
@testable import XLogPrototypeSupport

@Suite("Radio spot admission before multi-radio fallback")
struct SpotDeliveryAdmissionTests {
    private actor Calls {
        var radioIDs: [String] = []
        func record(_ radioID: String) { radioIDs.append(radioID) }
        func values() -> [String] { radioIDs }
    }

    @Test("All prewire Direct Agent rejections produce typed no-admission evidence", arguments: [
        "invalid_params", "worker_stopping", "release_unconfirmed", "station_owner_conflict",
        "station_unavailable", "station_action_blocked",
    ])
    func allPrewire(code: String) async throws {
        let calls = Calls()
        do {
            _ = try await SpotDeliveryAdmission.addSpot(provider: "direct_agent") { radioID in
                await calls.record(radioID)
                throw WorkerFailure(code, "Private fixture rejection")
            }
            Issue.record("No-admission evidence was not returned")
        } catch let failure as ConfirmedSpotDeliveryNotAdmitted {
            #expect(failure.code == code)
            #expect(failure.message == "Private fixture rejection")
        }
        #expect(await calls.values() == ["radio1", "radio2"])
    }

    @Test("An uncertain first send prevents both later rejection and later acceptance", arguments: [false, true])
    func unknownFirstNeverAttemptsSecond(secondWouldAccept: Bool) async throws {
        let calls = Calls()
        do {
            _ = try await SpotDeliveryAdmission.addSpot(provider: "direct_agent") { radioID in
                await calls.record(radioID)
                if radioID == "radio1" { throw WorkerFailure("station_rejected", "Postwire result is unknown") }
                if secondWouldAccept { return true }
                throw WorkerFailure("station_unavailable", "Second radio was not connected")
            }
            Issue.record("Uncertain delivery unexpectedly returned acceptance")
        } catch let failure as WorkerFailure {
            #expect(failure.code == "station_rejected")
        }
        #expect(await calls.values() == ["radio1"])
    }

    @Test("Prewire rejection may fall back and returns the actual acknowledged radio")
    func prewireThenAcknowledged() async throws {
        let calls = Calls()
        let radioID = try await SpotDeliveryAdmission.addSpot(provider: "direct_agent") { radioID in
            await calls.record(radioID)
            if radioID == "radio1" { throw WorkerFailure("station_unavailable", "Disconnected before send") }
            return true
        }
        #expect(radioID == "radio2")
        #expect(await calls.values() == ["radio1", "radio2"])
    }

    @Test("A later uncertain send cannot inherit an earlier prewire rejection")
    func prewireThenUnknown() async throws {
        let calls = Calls()
        do {
            _ = try await SpotDeliveryAdmission.addSpot(provider: "direct_agent") { radioID in
                await calls.record(radioID)
                if radioID == "radio1" { throw WorkerFailure("station_unavailable", "Disconnected before send") }
                throw WorkerFailure("station_rejected", "Second radio outcome is unknown")
            }
            Issue.record("Uncertain second delivery unexpectedly returned acceptance")
        } catch let failure as WorkerFailure {
            #expect(failure.code == "station_rejected")
        }
        #expect(await calls.values() == ["radio1", "radio2"])
    }

    @Test("Preferred delivery never attempts another radio")
    func preferredRadio() async throws {
        let calls = Calls()
        let radioID = try await SpotDeliveryAdmission.addSpot(provider: "direct_agent", preferredRadioID: "radio2") { radioID in
            await calls.record(radioID)
            return true
        }
        #expect(radioID == "radio2")
        #expect(await calls.values() == ["radio2"])
    }

    @Test("Other providers cannot inherit Direct Agent no-admission evidence", arguments: ["direct_flex_lan", "xcat_loopback", "hamlib", "unknown"])
    func otherProviderRemainsUnknown(provider: String) async throws {
        let calls = Calls()
        do {
            _ = try await SpotDeliveryAdmission.addSpot(provider: provider) { radioID in
                await calls.record(radioID)
                throw WorkerFailure("station_unavailable", "Outcome is not classified for this provider")
            }
            Issue.record("Unclassified provider unexpectedly returned acceptance")
        } catch let failure as WorkerFailure {
            #expect(failure.code == "station_unavailable")
        }
        #expect(await calls.values() == ["radio1"])
    }

    @Test("TCI independently classified prewire failures produce typed evidence", arguments: ["invalid_params", "station_unavailable", "station_busy"])
    func tciPrewire(code: String) async throws {
        let calls = Calls()
        do {
            _ = try await SpotDeliveryAdmission.addSpot(provider: "direct_tci") { radioID in
                await calls.record(radioID)
                throw WorkerFailure(code, "TCI private prewire fixture")
            }
            Issue.record("TCI prewire failures were not classified")
        } catch let failure as ConfirmedSpotDeliveryNotAdmitted {
            #expect(failure.code == code)
        }
        #expect(await calls.values() == ["radio1", "radio2"])
    }

    @Test("A prewire TCI rejection retains safe fallback to an acknowledged second radio")
    func tciPrewireThenAcknowledged() async throws {
        let calls = Calls()
        let radioID = try await SpotDeliveryAdmission.addSpot(provider: "direct_tci") { radioID in
            await calls.record(radioID)
            if radioID == "radio1" { throw WorkerFailure("station_unavailable", "TCI is not ready before send") }
            return true
        }
        #expect(radioID == "radio2")
        #expect(await calls.values() == ["radio1", "radio2"])
    }

    @Test("TCI postwire, superseded and timeout outcomes stop fallback", arguments: ["station_superseded", "station_unknown", "station_timeout", "station_rejected"])
    func tciUnknownStopsFallback(code: String) async throws {
        let calls = Calls()
        do {
            _ = try await SpotDeliveryAdmission.addSpot(provider: "direct_tci") { radioID in
                await calls.record(radioID)
                if radioID == "radio1" { throw WorkerFailure(code, "TCI outcome is unknown") }
                return true
            }
            Issue.record("Uncertain TCI delivery unexpectedly succeeded")
        } catch let failure as WorkerFailure {
            #expect(failure.code == code)
        }
        #expect(await calls.values() == ["radio1"])
    }

    @Test("Missing positive acceptance remains uncertain and stops fallback")
    func missingAcceptanceRemainsUnknown() async throws {
        let calls = Calls()
        do {
            _ = try await SpotDeliveryAdmission.addSpot(provider: "direct_agent") { radioID in
                await calls.record(radioID)
                return false
            }
            Issue.record("Missing acceptance unexpectedly succeeded")
        } catch let failure as WorkerFailure {
            #expect(failure.code == "station_rejected")
        }
        #expect(await calls.values() == ["radio1"])
    }
}
