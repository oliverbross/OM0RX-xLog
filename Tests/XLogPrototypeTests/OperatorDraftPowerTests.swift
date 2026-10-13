import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

@Suite("Canonical portable operator draft power")
struct OperatorDraftPowerTests {
    private let workspace = UUID()
    private let draft = UUID()
    private let session = UUID()
    private let time = Date(timeIntervalSince1970: 1_800_000_000)
    private func qso() -> QSO {
        QSO(id: draft, call: "K1ABC", band: "20m", mode: "CW", frequencyHz: 14_025_000,
            comment: "operator comment", notes: "operator notes", txPower: "100",
            extraFields: ["APP_OM0RXXLOG_POWER_SOURCE": "old", "OTHER": "keep"])
    }
    private func context(provider: String = "station-1", selection: String = "radio-1", sessionID: UUID? = nil) -> OperatorDraftPowerContext {
        OperatorDraftPowerContext(providerID: provider, selectionID: selection,
                                  sessionID: sessionID ?? session, sessionStartedAt: time)
    }
    private func sample(_ watts: Double, at offset: Double = 0.5, sessionID: UUID? = nil) throws -> OperatorDraftPowerSample {
        let date = time.addingTimeInterval(offset)
        return try #require(OperatorDraftPowerSample(watts: watts, observedAt: date, radioObservedAt: date,
                                                     amplifierObservedAt: date, receivedAt: date, sessionID: sessionID ?? session))
    }
    private func armed() throws -> (OperatorDraftPowerState, UUID) {
        var state = try OperatorDraftPowerState(qso: qso(), workspaceID: workspace)
        try state.configure(enabled: true, fallback: "90")
        let armedScope = try state.arm(context: context(), qso: qso(), workspaceID: workspace, now: time)
        let scope = try #require(armedScope)
        return (state, scope)
    }

    @Test("Default OFF preserves existing draft value and same configuration is a no-op")
    func defaults() throws {
        var state = try OperatorDraftPowerState(qso: qso(), workspaceID: workspace)
        #expect(!state.enabled); #expect(!state.manualOverride); #expect(state.revision == 0)
        #expect(state.selectedValue == "100"); #expect(state.workspaceID == workspace)
        #expect(try state.arm(context: context(), qso: qso(), workspaceID: workspace, now: time) == nil)
        try state.configure(enabled: true, fallback: "90")
        #expect(state.selectedValue == "90")
        let armedScope = try state.arm(context: context(), qso: qso(), workspaceID: workspace, now: time)
        let scope = try #require(armedScope)
        let before = state
        try state.configure(enabled: true, fallback: "90")
        #expect(state == before)
        #expect(try state.arm(context: context(), qso: qso(), workspaceID: workspace, now: time.addingTimeInterval(0.1)) == scope)
        #expect(state == before)
    }

    @Test("Explicit same and empty manual values fence automatic capture until resume")
    func explicitManual() throws {
        var (state, scope) = try armed()
        try state.manual(value: state.selectedValue)
        #expect(state.manualOverride); #expect(state.activeScope == nil)
        #expect(try !state.accept(sample: sample(500), expectedScopeID: scope, now: time.addingTimeInterval(0.5)))
        try state.configure(enabled: false, fallback: "80")
        try state.configure(enabled: true, fallback: "70")
        #expect(state.selectedValue == "90")
        try state.manual(value: "")
        #expect(state.selectedValue.isEmpty); #expect(state.manualOverride)
        try state.resumeAutomatic()
        #expect(!state.manualOverride); #expect(state.selectedValue == "70")
        #expect(state.activeScope == nil)
    }

    @Test("Peak is exact meter evidence and save provenance follows its actual sample only")
    func peakAndProvenance() throws {
        var (state, scope) = try armed()
        let high = try sample(512.125)
        #expect(try state.accept(sample: high, expectedScopeID: scope, now: high.receivedAt))
        let low = try sample(300, at: 1)
        #expect(try state.accept(sample: low, expectedScopeID: scope, now: low.receivedAt))
        #expect(state.selectedSample == high); #expect(state.selectedValue == "512.125")
        let draft = state.applying(to: qso())
        #expect(draft.extraFields == ["OTHER": "keep"])
        let saved = state.applying(to: qso(), includeProvenance: true)
        #expect(saved.txPower == "512.125")
        #expect(saved.extraFields["APP_OM0RXXLOG_POWER_SOURCE"] == "kpa500_output")
        #expect(saved.extraFields["APP_OM0RXXLOG_POWER_OBSERVED_AT"] == "1800000000.5")
        #expect(saved.extraFields["APP_OM0RXXLOG_POWER_SESSION_ID"] == session.uuidString)
        #expect(saved.comment == qso().comment); #expect(saved.notes == qso().notes)
        try state.manual(value: "512.125")
        #expect(state.applying(to: qso(), includeProvenance: true).extraFields == ["OTHER": "keep"])
    }

    @Test("A to B to A retires old tokens and normalized spelling alone does not")
    func contactScopes() throws {
        var (state, first) = try armed()
        _ = try state.accept(sample: sample(600), expectedScopeID: first, now: time.addingTimeInterval(0.5))
        var normalized = qso(); normalized.call = " k1abc "; normalized.band = " 20M "; normalized.mode = " cw "
        _ = try state.reconcileReplacement(current: qso(), replacement: normalized, workspaceID: workspace)
        #expect(state.activeScope?.id == first)
        var other = normalized; other.call = "JA1ABC"
        _ = try state.reconcileReplacement(current: normalized, replacement: other, workspaceID: workspace)
        #expect(state.selectedValue == "90"); #expect(state.selectedSample == nil)
        _ = try state.reconcileReplacement(current: other, replacement: qso(), workspaceID: workspace)
        let armedScope = try state.arm(context: context(), qso: qso(), workspaceID: workspace, now: time.addingTimeInterval(1))
        let next = try #require(armedScope)
        #expect(next != first)
        #expect(try !state.accept(sample: sample(800, at: 1.1), expectedScopeID: first, now: time.addingTimeInterval(1.1)))
    }

    @Test("Band mode frequency workspace and draft identity each invalidate scope")
    func identityDimensions() throws {
        for dimension in 0..<5 {
            var (state, scope) = try armed()
            _ = try state.accept(sample: sample(500), expectedScopeID: scope, now: time.addingTimeInterval(0.5))
            var changed = qso(); var changedWorkspace = workspace
            switch dimension {
            case 0: changed.band = "40m"
            case 1: changed.mode = "SSB"
            case 2: changed.frequencyHz = 14_026_000
            case 3: changedWorkspace = UUID()
            default: changed.id = UUID()
            }
            _ = try state.arm(context: context(), qso: changed, workspaceID: changedWorkspace, now: time.addingTimeInterval(1))
            #expect(state.activeScope?.id != scope)
            #expect(state.selectedSample == nil); #expect(state.selectedValue == "90")
        }
    }

    @Test("Reconnect and restore retain selection but the first new session sample starts a new peak")
    func reconnect() throws {
        var (state, scope) = try armed()
        let old = try sample(700)
        _ = try state.accept(sample: old, expectedScopeID: scope, now: old.receivedAt)
        var restored = try JSONDecoder().decode(OperatorDraftPowerState.self, from: JSONEncoder().encode(state))
        #expect(restored == state)
        try restored.invalidateSession()
        #expect(restored.selectedValue == "700"); #expect(restored.selectedSample == old)
        #expect(restored.activeScope == nil)
        let session2 = UUID()
        let armedScope = try restored.arm(context: context(sessionID: session2), qso: qso(), workspaceID: workspace, now: time.addingTimeInterval(1))
        let next = try #require(armedScope)
        #expect(try !restored.accept(sample: sample(900, at: 1.1), expectedScopeID: scope, now: time.addingTimeInterval(1.1)))
        let fresh = try sample(200, at: 1.2, sessionID: session2)
        #expect(try restored.accept(sample: fresh, expectedScopeID: next, now: fresh.receivedAt))
        #expect(restored.selectedValue == "200"); #expect(restored.selectedSample == fresh)
    }

    @Test("Provider or selected radio change resets automatic evidence; manual survives until reset")
    func providerAndReset() throws {
        for newContext in [context(provider: "station-2"), context(selection: "radio-2")] {
            var (state, scope) = try armed()
            _ = try state.accept(sample: sample(500), expectedScopeID: scope, now: time.addingTimeInterval(0.5))
            _ = try state.arm(context: newContext, qso: qso(), workspaceID: workspace, now: time.addingTimeInterval(1))
            #expect(state.selectedValue == "90"); #expect(state.selectedSample == nil)
            try state.manual(value: "25")
            var nextDraft = qso(); nextDraft.call = "JA1ABC"
            _ = try state.reconcileReplacement(current: qso(), replacement: nextDraft, workspaceID: workspace)
            #expect(state.selectedValue == "25")
            nextDraft.id = UUID()
            try state.reset(qso: nextDraft, workspaceID: workspace)
            #expect(!state.manualOverride); #expect(state.selectedValue == "90"); #expect(state.activeScope == nil)
        }
    }

    @Test("Disabled capture retains selected evidence but retires eligibility")
    func disabled() throws {
        var (state, scope) = try armed()
        _ = try state.accept(sample: sample(500), expectedScopeID: scope, now: time.addingTimeInterval(0.5))
        try state.configure(enabled: false, fallback: "80")
        #expect(state.selectedValue == "500"); #expect(state.selectedSample != nil)
        #expect(state.activeScope == nil)
        let before = state
        #expect(try !state.accept(sample: sample(600, at: 1), expectedScopeID: scope, now: time.addingTimeInterval(1)))
        #expect(state == before)
    }

    @Test("Replacement cannot overwrite current captured value or manufacture manual intent")
    func staleReplacement() throws {
        var (state, scope) = try armed()
        _ = try state.accept(sample: sample(550), expectedScopeID: scope, now: time.addingTimeInterval(0.5))
        var stale = qso(); stale.txPower = "12"; stale.notes = "new note"
        let result = try state.reconcileReplacement(current: qso(), replacement: stale, workspaceID: workspace)
        #expect(result.txPower == "550"); #expect(result.notes == "new note")
        #expect(!state.manualOverride)
        try state.manual(value: "")
        #expect(try state.reconcileReplacement(current: result, replacement: stale, workspaceID: workspace).txPower == "")
    }

    @Test("Wrong scopes sessions old future duplicate and pre-arm readings are no-ops")
    func freshnessFences() throws {
        var (state, scope) = try armed()
        let candidate = try sample(500)
        let before = state
        #expect(try !state.accept(sample: candidate, expectedScopeID: UUID(), now: candidate.receivedAt))
        #expect(try !state.accept(sample: sample(500, sessionID: UUID()), expectedScopeID: scope, now: candidate.receivedAt))
        #expect(try !state.accept(sample: candidate, expectedScopeID: scope, now: time.addingTimeInterval(3)))
        #expect(try !state.accept(sample: candidate, expectedScopeID: scope, now: time))
        #expect(try !state.accept(sample: sample(500, at: -0.1), expectedScopeID: scope, now: time))
        #expect(state == before)
        _ = try state.accept(sample: candidate, expectedScopeID: scope, now: candidate.receivedAt)
        let accepted = state
        #expect(try !state.accept(sample: candidate, expectedScopeID: scope, now: candidate.receivedAt))
        #expect(try !state.accept(sample: sample(800, at: 0.4), expectedScopeID: scope, now: candidate.receivedAt))
        #expect(state == accepted)
    }

    @Test("Fresh meter evidence accepts a preceding amplifier envelope without renewing its age")
    func retainedAmplifierEnvelope() throws {
        var (state, scope) = try armed()
        let observed = time.addingTimeInterval(0.5)
        let preceding = time.addingTimeInterval(-14.5)
        let evidence = try #require(OperatorDraftPowerSample(watts: 500, observedAt: observed,
                                                            radioObservedAt: observed, amplifierObservedAt: preceding,
                                                            receivedAt: observed, sessionID: session))
        let before = state
        #expect(try !state.accept(sample: evidence, expectedScopeID: scope, now: observed.addingTimeInterval(0.01)))
        #expect(state == before)
        #expect(try state.accept(sample: evidence, expectedScopeID: scope, now: observed))
        try state.validate()
        let restored = try JSONDecoder().decode(OperatorDraftPowerState.self, from: JSONEncoder().encode(state))
        #expect(restored == state)
        #expect(state.applying(to: qso(), includeProvenance: true).extraFields["APP_OM0RXXLOG_POWER_AMPLIFIER_OBSERVED_AT"] == String(preceding.timeIntervalSince1970))
        var freshScope = before
        let preArmRadio = try #require(OperatorDraftPowerSample(watts: 500, observedAt: observed,
                                                               radioObservedAt: time.addingTimeInterval(-0.1),
                                                               amplifierObservedAt: preceding, receivedAt: observed,
                                                               sessionID: session))
        #expect(try !freshScope.accept(sample: preArmRadio, expectedScopeID: scope, now: observed))
    }

    @Test("DTO and persisted metadata reject non-meter units invalid values and unsupported contexts")
    func validation() throws {
        let date = time.addingTimeInterval(0.5)
        for watts in [0, -1, Double.infinity, Double.nan, 1_000.1] {
            #expect(OperatorDraftPowerSample(watts: watts, observedAt: date, radioObservedAt: date,
                                            amplifierObservedAt: date, receivedAt: date, sessionID: session) == nil)
        }
        #expect(OperatorDraftPowerSample(unit: "%", watts: 50, observedAt: date, radioObservedAt: date,
                                        amplifierObservedAt: date, receivedAt: date, sessionID: session) == nil)
        #expect(OperatorDraftPowerSample(source: "flex_drive", watts: 50, observedAt: date, radioObservedAt: date,
                                        amplifierObservedAt: date, receivedAt: date, sessionID: session) == nil)
        #expect(OperatorDraftPowerSample(watts: 50, observedAt: date, radioObservedAt: date,
                                        amplifierObservedAt: date.addingTimeInterval(-15.1), receivedAt: date, sessionID: session) == nil)
        #expect(OperatorDraftPowerSample(watts: 50, observedAt: date.addingTimeInterval(0.1), radioObservedAt: date,
                                        amplifierObservedAt: date, receivedAt: date, sessionID: session) == nil)
        #expect(OperatorDraftPowerSample(watts: 50, observedAt: Date(timeIntervalSince1970: .nan), radioObservedAt: date,
                                        amplifierObservedAt: date, receivedAt: date, sessionID: session) == nil)
        var (state, _) = try armed()
        #expect(throws: OperatorDraftPowerError.self) { try state.manual(value: String(repeating: "x", count: 65)) }
        #expect(throws: OperatorDraftPowerError.self) {
            try state.arm(context: OperatorDraftPowerContext(providerID: "s", selectionID: "r", sessionID: session,
                                                            sessionStartedAt: time, source: "legacy"),
                          qso: qso(), workspaceID: workspace, now: time)
        }
        var object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
        object["revision"] = -1
        #expect(throws: OperatorDraftPowerError.self) {
            try JSONDecoder().decode(OperatorDraftPowerState.self, from: JSONSerialization.data(withJSONObject: object))
        }
        object["revision"] = OperatorDraftPowerState.maximumRevision
        var exhausted = try JSONDecoder().decode(OperatorDraftPowerState.self, from: JSONSerialization.data(withJSONObject: object))
        #expect(throws: OperatorDraftPowerError.self) { try exhausted.manual(value: "10") }
        #expect(exhausted.revision == OperatorDraftPowerState.maximumRevision)
    }

    @Test("Positive fractional meter evidence survives formatting and corrupted sample metadata is rejected")
    func fractionalAndCorruptedMetadata() throws {
        var (state, scope) = try armed()
        let exact = try sample(0.0000001)
        _ = try state.accept(sample: exact, expectedScopeID: scope, now: exact.receivedAt)
        #expect(Double(state.selectedValue) == exact.watts)
        var object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any])
        var evidence = try #require(object["selectedSample"] as? [String: Any])
        evidence["unit"] = "%"; object["selectedSample"] = evidence
        #expect(throws: OperatorDraftPowerError.self) {
            try JSONDecoder().decode(OperatorDraftPowerState.self, from: JSONSerialization.data(withJSONObject: object))
        }
    }

    @Test("Automatic TX_PWR exports as exact positive decimal text including subnormal readings")
    func decimalADIFPower() throws {
        for watts in [Double.leastNonzeroMagnitude, Double.leastNormalMagnitude, 1e-100, 1e-7,
                      0.000001, 0.125, 512.125, 1_000] {
            var (state, scope) = try armed()
            let evidence = try sample(watts)
            _ = try state.accept(sample: evidence, expectedScopeID: scope, now: evidence.receivedAt)
            let text = state.selectedValue
            #expect(text.utf8.allSatisfy { (48...57).contains($0) || $0 == 46 })
            #expect(Double(text) == watts); #expect(Double(text)! > 0)
            #expect(text.utf8.count <= 343)
            try state.validate()
            let restored = try JSONDecoder().decode(OperatorDraftPowerState.self, from: JSONEncoder().encode(state))
            #expect(restored == state)
            let exported = state.applying(to: qso(), includeProvenance: true).adifRecord.adifDocument
            #expect(exported.contains("<TX_PWR:\(text.utf8.count)>\(text)"))
            #expect(ADIFParser().records(in: exported).first?["TX_PWR"] == text)
            #expect(state.applying(to: qso(), includeProvenance: true).extraFields["APP_OM0RXXLOG_POWER_WATTS"] == text)
            try state.manual(value: text)
            #expect(state.manualOverride); #expect(state.selectedValue == text)
            #expect(state.selectedSample == nil)
            try state.validate()
            #expect(try JSONDecoder().decode(OperatorDraftPowerState.self, from: JSONEncoder().encode(state)) == state)
        }
    }
}
