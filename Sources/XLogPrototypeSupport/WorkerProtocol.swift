import Foundation
import XLogPortableCore

/// P1 protocol only. No paths, executables, credentials or device commands are accepted.
public struct PrototypeWorker {
    public static let maxRequestBytes = 32_768
    public static let maxResponseBytes = 65_536
    public static let maxADIFBytes = 16_384
    public static let maxRecords = 128
    public static let maxFieldsPerRecord = 128

    public init() {}

    public func response(to data: Data) -> Data {
        var id = ""
        do {
            guard data.count <= Self.maxRequestBytes else {
                throw WorkerFailure("request_too_large", "Request exceeds the byte limit.")
            }
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let requestID = object["id"] as? String,
                  !requestID.isEmpty, requestID.utf8.count <= 128 else {
                throw WorkerFailure("invalid_request", "A bounded nonempty string id is required.")
            }
            id = requestID
            guard Set(object.keys) == Set(["id", "method", "params"]),
                  let method = object["method"] as? String, method.utf8.count <= 64,
                  let params = object["params"] as? [String: Any] else {
                throw WorkerFailure("invalid_request", "Expected id, method and object params only.")
            }
            let result: [String: Any]
            switch method {
            case "health":
                try requireEmpty(params)
                result = health()
            case "parse_adif":
                guard Set(params.keys) == Set(["text"]), let text = params["text"] as? String else {
                    throw WorkerFailure("invalid_params", "parse_adif requires only a string text.")
                }
                try validateADIF(text)
                let records = ADIFParser().records(in: text)
                let projected: [[String: Any]] = records.map { record in
                    let qso = QSO(adif: record)
                    let projection: Any = qso.map { qso -> [String: Any] in
                        ["call": qso.call, "band": qso.band, "mode": qso.mode,
                         "frequency_hz": qso.frequencyHz.map { $0 as Any } ?? NSNull()]
                    } ?? NSNull()
                    return ["fields": record.fields,
                            "semantic_identity_hash": record.semanticIdentityHash.map { $0 as Any } ?? NSNull(),
                            "qso": projection]
                }
                result = ["record_count": records.count, "records": projected,
                          "core_source": "Sources/XLogCore"]
            case "self_test":
                try requireEmpty(params)
                result = try PrototypeSelfTest.run()
            default:
                throw WorkerFailure("method_not_allowed", "Method is not available in the P1 worker.")
            }
            return encode(["id": id, "ok": true, "result": result])
        } catch let failure as WorkerFailure {
            return encode(["id": id, "ok": false,
                           "error": ["code": failure.code, "message": failure.message]])
        } catch {
            // Never echo input or dependency diagnostics, which may contain personal data.
            return encode(["id": id, "ok": false,
                           "error": ["code": "invalid_request", "message": "Request could not be decoded."]])
        }
    }

    public func oversizedResponse() -> Data {
        response(to: Data(repeating: 0, count: Self.maxRequestBytes + 1))
    }

    private func encode(_ object: [String: Any]) -> Data {
        if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
           data.count < Self.maxResponseBytes { return data } // Include the NDJSON newline in the limit.
        return (try? JSONSerialization.data(withJSONObject: ["id": object["id"] as? String ?? "", "ok": false,
                    "error": ["code": "response_too_large", "message": "Response exceeds the byte limit."]], options: [.sortedKeys])) ?? Data()
    }

    private func requireEmpty(_ params: [String: Any]) throws {
        guard params.isEmpty else { throw WorkerFailure("invalid_params", "This method accepts empty params only.") }
    }

    private func health() -> [String: Any] {
        #if os(Windows)
        let platform = "Windows"
        #elseif os(Linux)
        let platform = "Linux"
        #else
        let platform = "macOS"
        #endif
        return ["protocol_version": 1, "worker": "xlog-prototype-worker", "platform": platform,
                "mode": "synthetic_only", "station_io": false,
                "methods": ["health", "parse_adif", "self_test"],
                "limits": ["max_request_bytes": Self.maxRequestBytes, "max_response_bytes": Self.maxResponseBytes,
                           "max_adif_bytes": Self.maxADIFBytes,
                           "max_records": Self.maxRecords, "max_fields_per_record": Self.maxFieldsPerRecord]]
    }

