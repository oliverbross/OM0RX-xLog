#if os(macOS)
import Foundation
#if canImport(FoundationXML)
import FoundationXML
#endif
import CryptoKit
import XLogCore

/// Local, on-demand reference evidence. Owned by LiveReferenceMethods; never refreshes data or edits a log.
final class LogReviewReferences {
    private struct Identity: Equatable {
        let path: String
        let size: Int64
        let modified: Date
        let fileNumber: UInt64
    }
    private struct Source {
        var status: String
        var version: String?
        var modifiedAt: String?
        var resolver: CTYResolver?
        var calls: Set<String>?
        func summary(_ name: String) -> [String: Any] {
            ["name": name, "status": status, "version": version as Any? ?? NSNull(),
             "modifiedAt": modifiedAt as Any? ?? NSNull()]
        }
    }
    private struct Contact {
        let id: String
        let call: String
        let timestamp: Date
    }
    private var cached: [String: (Identity, Source)] = [:]
    private var bundled: Source?
    static let maximumFileBytes = 32 * 1024 * 1024

    func review(params: [String: Any], directory: URL) throws -> [String: Any] {
        // Validate the whole batch before opening any reference file.
        guard Set(params.keys) == ["contacts"], let input = params["contacts"] as? [[String: Any]],
              input.count <= 100 else { throw Self.invalidParameters() }
        var ids = Set<String>()
        let contacts: [Contact] = try input.map { row in
            guard Set(row.keys) == ["id", "call", "timestamp"],
                  let id = row["id"] as? String, !id.isEmpty, id.utf8.count <= 128,
                  ids.insert(id).inserted,
                  let rawCall = row["call"] as? String, rawCall.utf8.count <= 64,
                  let timestamp = row["timestamp"] as? String,
                  let date = Self.timestamp(timestamp) else { throw Self.invalidParameters() }
            let call = rawCall.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard Self.isCall(call) else { throw Self.invalidParameters() }
            return Contact(id: id, call: call, timestamp: date)
        }
        let cty = bundledSource()
        let clublog = source("cty.xml", directory: directory)
        let lotw = source("lotw-user-activity.csv", directory: directory)
        let rows: [[String: Any]] = contacts.map { contact in
            var countries: [[String: Any]] = []
            if let match = cty.resolver?.resolveCountryEndpointWithPrimaryPrefix(contact.call, at: contact.timestamp) {
                countries.append(Self.country(match.country, source: "cty", primaryPrefix: match.primaryPrefix))
            }
            if let match = clublog.resolver?.resolveCountryEndpoint(contact.call, at: contact.timestamp) {
                // Club Log cty.xml is a country reference, not a Club Log user directory.
                countries.append(Self.country(match, source: "clublog"))
            }
            return ["id": contact.id, "call": contact.call,
                    "lotwListed": lotw.calls.map { $0.contains(contact.call) } as Any? ?? NSNull(),
                    "countries": countries]
        }
        return ["sources": [cty.summary("cty"), clublog.summary("clublog"), lotw.summary("lotw")], "rows": rows]
    }

    private func bundledSource() -> Source {
        if let bundled { return bundled }
        let result: Source
        do {
            let data = Data(try CTYResolver.bundledCSV().utf8)
            result = Source(status: "available", version: Self.digest(data), resolver: try CTYResolver.bundled())
        } catch { result = Source(status: "invalid") }
        bundled = result
        return result
    }

