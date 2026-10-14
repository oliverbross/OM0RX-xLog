import Foundation
import Testing
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Synthetic audit fixtures only. No request can escape this URLProtocol.
@Suite("Sync identity join audit", .serialized)
struct SyncIdentityJoinAuditTests {
    @Test("Ambiguous confirmation siblings remain held without changing a linked contact", arguments: [false, true])
    func ambiguousConfirmationSnapshots(reverse: Bool) async throws {
        var stale = auditADIF(name: "First", dxcc: "291")
        stale.fields["EQSL_QSL_RCVD"] = "N"
        var fresh = stale
        fresh.fields.merge(["EQSL_QSL_RCVD": "Y", "EQSL_QSLRDATE": "20260626", "LOTW_QSL_RCVD": "Y",
                            "LOTW_QSLRDATE": "20260813", "QRZCOM_QSO_DOWNLOAD_STATUS": "Y",
                            "QRZCOM_QSO_DOWNLOAD_DATE": "20260627", "QRZCOM_QSO_UPLOAD_DATE": "20260626",
                            "COUNTRY": "Japan", "DISTANCE": "9028.7", "QSLMSG_RCVD": "Confirmed"]) { _, new in new }
        let rows = reverse ? [fresh, stale] : [stale, fresh]
        let json = [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "First")]
        let fixture = try customFixture(json: reverse ? json.reversed() : json, adif: rows)
        defer { fixture.session.invalidateAndCancel(); try? FileManager.default.removeItem(at: fixture.root) }
        let local = try #require(QSO(adif: stale, wavelogID: 12))
        try fixture.database.save(local, markDirty: false)
        let before = try #require(try fixture.database.lookup(localID: local.id))
        let report = try await SyncEngine(database: fixture.database, configuration: fixture.settings, session: fixture.session).synchronize()
        let after = try #require(try fixture.database.lookup(localID: local.id))
        #expect(report.held == 2 && report.pulled == 0 && report.pushed == 0 && report.conflicts == 0)
        #expect(after == before)
        #expect(try fixture.database.fetch(limit: 10).count == 1)
        #expect(try fixture.database.outboxEntries().isEmpty)
        #expect(IdentityJoinAuditProtocol.methods().allSatisfy { $0 == "GET" })
    }

    @Test("Dirty anchors and conflicting enrichment without an anchored value remain held", arguments: ["dirty", "country", "distance", "message", "unknown", "status", "date", "twoLinks", "noLink"])
    func unsafeConfirmationSnapshots(reason: String) async throws {
        var stale = auditADIF(name: "First", dxcc: "291")
        stale.fields["EQSL_QSL_RCVD"] = "N"
        var fresh = stale
        fresh.fields["EQSL_QSL_RCVD"] = "Y"
        if reason == "country" { stale.fields["COUNTRY"] = "Japan"; fresh.fields["COUNTRY"] = "Indonesia" }
        if reason == "distance" { stale.fields["DISTANCE"] = "100"; fresh.fields["DISTANCE"] = "200" }
        if reason == "message" { stale.fields["QSLMSG_RCVD"] = "First message"; fresh.fields["QSLMSG_RCVD"] = "Second message" }
        if reason == "unknown" { stale.fields["APP_TEST_FIELD"] = "old"; fresh.fields["APP_TEST_FIELD"] = "new" }
        if reason == "status" { fresh.fields["EQSL_QSL_RCVD"] = "I" }
        if reason == "date" { fresh.fields["EQSL_QSLRDATE"] = "20260230" }
        let fixture = try customFixture(json: [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "First")], adif: [stale, fresh])
        defer { fixture.session.invalidateAndCancel(); try? FileManager.default.removeItem(at: fixture.root) }
        var anchor = stale
        if reason == "country" { anchor.fields.removeValue(forKey: "COUNTRY") }
        if reason == "distance" { anchor.fields.removeValue(forKey: "DISTANCE") }
        if reason == "message" { anchor.fields.removeValue(forKey: "QSLMSG_RCVD") }
        let local = try #require(QSO(adif: anchor, wavelogID: reason == "noLink" ? nil : 12))
        try fixture.database.save(local, markDirty: reason == "dirty")
        if reason == "twoLinks" { try fixture.database.save(try #require(QSO(adif: stale, wavelogID: 11)), markDirty: false) }
        let before = try fixture.database.fetch(limit: 10)
        let outbox = try fixture.database.outboxEntries()
        let report = try await SyncEngine(database: fixture.database, configuration: fixture.settings, session: fixture.session).synchronize()
        #expect(report.held == 2 && report.pulled == 0 && report.pushed == 0 && report.conflicts == 0)
        #expect(try fixture.database.fetch(limit: 10) == before)
        #expect(try fixture.database.outboxEntries() == outbox)
        #expect(IdentityJoinAuditProtocol.methods().allSatisfy { $0 == "GET" })
    }

    @Test("Read-only preview validates complete history without a database or remote writes")
    func readOnlyPreview() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IdentityJoinAuditProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        IdentityJoinAuditProtocol.configure(reverseADIF: true, paginated: true)
        let settings = try WavelogConfiguration(baseURL: URL(string: "https://synthetic.invalid")!, token: "wl2_synthetic", stationID: 1)
        let preview = try await SyncEngine.previewRemoteHistory(configuration: settings, session: session)
        let contacts = preview.qsos
        #expect(preview.heldRemoteIDs.isEmpty)
        #expect(contacts.count == 2)
        #expect(Set(contacts.compactMap(\.wavelogID)) == [11, 12])
        #expect(IdentityJoinAuditProtocol.methods() == Array(repeating: "GET", count: 5))
    }

    @Test("Ancillary fields stay attached to their JSON remote ID regardless of export order and page boundaries", arguments: [false, true], [false, true])
    func remoteIDPreservesAncillaryFields(reverseADIF: Bool, paginated: Bool) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("synthetic.sqlite"))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IdentityJoinAuditProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        IdentityJoinAuditProtocol.configure(reverseADIF: reverseADIF, paginated: paginated)
        let settings = try WavelogConfiguration(
            baseURL: URL(string: "https://synthetic.invalid")!, token: "wl2_synthetic", stationID: 1
        )

        let report = try await SyncEngine(database: database, configuration: settings, session: session).synchronize()
        let contacts = try database.fetch(limit: 10)
        #expect(report.pulled == 2)
        #expect(report.failed == 0)
        #expect(contacts.count == 2)
        #expect(IdentityJoinAuditProtocol.methods() == Array(repeating: "GET", count: paginated ? 5 : 3))
        #expect(contacts.first(where: { $0.wavelogID == 11 })?.name == "First")
        #expect(contacts.first(where: { $0.wavelogID == 11 })?.comment == "first contact")
        #expect(contacts.first(where: { $0.wavelogID == 11 })?.dxcc == 291)
        #expect(contacts.first(where: { $0.wavelogID == 12 })?.name == "Second")
        #expect(contacts.first(where: { $0.wavelogID == 12 })?.comment == "second contact")
        #expect(contacts.first(where: { $0.wavelogID == 12 })?.dxcc == 504)
    }

    @Test("Truly identical full ADIF duplicates retain both IDs across page boundaries", arguments: [false, true])
    func identicalDuplicates(paginated: Bool) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("synthetic.sqlite"))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IdentityJoinAuditProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        IdentityJoinAuditProtocol.configure(reverseADIF: false, paginated: paginated, identicalADIF: true)
        let settings = try WavelogConfiguration(baseURL: URL(string: "https://synthetic.invalid")!, token: "wl2_synthetic", stationID: 1)
        let report = try await SyncEngine(database: database, configuration: settings, session: session).synchronize()
        let contacts = try database.fetch(limit: 10)
        #expect(report.pulled == 2)
        #expect(Set(contacts.compactMap(\.wavelogID)) == [11, 12])
        #expect(contacts.allSatisfy { $0.name == "First" && $0.comment == "first contact" && $0.dxcc == 291 })

        IdentityJoinAuditProtocol.configure(reverseADIF: true, paginated: paginated, identicalADIF: true)
        let second = try await SyncEngine(database: database, configuration: settings, session: session).synchronize()
        #expect(second.held == 0 && second.pulled == 2 && second.pushed == 0)
        var edited = try #require(try database.fetch(limit: 10).first(where: { $0.wavelogID == 11 }))
        edited.notes = "local edit"
        try database.save(edited)
        IdentityJoinAuditProtocol.configure(reverseADIF: false, paginated: paginated, identicalADIF: true)
        let third = try await SyncEngine(database: database, configuration: settings, session: session).synchronize()
        #expect(third.held == 0)
        #expect(third.pushed == 1)
        #expect(third.failed == 0)
    }

    @Test("ADIF-only differences hold their entire identity group without merging, deletion or pushing", arguments: [false, true])
    func ambiguousExportDoesNotWrite(paginated: Bool) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("synthetic.sqlite"))
        let retained = QSO(wavelogID: 11, call: "RETAIN", band: "40m", mode: "CW", isDirty: false)
        let pending = QSO(wavelogID: 12, call: "PENDING", band: "80m", mode: "CW")
        try database.save(retained, markDirty: false)
        try database.save(pending)
        let original = try database.fetch(limit: 10)
        let originalOutbox = try database.outboxEntries()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IdentityJoinAuditProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        IdentityJoinAuditProtocol.configure(reverseADIF: false, paginated: paginated, adifOnlyDifference: true)
        let settings = try WavelogConfiguration(baseURL: URL(string: "https://synthetic.invalid")!, token: "wl2_synthetic", stationID: 1)
        let report = try await SyncEngine(database: database, configuration: settings, session: session).synchronize()
        #expect(report.held == 2)
        #expect(report.pushed == 0 && report.pulled == 0 && report.deleted == 0 && report.failed == 0)
        #expect(try database.fetch(limit: 10) == original)
        #expect(try database.outboxEntries() == originalOutbox)
        #expect(try database.conflicts().isEmpty)
        #expect(IdentityJoinAuditProtocol.methods().allSatisfy { $0 == "GET" })
    }

    @Test("Ambiguous history does not block unrelated imports and uploads or create duplicate local contacts")
    func holdsOnlyAmbiguousContacts() async throws {
        var importedJSON = auditJSON(id: 13, name: "Incoming")
        importedJSON["call"] = "INCOMING"
        var importedADIF = auditADIF(name: "Incoming", dxcc: "291")
        importedADIF.fields["CALL"] = "INCOMING"
        let fixture = try customFixture(
            json: [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "First"), importedJSON],
            adif: [auditADIF(name: "First", dxcc: "291"), auditADIF(name: "First", dxcc: "504"), importedADIF]
        )
        defer { fixture.session.invalidateAndCancel(); try? FileManager.default.removeItem(at: fixture.root) }
        let unlinked = try #require(QSO(adif: auditADIF(name: "First", dxcc: "291")))
        try fixture.database.save(unlinked)
        let outgoing = QSO(call: "OUTGOING", band: "40m", mode: "CW")
        try fixture.database.save(outgoing)
        let report = try await SyncEngine(database: fixture.database, configuration: fixture.settings, session: fixture.session).synchronize()
        #expect(report.held == 2 && report.pulled == 1 && report.pushed == 1 && report.failed == 0)
        #expect(try fixture.database.lookup(localID: unlinked.id)?.wavelogID == nil)
        #expect(try fixture.database.lookup(localID: unlinked.id)?.isDirty == true)
        #expect(try fixture.database.lookup(localID: outgoing.id)?.wavelogID == 14)
        #expect(try fixture.database.fetch(limit: 10).contains { $0.call == "INCOMING" && $0.wavelogID == 13 })
        #expect(IdentityJoinAuditProtocol.methods() == ["GET", "GET", "GET", "POST"])
    }

    @Test("Held unlinked rows cannot be adopted by another remote frequency", arguments: [false, true])
    func protectsHeldRowsDuringMerge(dirty: Bool) async throws {
        var incomingJSON = auditJSON(id: 13, name: "Incoming")
        incomingJSON["freq"] = 14030000
        var incomingADIF = auditADIF(name: "Incoming", dxcc: "291")
        incomingADIF.fields["FREQ"] = "14.030000"
        let fixture = try customFixture(json: [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "First"), incomingJSON],
            adif: [auditADIF(name: "First", dxcc: "291"), auditADIF(name: "First", dxcc: "504"), incomingADIF])
        defer { fixture.session.invalidateAndCancel(); try? FileManager.default.removeItem(at: fixture.root) }
        let local = try #require(QSO(adif: auditADIF(name: "First", dxcc: "291")))
        try fixture.database.save(local, markDirty: dirty)
        let before = try fixture.database.lookup(localID: local.id)
        let report = try await SyncEngine(database: fixture.database, configuration: fixture.settings, session: fixture.session).synchronize()
        #expect(report.held == 2 && report.pulled == 1 && report.conflicts == 0 && report.pushed == 0)
        #expect(try fixture.database.lookup(localID: local.id) == before)
        #expect(try fixture.database.fetch(limit: 10).count == 2)
        #expect(try fixture.database.conflicts().isEmpty)
    }

    @Test("More than 500 held pending contacts cannot starve an unrelated upload")
    func heldPendingDoesNotStarve() async throws {
        let fixture = try customFixture(json: [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "First")],
            adif: [auditADIF(name: "First", dxcc: "291"), auditADIF(name: "First", dxcc: "504")])
        defer { fixture.session.invalidateAndCancel(); try? FileManager.default.removeItem(at: fixture.root) }
        for _ in 0..<501 {
            let local = try #require(QSO(adif: auditADIF(name: "First", dxcc: "291")))
            try fixture.database.save(local)
        }
        let outgoing = QSO(call: "OUTGOING", band: "40m", mode: "CW")
        try fixture.database.save(outgoing)
        let report = try await SyncEngine(database: fixture.database, configuration: fixture.settings, session: fixture.session).synchronize()
        #expect(report.pushed == 1 && report.failed == 0 && report.held == 2)
        #expect(try fixture.database.lookup(localID: outgoing.id)?.wavelogID == 14)
        #expect(try fixture.database.pendingSyncCount() == 501)
    }

    @Test("Semantic fallback searches past held rows for an unheld local candidate", arguments: [false, true])
    func semanticFallbackSkipsHeldCandidate(dirty: Bool) async throws {
        var incomingJSON = auditJSON(id: 13, name: "Incoming")
        incomingJSON["freq"] = 14030000
        var incomingADIF = auditADIF(name: "Incoming", dxcc: "291")
        incomingADIF.fields["FREQ"] = "14.030000"
        let fixture = try customFixture(json: [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "First"), incomingJSON],
            adif: [auditADIF(name: "First", dxcc: "291"), auditADIF(name: "First", dxcc: "504"), incomingADIF])
        defer { fixture.session.invalidateAndCancel(); try? FileManager.default.removeItem(at: fixture.root) }
        let held = try #require(QSO(adif: auditADIF(name: "First", dxcc: "291")))
        let unheld = try #require(QSO(adif: incomingADIF))
        try fixture.database.save(held, markDirty: false)
        try fixture.database.save(unheld, markDirty: dirty)
        let heldBefore = try fixture.database.lookup(localID: held.id)
        let report = try await SyncEngine(database: fixture.database, configuration: fixture.settings, session: fixture.session).synchronize()
        #expect(report.held == 2 && report.pulled == 1 && report.pushed == 0)
        #expect(try fixture.database.lookup(localID: held.id) == heldBefore)
        #expect(try fixture.database.fetch(limit: 10).count == 2)
        #expect(report.conflicts == (dirty ? 1 : 0))
        if !dirty { #expect(try fixture.database.lookup(localID: unheld.id)?.wavelogID == 13) }
        #expect(IdentityJoinAuditProtocol.methods().allSatisfy { $0 == "GET" })
    }

    @Test("Inconsistent duplicate groups still fail before any writes", arguments: [false, true])
    func inconsistentGroupsFailClosed(hallDeficient: Bool) async throws {
        if hallDeficient {
            try await assertCustomFailure(json: [auditJSON(id: 11, name: "A"), auditJSON(id: 12, name: "B"), auditJSON(id: 13, name: "B")],
                adif: [auditADIF(name: "A", dxcc: "291"), auditADIF(name: "A", dxcc: "504"), auditADIF(name: "B", dxcc: "291")])
        } else {
            try await assertCustomFailure(json: [auditJSON(id: 11, name: "C"), auditJSON(id: 12, name: "D")],
                adif: [auditADIF(name: "A", dxcc: "291"), auditADIF(name: "B", dxcc: "504")])
        }
    }

    @Test("Numeric common fields distinguish duplicates despite JSON and ADIF formatting differences")
    func numericDiscriminator() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try LogbookDatabase(url: root.appendingPathComponent("synthetic.sqlite"))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IdentityJoinAuditProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        IdentityJoinAuditProtocol.configure(reverseADIF: false, numericOnlyDifference: true)
        let settings = try WavelogConfiguration(baseURL: URL(string: "https://synthetic.invalid")!, token: "wl2_synthetic", stationID: 1)
        let report = try await SyncEngine(database: database, configuration: settings, session: session).synchronize()
        let contacts = try database.fetch(limit: 10)
        #expect(report.pulled == 2)
        #expect(contacts.first(where: { $0.wavelogID == 11 })?.dxcc == 291)
        #expect(contacts.first(where: { $0.wavelogID == 12 })?.dxcc == 504)
    }

    @Test("Identical residual duplicates remain separate after a distinct contact is resolved")
    func mixedDuplicates() async throws {
        let fixture = try customFixture(
            json: [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "First"), auditJSON(id: 13, name: "Second")],
            adif: [auditADIF(name: "First", dxcc: "291"), auditADIF(name: "Second", dxcc: "504"), auditADIF(name: "First", dxcc: "291")]
        )
        defer { fixture.session.invalidateAndCancel(); try? FileManager.default.removeItem(at: fixture.root) }
        let report = try await SyncEngine(database: fixture.database, configuration: fixture.settings, session: fixture.session).synchronize()
        let contacts = try fixture.database.fetch(limit: 10)
        #expect(report.pulled == 3)
        #expect(Set(contacts.compactMap(\.wavelogID)) == [11, 12, 13])
        #expect(contacts.first(where: { $0.wavelogID == 11 })?.dxcc == 291)
        #expect(contacts.first(where: { $0.wavelogID == 12 })?.dxcc == 291)
        #expect(contacts.first(where: { $0.wavelogID == 13 })?.dxcc == 504)
    }

    @Test("Invalid receive frequencies fail without trapping or writing", arguments: ["NaN", "Infinity", "1e300", "9223372036854775808"], [false, true])
    func invalidReceiveFrequency(value: String, invalidADIF: Bool) async throws {
        var json = [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "Second")]
        var adif = [auditADIF(name: "First", dxcc: "291"), auditADIF(name: "Second", dxcc: "504")]
        for index in json.indices {
            json[index]["freq_rx"] = invalidADIF ? "14025000" : value
            adif[index].fields["FREQ_RX"] = invalidADIF ? value : "14.025000"
        }
        try await assertCustomFailure(json: json, adif: adif)
    }

    @Test("Malformed ADIF transmit frequencies fail without trapping or writing", arguments: ["NaN", "Infinity", "1e300", "9223372036854.775808", "invalid", ""])
    func invalidTransmitFrequency(value: String) async throws {
        let json = [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "Second")]
        var adif = [auditADIF(name: "First", dxcc: "291"), auditADIF(name: "Second", dxcc: "504")]
        adif[0].fields["FREQ"] = value
        #expect(QSO(adif: adif[0]) == nil)
        try await assertCustomFailure(json: json, adif: adif)
    }

    @Test("ADIF contacts without a frequency remain readable")
    func missingTransmitFrequency() throws {
        var adif = auditADIF(name: "First", dxcc: "291")
        adif.fields.removeValue(forKey: "FREQ")
        let qso = try #require(QSO(adif: adif))
        #expect(qso.frequencyHz == nil)
        #expect(qso.band == "20m")
    }

    @Test("A declared/exported ADIF record count mismatch fails without writing")
    func recordCountMismatch() async throws {
        try await assertCustomFailure(
            json: [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "Second")],
            adif: [auditADIF(name: "First", dxcc: "291")], declaredADIFCount: 2
        )
    }

    @Test("Equal history totals with different identity-group counts fail without writing")
    func identityGroupCountMismatch() async throws {
        var other = auditADIF(name: "Second", dxcc: "504")
        other.fields["CALL"] = "OTHER"
        try await assertCustomFailure(
            json: [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "Second")],
            adif: [auditADIF(name: "First", dxcc: "291"), other]
        )
    }

    @Test("Receive frequency distinguishes duplicates with safely normalized units")
    func receiveFrequencyDiscriminator() async throws {
        var json = [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "First")]
        json[0]["freq_rx"] = "14025000.0"
        json[1]["freq_rx"] = "14030000"
        var adif = [auditADIF(name: "First", dxcc: "291"), auditADIF(name: "First", dxcc: "504")]
        adif[0].fields["FREQ_RX"] = "14.025000"
        adif[1].fields["FREQ_RX"] = "14.030"
        let fixture = try customFixture(json: json, adif: adif.reversed())
        defer { fixture.session.invalidateAndCancel(); try? FileManager.default.removeItem(at: fixture.root) }
        let report = try await SyncEngine(database: fixture.database, configuration: fixture.settings, session: fixture.session).synchronize()
        let contacts = try fixture.database.fetch(limit: 10)
        #expect(report.pulled == 2)
        #expect(contacts.first(where: { $0.wavelogID == 11 })?.dxcc == 291)
        #expect(contacts.first(where: { $0.wavelogID == 12 })?.dxcc == 504)
    }

    @Test("Positive receive frequency mismatches remain fail-closed", arguments: ["missing", "0", "14.030000"])
    func positiveReceiveFrequencyMismatch(exported: String) async throws {
        var json = [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "First")]
        var adif = [auditADIF(name: "First", dxcc: "291"), auditADIF(name: "First", dxcc: "291")]
        for index in json.indices {
            json[index]["freq_rx"] = "14025000"
            if exported != "missing" { adif[index].fields["FREQ_RX"] = exported }
        }
        try await assertCustomFailure(json: json, adif: adif)
    }

    @Test("Literal JSON zero and omitted ADIF receive frequency both mean unrecorded", arguments: ["0", "0.0", "0e-400"])
    func unrecordedReceiveFrequency(value: String) async throws {
        var json = [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "Second")]
        for index in json.indices { json[index]["freq_rx"] = value }
        let fixture = try customFixture(json: json, adif: [auditADIF(name: "Second", dxcc: "504"), auditADIF(name: "First", dxcc: "291")])
        defer { fixture.session.invalidateAndCancel(); try? FileManager.default.removeItem(at: fixture.root) }
        let report = try await SyncEngine(database: fixture.database, configuration: fixture.settings, session: fixture.session).synchronize()
        #expect(report.pulled == 2 && report.held == 0 && report.failed == 0)
        let contacts = try fixture.database.fetch(limit: 10)
        #expect(contacts.first(where: { $0.wavelogID == 11 })?.dxcc == 291)
        #expect(contacts.first(where: { $0.wavelogID == 12 })?.dxcc == 504)
        #expect(contacts.allSatisfy { $0.extraFields["FREQ_RX"] == nil })
        #expect(IdentityJoinAuditProtocol.methods().allSatisfy { $0 == "GET" })
    }

    @Test("Unrecorded RX normalization does not erase ambiguous ADIF-only details")
    func unrecordedRXStillHoldsAmbiguity() async throws {
        var json = [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "First")]
        for index in json.indices { json[index]["freq_rx"] = 0 }
        let fixture = try customFixture(json: json, adif: [auditADIF(name: "First", dxcc: "291"), auditADIF(name: "First", dxcc: "504")])
        defer { fixture.session.invalidateAndCancel(); try? FileManager.default.removeItem(at: fixture.root) }
        let report = try await SyncEngine(database: fixture.database, configuration: fixture.settings, session: fixture.session).synchronize()
        #expect(report.held == 2 && report.pulled == 0 && report.pushed == 0)
        #expect(try fixture.database.fetch(limit: 10).isEmpty)
        #expect(IdentityJoinAuditProtocol.methods().allSatisfy { $0 == "GET" })
    }

    @Test("Zero-to-transmit defaults and rounded/underflow-to-zero nonzero RX values remain fail-closed", arguments: ["0", "0.4", "-0.4", "1e-400", "-1e-400"])
    func unprovenReceiveFrequencyMismatch(value: String) async throws {
        var json = [auditJSON(id: 11, name: "First"), auditJSON(id: 12, name: "First")]
        var adif = [auditADIF(name: "First", dxcc: "291"), auditADIF(name: "First", dxcc: "291")]
        for index in json.indices {
            json[index]["freq_rx"] = value
            if value == "0" { adif[index].fields["FREQ_RX"] = "14.025000" }
        }
        try await assertCustomFailure(json: json, adif: adif)
    }

    private func assertCustomFailure(json: [[String: Any]], adif: [ADIFRecord], declaredADIFCount: Int? = nil) async throws {
        let fixture = try customFixture(json: json, adif: adif, declaredADIFCount: declaredADIFCount)
        defer { fixture.session.invalidateAndCancel(); try? FileManager.default.removeItem(at: fixture.root) }
        try fixture.database.save(QSO(wavelogID: 99, call: "RETAIN", band: "40m", mode: "CW", isDirty: false), markDirty: false)
        try fixture.database.save(QSO(call: "PENDING", band: "80m", mode: "CW"))
        let original = try fixture.database.fetch(limit: 10)
        let originalOutbox = try fixture.database.outboxEntries()
        var failedClosed = false
        do {
            _ = try await SyncEngine(database: fixture.database, configuration: fixture.settings, session: fixture.session).synchronize()
        } catch WavelogClientError.invalidData {
            failedClosed = true
        }
        #expect(failedClosed)
        #expect(try fixture.database.fetch(limit: 10) == original)
        #expect(try fixture.database.outboxEntries() == originalOutbox)
        #expect(try fixture.database.conflicts().isEmpty)
        #expect(IdentityJoinAuditProtocol.methods() == ["GET", "GET"])
    }

    private func customFixture(json: [[String: Any]], adif: [ADIFRecord], declaredADIFCount: Int? = nil) throws -> (root: URL, database: LogbookDatabase, session: URLSession, settings: WavelogConfiguration) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let database = try LogbookDatabase(url: root.appendingPathComponent("synthetic.sqlite"))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IdentityJoinAuditProtocol.self]
        let session = URLSession(configuration: configuration)
        let settings = try WavelogConfiguration(baseURL: URL(string: "https://synthetic.invalid")!, token: "wl2_synthetic", stationID: 1)
        let count = declaredADIFCount ?? adif.count
        let meta: [String: Any] = ["page": 1, "per_page": 1000, "count": json.count, "total": json.count, "total_pages": 1, "has_more": false]
        let adifMeta: [String: Any] = ["page": 1, "per_page": 1000, "count": count, "total": json.count, "total_pages": 1, "has_more": false]
        IdentityJoinAuditProtocol.configure(reverseADIF: false, responses: [
            "json": try JSONSerialization.data(withJSONObject: ["data": json, "meta": meta]),
            "adif": try JSONSerialization.data(withJSONObject: ["data": ["exported": count, "lastfetchedid": 13, "adif": "<EOH>" + adif.map { $0.adifDocument.components(separatedBy: "<EOH>").last! }.joined()], "meta": adifMeta]),
        ])
        return (root, database, session, settings)
    }
}

