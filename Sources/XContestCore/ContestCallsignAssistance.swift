import Foundation

public struct ContestAssistanceContext: Codable, Equatable, Hashable, Sendable {
    public let sessionID: String
    public let workspaceGeneration: String
    public let requestID: String

    public init(sessionID: String, workspaceGeneration: String, requestID: String) {
        self.sessionID = sessionID
        self.workspaceGeneration = workspaceGeneration
        self.requestID = requestID
    }
}

public struct ContestSCPProvenance: Codable, Equatable, Sendable {
    public let sourceID: String
    public let version: String
    public let sourceURL: String?
    public let retrievedAtUTC: Date?

    public init(sourceID: String, version: String, sourceURL: String? = nil, retrievedAtUTC: Date? = nil) {
        self.sourceID = sourceID
        self.version = version
        self.sourceURL = sourceURL
        self.retrievedAtUTC = retrievedAtUTC
    }
}

public enum ContestSCPDigestVerification: String, Codable, Sendable {
    case computedOnly
    case matchedExpectedSHA256
}

public struct ContestSCPDatasetInfo: Codable, Equatable, Sendable {
    public let provenance: ContestSCPProvenance
    public let sha256: String
    public let digestVerification: ContestSCPDigestVerification
    public let byteCount: Int
    public let recordCount: Int
    public let duplicateCount: Int
}

public struct ContestSCPImportLimits: Equatable, Sendable {
    public var maximumBytes: Int
    public var maximumRecords: Int
    public var maximumLineBytes: Int

    public init(maximumBytes: Int = 16 * 1_024 * 1_024,
                maximumRecords: Int = 100_000,
                maximumLineBytes: Int = 64) {
        self.maximumBytes = maximumBytes
        self.maximumRecords = maximumRecords
        self.maximumLineBytes = maximumLineBytes
    }
}

public struct ContestSCPQueryOptions: Equatable, Sendable {
    public var limit: Int
    public var maximumEvaluations: Int

    public init(limit: Int = 20, maximumEvaluations: Int = 100_000) {
        self.limit = limit
        self.maximumEvaluations = maximumEvaluations
    }
}

public struct ContestSCPMatch: Codable, Equatable, Sendable {
    public let matchID: String
    public let callsign: String
    public let score: Double
    public let isPrefixMatch: Bool
}

public struct ContestSCPQueryResult: Codable, Equatable, Sendable {
    public let context: ContestAssistanceContext
    public let normalizedQuery: String
    public let matches: [ContestSCPMatch]
    public let dataset: ContestSCPDatasetInfo
    public let evaluatedRecordCount: Int
    /// True means the deterministic evaluation budget stopped before the end of the catalog.
    /// Matches are best only within the evaluated prefix, not the whole dataset.
    public let isPartial: Bool
}

public enum ContestSCPError: Error, Equatable, LocalizedError {
    case invalidProvenance
    case invalidLimits
    case datasetTooLarge
    case invalidUTF8
    case invalidRecord(line: Int)
    case tooManyRecords
    case digestMismatch
    case invalidQuery
    case invalidOptions
    case staleContext
    case unknownMatch

    public var errorDescription: String? {
        switch self {
        case .invalidProvenance: return "Super Check Partial provenance is invalid."
        case .invalidLimits: return "Super Check Partial import limits are invalid."
        case .datasetTooLarge: return "The Super Check Partial dataset exceeds the byte limit."
        case .invalidUTF8: return "The Super Check Partial dataset is not valid UTF-8."
        case .invalidRecord(let line): return "The Super Check Partial dataset has an invalid record at line \(line)."
        case .tooManyRecords: return "The Super Check Partial dataset exceeds the record limit."
        case .digestMismatch: return "The Super Check Partial dataset does not match its expected SHA-256."
        case .invalidQuery: return "The Super Check Partial query is invalid."
        case .invalidOptions: return "The Super Check Partial query options are invalid."
        case .staleContext: return "The Super Check Partial result belongs to another request context."
        case .unknownMatch: return "The selected callsign is not present in this result."
        }
    }
}

public struct ContestSCPIndex: Sendable {
    private struct Record: Sendable {
        let callsign: String
        let ordinal: Int
        let scalars: [UInt8]
    }

    public let dataset: ContestSCPDatasetInfo
    private let records: [Record]

