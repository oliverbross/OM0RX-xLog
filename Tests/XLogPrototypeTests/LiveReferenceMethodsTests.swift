#if os(macOS)
import Foundation
import Testing
import XLogCore
@testable import XLogPrototypeSupport

@Suite("Integrated reference resolution")
struct LiveReferenceMethodsTests {
    @Test("Standalone mode rejects an explicit Wavelog catalog refresh before network")
    func localModeDoesNotRefreshWavelogCatalog() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let resolver = LiveReferenceMethods(logbook: logbook)
        do {
            _ = try await resolver.handle(method: "reference_refresh", params: ["source": "wavelog_catalog"])
            Issue.record("Wavelog catalog refresh started in standalone mode")
        } catch let error as WorkerFailure {
            #expect(error.code == "reference_configuration_required")
        }
        #expect((try await resolver.handle(method: "reference_status", params: [:]))["running"] as? Bool == false)
    }

    @Test("All five activation kinds transfer and validate against installed workspace data")
    func allKinds() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let directory = try logbook.referenceDirectoryURL()
        try Data("reference,name,active,locationDesc\nUS-0001,Acadia National Park,1,US-ME\nUS-0002,Second Park,1,US-ME\n".utf8)
            .write(to: directory.appendingPathComponent("pota-parks.csv"))
        try Data("SummitCode,AssociationName,RegionName,SummitName\nFL/VO-209,France,Vosges,Le Hohneck\n".utf8)
            .write(to: directory.appendingPathComponent("sota-summits.csv"))
        try Data("[{\"refno\":\"EU-001\",\"name\":\"Great Britain\",\"dxcc_num\":\"223\"}]".utf8)
            .write(to: directory.appendingPathComponent("iota-groups.json"))
        try Data("reference,status,name,country\nFFF-0001,active,National Forest,France\n".utf8)
            .write(to: directory.appendingPathComponent("wwff-directory.csv"))
        try JSONEncoder().encode([ActivationReference(kind: .castle, reference: "F-01234", name: "Château du Haut-Koenigsbourg")])
            .write(to: directory.appendingPathComponent("castle-cache.json"))

        let resolver = LiveReferenceMethods(logbook: logbook)
        let result = try await resolver.handle(method: "reference_resolve", params: [
            "comment": "F/HB9DIZ/P SOTA FL/VO-209 POTA US-0001 IOTA EU-001 FFF-0001 WCA F-01234",
            "special_tags": ["SOTA", "POTA", "IOTA", "WWFF", "WCA"],
        ])
        let fields = try #require(result["fields"] as? [String: String])
        #expect(fields["sotaReference"] == "FL/VO-209")
        #expect(fields["potaReference"] == "US-0001")
        #expect(fields["iota"] == "EU-001")
        #expect(fields["wwffReference"] == "FFF-0001")
        #expect(fields["sig"] == "WCA")
        #expect(fields["sigInfo"] == "F-01234")
        let references = try #require(result["references"] as? [[String: String]])
        #expect(references.count == 5)
        #expect(references.allSatisfy { $0["status"] == "verified" })
        #expect(references.first { $0["kind"] == "sota" }?["name"] == "Le Hohneck")
        #expect(references.first { $0["kind"] == "castle" }?["name"] == "Château du Haut-Koenigsbourg")
        let reordered = try await resolver.handle(method: "reference_resolve", params: [
            "comment": "WCA F-01234 POTA US-0001 SOTA FL/VO-209",
            "special_tags": ["WCA", "POTA", "SOTA"],
        ])
        #expect((reordered["fields"] as? [String: String])?["potaReference"] == "US-0001")
        #expect((reordered["references"] as? [[String: String]])?.filter { $0["kind"] == "pota" }.map { $0["reference"] } == ["US-0001"])
        let multiple = try await resolver.handle(method: "reference_resolve", params: [
            "comment": "POTA US-0001 US-0002", "special_tags": ["POTA"],
        ])
        #expect((multiple["fields"] as? [String: String])?["potaReference"] == "US-0001")
        #expect((multiple["references"] as? [[String: String]])?.filter { $0["kind"] == "pota" }.map { $0["status"] } == ["verified", "verified"])
        let mixed = try await resolver.handle(method: "reference_resolve", params: [
            "comment": "KFF-3017 SOTA W1/AB-1234 WCA F-01234 POTA US-0001 US-0002",
            "special_tags": ["POTA", "WWFF", "SOTA", "WCA"],
        ])
        #expect((mixed["fields"] as? [String: String])?["potaReference"] == "US-0001")
        #expect((mixed["fields"] as? [String: String])?["wwffReference"] == "KFF-3017")
        #expect((mixed["references"] as? [[String: String]])?.filter { $0["kind"] == "pota" }.map { $0["reference"] } == ["US-0001", "US-0002"])
    }

    @Test("Missing, unknown and changed directories never manufacture validation")
    func directoryStatusesAndInvalidation() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let directory = try logbook.referenceDirectoryURL()
        let sota = directory.appendingPathComponent("sota-summits.csv")
        try Data("SummitCode,AssociationName,RegionName,SummitName\nFL/VO-209,France,Vosges,Original Summit\n".utf8).write(to: sota)
        let resolver = LiveReferenceMethods(logbook: logbook)
        func resolve(_ comment: String) async throws -> [[String: String]] {
            let result = try await resolver.handle(method: "reference_resolve", params: ["comment": comment, "special_tags": ["SOTA", "COTA"]])
            return try #require(result["references"] as? [[String: String]])
        }
        #expect(try await resolve("FL/VO-209").first { $0["kind"] == "sota" }?["name"] == "Original Summit")
        try Data("SummitCode,AssociationName,RegionName,SummitName\nFL/VO-209,France,Vosges,Revised Summit Name\n".utf8)
            .write(to: sota, options: .atomic)
        #expect(try await resolve("FL/VO-209").first { $0["kind"] == "sota" }?["name"] == "Revised Summit Name")
        let unknown = try await resolve("FL/VO-999 COTA:ABC-00999")
        #expect(unknown.first { $0["kind"] == "sota" }?["status"] == "not_found")
        #expect(unknown.first { $0["kind"] == "castle" }?["status"] == "not_installed")
        #expect(unknown.first { $0["kind"] == "castle" }?["reference"] == "ABC-00999")
        let unfamiliar = try await resolver.handle(method: "reference_resolve", params: [
            "comment": "WCA F-AB12", "special_tags": ["WCA"],
        ])
        #expect((unfamiliar["fields"] as? [String: String])?["sigInfo"] == "F-AB12")
        #expect((unfamiliar["references"] as? [[String: String]])?.first?["status"] == "not_installed")
        try FileManager.default.removeItem(at: sota)
        #expect(try await resolve("FL/VO-209").first { $0["kind"] == "sota" }?["status"] == "not_installed")
        await #expect(throws: WorkerFailure.self) {
            try await resolver.handle(method: "reference_resolve", params: ["comment": "test"])
        }
    }
}
#endif