    /// Validate before invoking the original permissive parser. This is framing validation,
    /// not a replacement ADIF parser. Its existing character-length interpretation is retained.
    private func validateADIF(_ text: String) throws {
        guard text.utf8.count <= Self.maxADIFBytes else {
            throw WorkerFailure("adif_too_large", "ADIF exceeds the byte limit.")
        }
        // The original parser obtains its header index from an uppercased String.
        // ASCII headers avoid index drift when Unicode case conversion expands characters.
        if let header = text.range(of: "<EOH>", options: .caseInsensitive),
           !text[..<header.upperBound].unicodeScalars.allSatisfy({ $0.isASCII }) {
            throw WorkerFailure("invalid_adif", "P1 ADIF headers must use ASCII text.")
        }
        var cursor = text.range(of: "<EOH>", options: .caseInsensitive)?.upperBound ?? text.startIndex
        var recordCount = 0
        var fieldCount = 0
        while let open = text[cursor...].firstIndex(of: "<") {
            guard let close = text[open...].firstIndex(of: ">") else {
                throw WorkerFailure("invalid_adif", "Unterminated ADIF descriptor.")
            }
            let descriptor = String(text[text.index(after: open)..<close])
            guard !descriptor.isEmpty, descriptor.utf8.count <= 96 else {
                throw WorkerFailure("invalid_adif", "Invalid ADIF descriptor.")
            }
            let parts = descriptor.split(separator: ":", omittingEmptySubsequences: false)
            let name = parts[0].uppercased()
            guard !name.isEmpty, name.utf8.count <= 64,
                  name.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 95 }) else {
                throw WorkerFailure("invalid_adif", "Invalid ADIF field name.")
            }
            cursor = text.index(after: close)
            if name == "EOR" {
                guard parts.count == 1 else { throw WorkerFailure("invalid_adif", "Invalid EOR marker.") }
                if fieldCount > 0 { recordCount += 1 }
                guard recordCount <= Self.maxRecords else { throw WorkerFailure("adif_limit", "Too many records.") }
                fieldCount = 0
                continue
            }
            guard (2...3).contains(parts.count), !parts[1].isEmpty,
                  parts[1].utf8.allSatisfy({ (48...57).contains($0) }),
                  let length = Int(parts[1]), length <= 16_384,
                  let end = text.index(cursor, offsetBy: length, limitedBy: text.endIndex) else {
                throw WorkerFailure("invalid_adif", "Invalid or truncated ADIF field length.")
            }
            if parts.count == 3 {
                guard parts[2].count == 1, parts[2].utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) }) else {
                    throw WorkerFailure("invalid_adif", "Invalid ADIF field type.")
                }
            }
            fieldCount += 1
            guard fieldCount <= Self.maxFieldsPerRecord else { throw WorkerFailure("adif_limit", "Too many fields.") }
            let value = text[cursor..<end]
            // QSO's existing Double→Int64 conversion must never receive NaN/overflow.
            if name == "FREQ", let number = Double(value),
               (!number.isFinite || number < 0 || number > 1_000_000) {
                throw WorkerFailure("invalid_adif", "Frequency is outside the P1 range.")
            }
            cursor = end
        }
        guard fieldCount == 0 else { throw WorkerFailure("invalid_adif", "ADIF record must end with EOR.") }
    }
}

struct WorkerFailure: Error {
    let code: String
    let message: String
    init(_ code: String, _ message: String) { self.code = code; self.message = message }
}

/// Bounded incremental NDJSON framing; one serial request means no unbounded queue.
public struct WorkerLineReader {
    private var buffer = Data()
    private var discarding = false
    public init() {}

    public mutating func consume(_ chunk: Data, emit: (Data?) -> Void) {
        for byte in chunk {
            if byte == 10 {
                if discarding { emit(nil) }
                else {
                    if buffer.last == 13 { buffer.removeLast() }
                    emit(buffer)
                }
                buffer.removeAll(keepingCapacity: true)
                discarding = false
            } else if !discarding {
                if buffer.count < PrototypeWorker.maxRequestBytes { buffer.append(byte) }
                else { buffer.removeAll(keepingCapacity: true); discarding = true }
            }
        }
    }

    public mutating func finish(emit: (Data?) -> Void) {
        if discarding { emit(nil) }
        else if !buffer.isEmpty { emit(buffer) }
        buffer.removeAll(keepingCapacity: true)
        discarding = false
    }
}