    public init(importing data: Data, provenance: ContestSCPProvenance,
                expectedSHA256: String? = nil, limits: ContestSCPImportLimits = .init()) throws {
        guard Self.validMetadata(provenance.sourceID), Self.validMetadata(provenance.version),
              provenance.sourceURL.map({ $0.utf8.count <= 2_048 && !$0.contains("\0") }) ?? true,
              provenance.retrievedAtUTC.map({ $0.timeIntervalSinceReferenceDate.isFinite }) ?? true else {
            throw ContestSCPError.invalidProvenance
        }
        guard limits.maximumBytes > 0, limits.maximumRecords > 0, limits.maximumRecords <= 100_000,
              limits.maximumLineBytes >= 2, limits.maximumLineBytes <= 256 else { throw ContestSCPError.invalidLimits }
        guard data.count <= limits.maximumBytes else { throw ContestSCPError.datasetTooLarge }
        let digest = Self.sha256(data)
        let expected = expectedSHA256?.lowercased()
        if let expected, (!Self.isSHA256(expected) || expected != digest) { throw ContestSCPError.digestMismatch }

        var seen = Set<String>()
        var imported: [Record] = []
        var duplicates = 0
        var lineStart = data.startIndex
        var lineNumber = 1
        var finished = false
        while !finished {
            let newline = data[lineStart...].firstIndex(of: 0x0a) ?? data.endIndex
            finished = newline == data.endIndex
            let currentLine = lineNumber
            lineNumber += 1
            let rawLength = data.distance(from: lineStart, to: newline)
            guard rawLength <= limits.maximumLineBytes else { throw ContestSCPError.invalidRecord(line: currentLine) }
            var lineData = data[lineStart..<newline]
            if !finished { lineStart = data.index(after: newline) }
            if lineData.last == 0x0d { lineData = lineData.dropLast() }
            if currentLine == 1, lineData.starts(with: [0xef, 0xbb, 0xbf]) { lineData = lineData.dropFirst(3) }
            guard let decoded = String(data: lineData, encoding: .utf8) else { throw ContestSCPError.invalidUTF8 }
            let line = decoded.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            if line == "!!Order,1,1", currentLine == 1 { continue }
            guard line.utf8.count <= limits.maximumLineBytes, let call = Self.normalizedCallsign(line), call.utf8.count >= 2 else {
                throw ContestSCPError.invalidRecord(line: currentLine)
            }
            if !seen.insert(call).inserted { duplicates += 1; continue }
            guard imported.count < limits.maximumRecords else { throw ContestSCPError.tooManyRecords }
            imported.append(Record(callsign: call, ordinal: imported.count, scalars: Array(call.utf8)))
        }
        guard !imported.isEmpty else { throw ContestSCPError.invalidRecord(line: 1) }
        records = imported
        dataset = ContestSCPDatasetInfo(provenance: provenance, sha256: digest,
            digestVerification: expected == nil ? .computedOnly : .matchedExpectedSHA256,
            byteCount: data.count, recordCount: imported.count, duplicateCount: duplicates)
    }

    public func matches(query: String, context: ContestAssistanceContext,
                        options: ContestSCPQueryOptions = .init()) async throws -> ContestSCPQueryResult {
        guard (2...32).contains(query.utf8.count), query.utf8.allSatisfy({ $0 < 128 }),
              let normalized = Self.normalizedCallsign(query), normalized.utf8.count >= 2 else { throw ContestSCPError.invalidQuery }
        guard (1...20).contains(options.limit), options.maximumEvaluations > 0,
              options.maximumEvaluations <= 100_000 else { throw ContestSCPError.invalidOptions }
        let records = records, dataset = dataset
        try Task.checkCancellation()
        let queryBytes = Array(normalized.utf8)
        let count = min(records.count, options.maximumEvaluations)
        var matches: [(ContestSCPMatch, Int)] = []
        matches.reserveCapacity(min(count, 256))
        for index in 0..<count {
            if index & 255 == 0 { try Task.checkCancellation() }
            let record = records[index]
            let prefix = record.callsign.hasPrefix(normalized)
            var score = Self.normalizedIndelSimilarity(queryBytes, record.scalars)
            if !prefix { score = Double(Int(score * 0.8)) }
            guard score >= 60 else { continue }
            matches.append((ContestSCPMatch(matchID: "\(dataset.sha256):\(record.ordinal)", callsign: record.callsign,
                score: score, isPrefixMatch: prefix), record.ordinal))
        }
        matches.sort { left, right in
            if left.0.score != right.0.score { return left.0.score > right.0.score }
            return left.1 < right.1
        }
        return ContestSCPQueryResult(context: context, normalizedQuery: normalized,
            matches: Array(matches.prefix(options.limit).map(\.0)), dataset: dataset,
            evaluatedRecordCount: count, isPartial: count < records.count)
    }