private func auditJSON(id: Int, name: String) -> [String: Any] {
    ["id": id, "station_id": 1, "call": "DUPE", "band": "20m", "mode": "CW", "freq": 14025000,
     "qso_date": "2023-11-14 22:13:20", "name": name]
}

private func auditADIF(name: String, dxcc: String) -> ADIFRecord {
    ADIFRecord(fields: ["CALL": "DUPE", "QSO_DATE": "20231114", "TIME_ON": "221320", "BAND": "20m",
                        "MODE": "CW", "FREQ": "14.025000", "NAME": name, "DXCC": dxcc])
}

private final class IdentityJoinAuditProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var reverseADIF = false
    private static var paginated = false
    private static var identicalADIF = false
    private static var adifOnlyDifference = false
    private static var numericOnlyDifference = false
    private static var recordedMethods: [String] = []
    private static var responses: [String: Data] = [:]

    static func configure(reverseADIF: Bool, paginated: Bool = false, identicalADIF: Bool = false, adifOnlyDifference: Bool = false, numericOnlyDifference: Bool = false, responses: [String: Data] = [:]) {
        lock.withLock {
            Self.reverseADIF = reverseADIF; Self.paginated = paginated
            Self.identicalADIF = identicalADIF; Self.adifOnlyDifference = adifOnlyDifference
            Self.numericOnlyDifference = numericOnlyDifference
            Self.responses = responses
            recordedMethods = []
        }
    }
    static func methods() -> [String] { lock.withLock { recordedMethods } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.withLock { Self.recordedMethods.append(request.httpMethod ?? "") }
        if request.httpMethod == "POST", request.url?.host == "synthetic.invalid" {
            let response = HTTPURLResponse(url: request.url!, statusCode: 201, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: ["data": auditJSON(id: 14, name: "Outgoing")]))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        if request.httpMethod == "PATCH", request.url?.host == "synthetic.invalid",
           let path = request.url?.lastPathComponent, let id = Int(path) {
            let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: ["data": auditJSON(id: id, name: "First")]))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        guard request.httpMethod == "GET", request.url?.host == "synthetic.invalid" else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        let isADIF = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?
            .contains(where: { $0.name == "format" && $0.value == "adif" }) == true
        let page = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?
            .first(where: { $0.name == "page" })?.value.flatMap(Int.init) ?? 1
        let options = Self.lock.withLock { (Self.reverseADIF, Self.paginated, Self.identicalADIF, Self.adifOnlyDifference, Self.numericOnlyDifference) }
        let meta: [String: Any] = ["page": page, "per_page": options.1 ? 1 : 1000, "count": options.1 ? 1 : 2, "total": 2, "total_pages": options.1 ? 2 : 1, "has_more": options.1 && page == 1]
        let body: Data
        if let override = Self.lock.withLock({ Self.responses[isADIF ? "adif" : "json"] }) {
            body = override
        } else if isADIF {
            var records = [("First", "first contact", "291"), ("Second", "second contact", "504")]
            if options.2 { records[1] = records[0] }
            if options.3 || options.4 { records[1] = ("First", "first contact", "504") }
            if options.0 { records.reverse() }
            if options.1 { records = [records[page - 1]] }
            let adif = records.map { name, comment, dxcc in
                var fields = [
                    "CALL": "DUPE", "QSO_DATE": "20231114", "TIME_ON": "221320",
                    "BAND": "20m", "MODE": "CW", "FREQ": "14.025000",
                    "NAME": name, "COMMENT": comment, "DXCC": dxcc,
                ]
                if options.4 { fields["TX_PWR"] = dxcc == "291" ? "100" : "50" }
                let record = ADIFRecord(fields: fields)
                return record.adifDocument.components(separatedBy: "<EOH>").last!
            }.joined()
            body = try! JSONSerialization.data(withJSONObject: [
                "data": ["exported": records.count, "lastfetchedid": 12, "adif": "<EOH>" + adif], "meta": meta,
            ])
        } else {
            var records: [[String: Any]] = (11...12).map { id in
                let sameDetails = id == 11 || options.2 || options.3 || options.4
                var fields: [String: Any] = ["id": id, "station_id": 1, "call": "DUPE", "band": "20m", "mode": "CW", "freq": 14025000,
                        "qso_date": "2023-11-14 22:13:20", "name": sameDetails ? "First" : "Second",
                        "comment": sameDetails ? "first contact" : "second contact"]
                if options.4 { fields["tx_pwr"] = id == 11 ? "100.00" : "50.0" }
                return fields
            }
            // Exercise both JSON orders as well as both independent ADIF
            // orders; page boundaries must not supply identity evidence.
            if options.1 { records.reverse() }
            if options.1 { records = [records[page - 1]] }
            body = try! JSONSerialization.data(withJSONObject: ["data": records, "meta": meta])
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
