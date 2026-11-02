import Foundation
import Testing
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

private struct PerformanceVault: ClusterCredentialStoring {
    let available = false
    func load(_ id: UUID) throws -> String? { nil }
    func save(_ password: String, serverID: UUID) throws { throw CocoaError(.featureUnsupported) }
}

/// Opt-in diagnostic: only a fresh copy of the nominated snapshot is opened.
/// Never prints contacts, settings, paths or credentials, or starts external I/O.
@Suite("Private snapshot performance")
struct PrivateLogPerformanceTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["XLOG_PERF_SNAPSHOT"] != nil))
    func interactiveLatency() async throws {
        let source = try #require(ProcessInfo.processInfo.environment["XLOG_PERF_SNAPSHOT"])
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-private-perf-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let workspace = try IntegrationWorkspaceBootstrap.createEmpty(at: logbook.workspaceDirectoryURL)
        defer { workspace.makeDefaults()?.removePersistentDomain(forName: workspace.defaultsSuiteName) }
        try FileManager.default.removeItem(at: workspace.databaseURL)
        try FileManager.default.copyItem(at: URL(fileURLWithPath: source), to: workspace.databaseURL)
        func measure(_ label: String, _ body: () throws -> Void) rethrows {
            let start = ProcessInfo.processInfo.systemUptime
            try body()
            print("PRIVATE_PERF \(label)_ms=\((ProcessInfo.processInfo.systemUptime - start) * 1000)")
        }
        try measure("cold_workspace") { _ = try logbook.handle(method: "workspace_status", params: [:]) }
        let db = try logbook.openedDatabase()
        defer { db.close() }
        try measure("page") { _ = try logbook.handle(method: "logbook_list", params: [:]) }
        let cluster = LiveClusterMethods(logbook: logbook, vault: PerformanceVault())
        var start = ProcessInfo.processInfo.systemUptime
        _ = try await cluster.handle(method: "cluster_snapshot", params: [:])
        print("PRIVATE_PERF cold_cluster_ms=\((ProcessInfo.processInfo.systemUptime - start) * 1000)")
        for index in 0..<3 {
            var qso = QSO(call: "TESTPERF", start: Date().addingTimeInterval(Double(index)), band: "20m", mode: "CW")
            qso.comment = "Disposable private performance fixture"
            try measure("save_\(index)") { try db.save(qso) }
            try measure("saved_page_\(index)") { _ = try logbook.handle(method: "logbook_list", params: [:]) }
            start = ProcessInfo.processInfo.systemUptime
            try await cluster.refreshContacts()
            print("PRIVATE_PERF refresh_cluster_\(index)_ms=\((ProcessInfo.processInfo.systemUptime - start) * 1000)")
        }
        try db.save(QSO(call: "TESTBACKGROUND", band: "20m", mode: "CW"))
        let background = Task { try await cluster.refreshContacts() }
        try await Task.sleep(for: .milliseconds(50))
        try measure("save_during_cluster") { try db.save(QSO(call: "TESTFOREGROUND", band: "40m", mode: "CW")) }
        try measure("page_during_cluster") { _ = try logbook.handle(method: "logbook_list", params: [:]) }
        try await background.value
        await cluster.terminate()
    }
}