    public func selectedCallsign(matchID: String, from result: ContestSCPQueryResult,
                                 expectedContext: ContestAssistanceContext) throws -> String {
        guard result.context == expectedContext, result.dataset == dataset else { throw ContestSCPError.staleContext }
        guard let match = result.matches.first(where: { $0.matchID == matchID }) else { throw ContestSCPError.unknownMatch }
        let prefix = dataset.sha256 + ":"
        guard matchID.hasPrefix(prefix), let ordinal = Int(matchID.dropFirst(prefix.count)), records.indices.contains(ordinal),
              records[ordinal].ordinal == ordinal, records[ordinal].callsign == match.callsign else { throw ContestSCPError.unknownMatch }
        return records[ordinal].callsign
    }

    private static func validMetadata(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return value == trimmed && !trimmed.isEmpty && value.utf8.count <= 256 &&
            value.unicodeScalars.allSatisfy { $0.value >= 32 && $0.value != 127 }
    }

    private static func normalizedCallsign(_ value: String) -> String? {
        guard value.utf8.allSatisfy({ $0 < 128 }) else { return nil }
        let call = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !call.isEmpty, call.utf8.count <= 32,
              call.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || $0 == 47 }) else { return nil }
        return call
    }

    private static func normalizedIndelSimilarity(_ left: [UInt8], _ right: [UInt8]) -> Double {
        var subsequence: UInt64 = 0
        for lhs in left {
            var matchingPositions: UInt64 = 0
            for (index, rhs) in right.enumerated() where lhs == rhs {
                matchingPositions |= UInt64(1) << UInt64(index)
            }
            let union = matchingPositions | subsequence
            let advanced = (subsequence << 1) | 1
            subsequence = union & ~(union &- advanced)
        }
        return 200.0 * Double(subsequence.nonzeroBitCount) / Double(left.count + right.count)
    }

    private static func isSHA256(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    private static func sha256(_ data: Data) -> String {
        let constants: [UInt32] = [
            0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
            0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
            0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
            0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
            0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
            0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
            0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
            0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]
        var message = Array(data)
        let bitLength = UInt64(message.count) * 8
        message.append(0x80)
        while message.count % 64 != 56 { message.append(0) }
        message.append(contentsOf: (0..<8).reversed().map { UInt8(truncatingIfNeeded: bitLength >> UInt64($0 * 8)) })
        var hash: [UInt32] = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]
        for offset in stride(from: 0, to: message.count, by: 64) {
            var words = Array(repeating: UInt32(0), count: 64)
            for index in 0..<16 {
                let start = offset + index * 4
                words[index] = UInt32(message[start]) << 24 | UInt32(message[start + 1]) << 16 |
                    UInt32(message[start + 2]) << 8 | UInt32(message[start + 3])
            }
            for index in 16..<64 {
                let x = words[index - 15], y = words[index - 2]
                let s0 = x.rotateRight(7) ^ x.rotateRight(18) ^ (x >> 3)
                let s1 = y.rotateRight(17) ^ y.rotateRight(19) ^ (y >> 10)
                words[index] = words[index - 16] &+ s0 &+ words[index - 7] &+ s1
            }
            var a=hash[0], b=hash[1], c=hash[2], d=hash[3], e=hash[4], f=hash[5], g=hash[6], h=hash[7]
            for index in 0..<64 {
                let s1 = e.rotateRight(6) ^ e.rotateRight(11) ^ e.rotateRight(25)
                let choice = (e & f) ^ ((~e) & g)
                let t1 = h &+ s1 &+ choice &+ constants[index] &+ words[index]
                let s0 = a.rotateRight(2) ^ a.rotateRight(13) ^ a.rotateRight(22)
                let majority = (a & b) ^ (a & c) ^ (b & c)
                let t2 = s0 &+ majority
                h=g; g=f; f=e; e=d &+ t1; d=c; c=b; b=a; a=t1 &+ t2
            }
            hash[0] &+= a; hash[1] &+= b; hash[2] &+= c; hash[3] &+= d
            hash[4] &+= e; hash[5] &+= f; hash[6] &+= g; hash[7] &+= h
        }
        return hash.map { String(format: "%08x", $0) }.joined()
    }
}

private extension UInt32 {
    func rotateRight(_ count: UInt32) -> UInt32 { self >> count | self << (32 - count) }
}
