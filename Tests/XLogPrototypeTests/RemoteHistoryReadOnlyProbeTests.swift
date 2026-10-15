import Foundation
import Testing
#if os(macOS)
import XLogCore
import SQLite3

/// Explicit operator diagnostic. Ordinary test runs never read credentials or
/// contact the network. The preview API has no database or write operation.
@Suite("Read-only remote history probe")
struct RemoteHistoryReadOnlyProbeTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["XLOG_SYNC_READONLY_WORKSPACE"] != nil))
    func inspectRemoteHistory() async throws {
        let path = try #require(ProcessInfo.processInfo.environment["XLOG_SYNC_READONLY_WORKSPACE"])
        let workspace = try IntegrationWorkspaceBootstrap.open(at: URL(fileURLWithPath: path))
        let defaults = try #require(workspace.makeDefaults())
        let settings = SettingsStore(defaults: defaults).load()
        let savedToken = try SecretStore(service: workspace.keychainService).load(.wavelogToken)
        let token = try #require(savedToken)
        let url = try #require(URL(string: settings.wavelogURL))
        let configuration = try WavelogConfiguration(baseURL: url, token: token, stationID: settings.wavelogStationID)
        do {
            if ProcessInfo.processInfo.environment["XLOG_SYNC_DIAGNOSE_ORDER"] == "1" {
                let client = WavelogClient(configuration: configuration)
                let json = try await client.listQSOs(page: 1, perPage: 5_000)
                let adif = try await client.exportADIF(page: 1, perPage: 1_000)
                print("READ_ONLY_ORDER_SAMPLE json_page=\(json.meta.page) json_per_page=\(json.meta.perPage) json_count=\(json.meta.count) json_total=\(json.meta.total) json_first_id=\(json.data.first?.id ?? -1) json_last_id=\(json.data.last?.id ?? -1)")
                print("READ_ONLY_ORDER_SAMPLE adif_page=\(adif.meta.page) adif_per_page=\(adif.meta.perPage) adif_count=\(adif.meta.count) adif_total=\(adif.meta.total) adif_last_fetched_id=\(adif.data.lastFetchedID ?? -1)")
                return
            }
            if ProcessInfo.processInfo.environment["XLOG_SYNC_SAMPLE_RX"] == "1" {
                let client = WavelogClient(configuration: configuration)
                let json = try await client.listQSOs(page: 1, perPage: 1000)
                let adif = try await client.exportADIF(page: 1, perPage: 1000)
                let records = ADIFParser().records(in: adif.data.adif)
                let zeroRX = json.data.filter { $0.receiveFrequency.flatMap(Double.init) == 0 }.count
                let missingRX = records.filter { $0["FREQ_RX"] == nil }.count
                let adifZeroRX = records.filter { $0["FREQ_RX"].flatMap(Double.init) == 0 }.count
                let adifRXEqualsTX = records.filter { record in
                    guard let rx = record["FREQ_RX"].flatMap(Double.init), let tx = record["FREQ"].flatMap(Double.init) else { return false }
                    return rx == tx
                }.count
                let convertedMissingRX = records.compactMap { QSO(adif: $0) }.filter { $0.extraFields["FREQ_RX"] == nil }.count
                let adifMalformedRX = records.filter { record in
                    guard let text = record["FREQ_RX"] else { return false }
                    guard let value = Double(text), value.isFinite else { return true }
                    return Int64(exactly: (value * 1_000_000).rounded()) == nil
                }.count
                func key(call: String, date: String, band: String, mode: String, frequency: Double?) -> String {
                    let hz = frequency.flatMap { Int64(exactly: $0.rounded()) }
                    return "\(call.uppercased())|\(date)|\(band.lowercased())|\(mode.uppercased())|\(hz ?? 0)"
                }
                let exported = Dictionary(grouping: records) { record in
                    key(call: record["CALL"] ?? "", date: (record["QSO_DATE"] ?? "") + (record["TIME_ON"] ?? "").padding(toLength: 6, withPad: "0", startingAt: 0),
                        band: record["BAND"] ?? "", mode: record["SUBMODE"].flatMap { $0.isEmpty ? nil : $0 } ?? record["MODE"] ?? "",
                        frequency: record["FREQ"].flatMap(Double.init).map { $0 * 1_000_000 })
                }
                var uniquePairs = 0, zeroToMissing = 0, zeroToZero = 0, zeroToTX = 0, positiveUnequal = 0
                for row in json.data {
                    let identity = key(call: row.call, date: row.qsoDate.filter(\.isNumber), band: row.band,
                        mode: row.submode.flatMap { $0.isEmpty ? nil : $0 } ?? row.mode, frequency: row.frequency.flatMap(Double.init))
                    guard let matches = exported[identity], matches.count == 1 else { continue }
                    uniquePairs += 1
                    let record = matches[0], rx = row.receiveFrequency.flatMap(Double.init)
                    let exportedRX = record["FREQ_RX"].flatMap(Double.init).map { $0 * 1_000_000 }
                    let exportedTX = record["FREQ"].flatMap(Double.init).map { $0 * 1_000_000 }
                    if rx == 0 {
                        if record["FREQ_RX"] == nil { zeroToMissing += 1 }
                        if exportedRX == 0 { zeroToZero += 1 }
                        if let exportedRX, exportedRX > 0, exportedRX == exportedTX { zeroToTX += 1 }
                    }
                    if let rx, rx > 0, let exportedRX, rx.rounded() != exportedRX.rounded() { positiveUnequal += 1 }
                }
                print("READ_ONLY_RX_SAMPLE json_rows=\(json.data.count) json_zero_rx=\(zeroRX) adif_rows=\(records.count) adif_missing_rx=\(missingRX) adif_zero_rx=\(adifZeroRX) adif_rx_equals_tx=\(adifRXEqualsTX) converted_missing_rx=\(convertedMissingRX) adif_malformed_rx=\(adifMalformedRX)")
                print("READ_ONLY_RX_PAIRS unique_pairs=\(uniquePairs) zero_to_missing=\(zeroToMissing) zero_to_zero=\(zeroToZero) zero_to_tx=\(zeroToTX) positive_unequal=\(positiveUnequal)")
                return
            }
            let remote = try await SyncEngine.previewRemoteHistory(configuration: configuration)
            print("READ_ONLY_REMOTE_HISTORY_OK total=\(remote.remoteIDs.count) unambiguous=\(remote.qsos.count) held=\(remote.heldRemoteIDs.count)")
            if ProcessInfo.processInfo.environment["XLOG_SYNC_DIAGNOSE_HELD"] == "1" {
                for identity in remote.heldIdentities.sorted() {
                    print("READ_ONLY_HELD identity=\(identity) remote_ids=\(remote.heldRemoteIDsByIdentity[identity, default: []]) differing_fields=\(remote.heldDifferencesByIdentity[identity, default: []])")
                    print("READ_ONLY_HELD_VALUE_SHAPES fields=\(remote.heldValueShapesByIdentity[identity, default: []])")
                }
            }
            var database: OpaquePointer?
            guard sqlite3_open_v2(workspace.databaseURL.path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
                Issue.record("Could not inspect local IDs read-only."); return
            }
            defer { sqlite3_close(database) }
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(database, "SELECT wavelog_id, is_dirty FROM qsos WHERE deleted_at IS NULL AND wavelog_id IS NOT NULL", -1, &statement, nil) == SQLITE_OK else {
                Issue.record("Could not query local IDs read-only."); return
            }
            defer { sqlite3_finalize(statement) }
            var localIDs: Set<Int> = [], missingClean = 0, missingDirty = 0
            while sqlite3_step(statement) == SQLITE_ROW {
                let id = Int(sqlite3_column_int64(statement, 0))
                localIDs.insert(id)
                if !remote.remoteIDs.contains(id) {
                    if sqlite3_column_int(statement, 1) == 0 { missingClean += 1 } else { missingDirty += 1 }
                }
            }
            print("READ_ONLY_LOCAL_COMPARISON remote_ids_not_local=\(remote.remoteIDs.subtracting(localIDs).count) clean_local_ids_absent_remote=\(missingClean) dirty_local_ids_absent_remote=\(missingDirty) held_ids_already_local=\(remote.heldRemoteIDs.intersection(localIDs).count)")
        } catch let error as WavelogClientError {
            switch error {
            case .invalidData(let reason): print("READ_ONLY_REMOTE_HISTORY_FAILED invalid_data: \(reason)")
            case .rejected(let status, _, _): print("READ_ONLY_REMOTE_HISTORY_FAILED http_status=\(status)")
            case .invalidResponse: print("READ_ONLY_REMOTE_HISTORY_FAILED invalid_response")
            default: print("READ_ONLY_REMOTE_HISTORY_FAILED configuration_or_verification")
            }
            Issue.record("Read-only remote history validation failed; no writes were attempted.")
        } catch is DecodingError {
            print("READ_ONLY_REMOTE_HISTORY_FAILED decoding_error")
            Issue.record("Remote response decoding failed; no writes were attempted.")
        } catch {
            print("READ_ONLY_REMOTE_HISTORY_FAILED transport_or_cancellation")
            Issue.record("Remote read failed; no writes were attempted.")
        }
    }
}
#endif
