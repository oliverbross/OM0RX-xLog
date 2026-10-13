import Foundation
import Testing
@testable import XLogPrototypeSupport

@Suite("Packaged history acceptance isolation")
struct LocalAcceptanceSpotHistoryTests {
    private func request(_ session: LocalAcceptanceSession, _ method: String,
                         _ params: [String: Any] = [:]) async throws -> [String: Any] {
        let bytes = try JSONSerialization.data(withJSONObject: ["id": method, "method": method, "params": params])
        return try #require(try JSONSerialization.jsonObject(with: await session.worker.response(to: bytes)) as? [String: Any])
    }

    @Test("Generated retained archive is readable without creating a logbook or connecting services")
    func retainedArchive() async throws {
        let session = try LocalAcceptanceSession()
        do {
            let first = try #require((try await request(session, "spot_history_query", ["limit": 100])["result"] as? [String: Any])?["page"] as? [String: Any])
            let rows = try #require(first["rows"] as? [[String: Any]])
            #expect(rows.count == 100)
            let cursor = try #require(first["nextCursor"] as? String)
            let watermark = try #require(first["watermark"] as? Int)
            let second = try #require((try await request(session, "spot_history_query", ["limit": 100,
                "cursor": cursor, "watermark": watermark])["result"] as? [String: Any])?["page"] as? [String: Any])
            let remaining = try #require(second["rows"] as? [[String: Any]])
            #expect(remaining.count == 37)
            #expect(Set((rows + remaining).compactMap { $0["id"] as? String }).count == 137)
            let stats = try #require((try await request(session, "spot_history_stats", ["call": "TESTH0"])["result"] as? [String: Any])?["stats"] as? [String: Any])
            #expect(stats["total"] as? Int == 69)
            let id = try #require(rows.first?["id"] as? String)
            let detail = try #require((try await request(session, "spot_history_detail", ["id": id])["result"] as? [String: Any])?["observation"] as? [String: Any])
            #expect((detail["rawLine"] as? String)?.contains("Synthetic acceptance <not-markup> Ω") == true)
            let status = try #require(try await request(session, "spot_history_status")["result"] as? [String: Any])
            #expect((status["recording"] as? [String: Any])?["state"] as? String == "idle")
            #expect((status["status"] as? [String: Any])?["total"] as? Int == 137)
            let workspace = try #require(try await request(session, "workspace_status")["result"] as? [String: Any])
            #expect(workspace["workspace_exists"] as? Bool == false)
            for method in ["cluster_connect", "cluster_snapshot", "spot_history_export", "spot_history_delete", "spot_history_seed"] {
                let denied = try await request(session, method)
                #expect((denied["error"] as? [String: Any])?["code"] as? String == "acceptance_restricted")
            }
        } catch { try? await session.close(); throw error }
        try await session.close()
        #expect(!FileManager.default.fileExists(atPath: session.directory.path))
        let late = try await request(session, "spot_history_status")
        #expect((late["error"] as? [String: Any])?["code"] as? String == "worker_stopping")
        #expect(!FileManager.default.fileExists(atPath: session.directory.path))
    }
}