    private func source(_ name: String, directory: URL) -> Source {
        let url = directory.appendingPathComponent(name)
        let identity: Identity
        do { identity = try Self.identity(url) }
        catch {
            cached.removeValue(forKey: name)
            let ns = error as NSError
            let missing = ns.domain == NSCocoaErrorDomain && [NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(ns.code)
            return Source(status: missing ? "missing" : "invalid")
        }
        if let previous = cached[name], previous.0 == identity { return previous.1 }
        var result = Source(status: "invalid", modifiedAt: ISO8601DateFormatter().string(from: identity.modified))
        do {
            guard identity.size > 0, identity.size <= Int64(Self.maximumFileBytes) else { throw Self.invalidData() }
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            let data = try handle.read(upToCount: Self.maximumFileBytes + 1) ?? Data()
            guard data.count == identity.size, data.count <= Self.maximumFileBytes,
                  try Self.identity(url) == identity else { throw Self.invalidData() }
            result.version = Self.digest(data)
            if name == "cty.xml" { result.resolver = try Self.clubLogResolver(data) }
            else { result.calls = try Self.lotwCalls(data) }
            result.status = "available"
        } catch { /* Invalid or changing data is unavailable evidence; never fall back to stale membership. */ }
        cached[name] = (identity, result)
        return result
    }

    private static func identity(_ url: URL) throws -> Identity {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber,
              let modified = attributes[.modificationDate] as? Date,
              let fileNumber = attributes[.systemFileNumber] as? NSNumber else { throw invalidData() }
        return Identity(path: url.standardizedFileURL.path, size: size.int64Value,
                        modified: modified, fileNumber: fileNumber.uint64Value)
    }

    private static func clubLogResolver(_ data: Data) throws -> CTYResolver {
        guard let text = String(data: data, encoding: .utf8),
              text.range(of: "<!DOCTYPE", options: .caseInsensitive) == nil,
              text.range(of: "<!ENTITY", options: .caseInsensitive) == nil else { throw invalidData() }
        let validation = ClubLogValidation(), parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = validation
        guard parser.parse(), validation.hasRule, !validation.invalid else { throw invalidData() }
        // The existing dated resolver accepts URLs. Parse an immutable, bounded
        // snapshot so an atomic cache replacement cannot change the hashed bytes.
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-review-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: false,
                                               attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: temporary) }
        let file = temporary.appendingPathComponent("cty.xml")
        // Normalize leaf <prefix> aliases to <call>: the legacy parser's rule
        // element is also named prefix, so it otherwise mistakes the alias for a new rule.
        let resolverData = validation.hasPrefixAlias ? Data(validation.normalizedXML(text).utf8) : data
        try resolverData.write(to: file, options: .withoutOverwriting)
        return try CTYResolver(xmlURL: file)
    }

    /// Reject empty/error XML and malformed date bounds that the legacy resolver otherwise treats as unbounded.
    private final class ClubLogValidation: NSObject, XMLParserDelegate {
        var hasRule = false, invalid = false
        var hasPrefixAlias = false
        private var kind = "", buffer = "", values: [String: String] = [:]
        private var depth = 0, ruleDepth = 0
        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
                    qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
            buffer = ""
            depth += 1
            if ["prefix", "exception"].contains(elementName.lowercased()), kind.isEmpty {
                kind = elementName.lowercased(); values = [:]; ruleDepth = depth
            }
        }
        func parser(_ parser: XMLParser, foundCharacters string: String) { buffer += string }
        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
            let name = elementName.lowercased(), value = buffer.trimmingCharacters(in: .whitespacesAndNewlines)
            defer { buffer = ""; depth -= 1 }
            guard !kind.isEmpty else { return }
            if depth != ruleDepth {
                values[name] = value
                if name == "prefix", !value.isEmpty { hasPrefixAlias = true }
                return
            }
            defer { kind = ""; values = [:] }
            guard let call = values["call"] ?? values["prefix"], !call.isEmpty,
                  Int(values["adif"] ?? "") != nil, Int(values["cqz"] ?? "") != nil else {
                invalid = true; return
            }
            for field in ["start", "end"] {
                guard let text = values[field], !text.isEmpty else { continue }
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = TimeZone(secondsFromGMT: 0)
                formatter.isLenient = false
                let valid = ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd", "yyyyMMdd"].contains { format in
                    formatter.dateFormat = format
                    guard let date = formatter.date(from: text) else { return false }
                    return formatter.string(from: date) == text
                }
                if !valid { invalid = true }
            }
            hasRule = true
        }
        func normalizedXML(_ text: String) -> String {
            // Leaf prefix tokens contain no markup. Preserve every other field,
            // including date bounds, and keep provenance hashed from original bytes.
            text.replacingOccurrences(of: #"<prefix(?:\s+[^>]*)?>\s*([^<>]+?)\s*</prefix\s*>"#,
                                      with: "<call>$1</call>", options: [.regularExpression, .caseInsensitive])
        }
    }

    private static func lotwCalls(_ data: Data) throws -> Set<String> {
        guard let text = String(data: data, encoding: .utf8) else { throw invalidData() }
        var calls = Set<String>()
        for (index, rawLine) in text.split(whereSeparator: \.isNewline).enumerated() {
            guard rawLine.utf8.count <= 1024 else { throw invalidData() }
            let columns = try csvColumns(String(rawLine).replacingOccurrences(of: "\u{FEFF}", with: ""))
            guard columns.count >= 2 else { throw invalidData() }
            let call = columns[0].uppercased()
            if index == 0 && ["CALL", "CALLSIGN"].contains(call) { continue }
            guard isCall(call) else { throw invalidData() }
            calls.insert(call)
        }
        guard !calls.isEmpty else { throw invalidData() }
        return calls
    }

    private static func csvColumns(_ line: String) throws -> [String] {
        var result: [String] = [], value = "", quoted = false, closed = false
        let characters = Array(line)
        var index = 0
        while index < characters.count {
            let character = characters[index]
            if character == "\"" {
                if quoted, index + 1 < characters.count, characters[index + 1] == "\"" {
                    value.append("\""); index += 1
                } else if quoted { quoted = false; closed = true }
                else {
                    guard !closed, value.trimmingCharacters(in: .whitespaces).isEmpty else { throw invalidData() }
                    value = ""; quoted = true
                }
            } else if character == ",", !quoted {
                result.append(value.trimmingCharacters(in: .whitespaces)); value = ""; closed = false
            } else if closed {
                guard character.isWhitespace else { throw invalidData() }
            } else { value.append(character) }
            index += 1
        }
        guard !quoted else { throw invalidData() }
        result.append(value.trimmingCharacters(in: .whitespaces))
        return result
    }

    private static func country(_ value: CountryInfo, source: String, primaryPrefix: String? = nil) -> [String: Any] {
        var result: [String: Any] = ["source": source, "adif": value.adif, "cqZone": value.cqZone, "country": value.name]
        if let primaryPrefix { result["primaryPrefix"] = primaryPrefix }
        return result
    }
    private static func isCall(_ value: String) -> Bool {
        (3...32).contains(value.count) && value.contains(where: \.isLetter) && value.contains(where: \.isNumber)
            && value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "/") }
    }
    private static func timestamp(_ value: String) -> Date? {
        let iso = value.range(of: #"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$"#, options: .regularExpression) != nil
            ? value.replacingOccurrences(of: " ", with: "T") + "Z" : value
        guard iso.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$"#, options: .regularExpression) != nil else { return nil }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = iso.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        guard let date = parser.date(from: iso), parser.string(from: date).prefix(19) == iso.prefix(19) else { return nil }
        return date
    }
    private static func digest(_ data: Data) -> String { "sha256:" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private static func invalidData() -> Error { CocoaError(.fileReadCorruptFile) }
    private static func invalidParameters() -> WorkerFailure {
        WorkerFailure("invalid_params", "Log Review expects up to 100 distinct contacts with a callsign and UTC timestamp.")
    }
}
#endif
