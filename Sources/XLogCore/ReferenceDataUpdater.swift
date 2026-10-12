import Foundation
import CryptoKit
import zlib

public struct ReferenceDataValidator: Codable, Equatable, Sendable {
    public var eTag: String?
    public var lastModified: String?
    /// SHA-256 of the exact requested source URL (and credential scope where
    /// applicable). No URL, query value, API key or token is persisted.
    public var sourceIdentity: String?

    public init(eTag: String? = nil, lastModified: String? = nil, sourceIdentity: String? = nil) {
        self.eTag = eTag
        self.lastModified = lastModified
        self.sourceIdentity = sourceIdentity
    }
}

/// Only successful 200 responses establish a downloaded date. A 304 is a
/// successful check of an existing validated cache, not a new download.
public struct ReferenceSourceMetadata: Codable, Equatable, Sendable {
    public var downloadedAt: Date?
    public var checkedAt: Date?
    public var lastAttemptAt: Date?
    public var status: String
    public var lastError: String?

    public init(downloadedAt: Date? = nil, checkedAt: Date? = nil,
                lastAttemptAt: Date? = nil, status: String = "never_checked",
                lastError: String? = nil) {
        self.downloadedAt = downloadedAt
        self.checkedAt = checkedAt
        self.lastAttemptAt = lastAttemptAt
        self.status = status
        self.lastError = lastError
    }
}

public struct ReferenceDataState: Codable, Equatable, Sendable {
    public var clubLogUpdatedAt: Date?
    public var lotwUpdatedAt: Date?
    public var clubLogBytes = 0
    public var lotwBytes = 0
    public var wavelogCatalogUpdatedAt: Date?
    public var wavelogCatalogBytes = 0
    public var activationUpdatedAt: [String: Date] = [:]
    public var activationBytes: [String: Int] = [:]
    public var activationCounts: [String: Int] = [:]
    public var validators: [String: ReferenceDataValidator] = [:]
    public var sourceMetadata: [String: ReferenceSourceMetadata] = [:]

    public init(clubLogUpdatedAt: Date? = nil, lotwUpdatedAt: Date? = nil, clubLogBytes: Int = 0, lotwBytes: Int = 0, wavelogCatalogUpdatedAt: Date? = nil, wavelogCatalogBytes: Int = 0, activationUpdatedAt: [String: Date] = [:], activationBytes: [String: Int] = [:], activationCounts: [String: Int] = [:], validators: [String: ReferenceDataValidator] = [:], sourceMetadata: [String: ReferenceSourceMetadata] = [:]) {
        self.clubLogUpdatedAt = clubLogUpdatedAt
        self.lotwUpdatedAt = lotwUpdatedAt
        self.clubLogBytes = clubLogBytes
        self.lotwBytes = lotwBytes
        self.wavelogCatalogUpdatedAt = wavelogCatalogUpdatedAt
        self.wavelogCatalogBytes = wavelogCatalogBytes
        self.activationUpdatedAt = activationUpdatedAt
        self.activationBytes = activationBytes
        self.activationCounts = activationCounts
        self.validators = validators
        self.sourceMetadata = sourceMetadata
    }

    private enum CodingKeys: String, CodingKey {
        case clubLogUpdatedAt, lotwUpdatedAt, clubLogBytes, lotwBytes, wavelogCatalogUpdatedAt, wavelogCatalogBytes
        case activationUpdatedAt, activationBytes, activationCounts, validators, sourceMetadata
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        clubLogUpdatedAt = try values.decodeIfPresent(Date.self, forKey: .clubLogUpdatedAt)
        lotwUpdatedAt = try values.decodeIfPresent(Date.self, forKey: .lotwUpdatedAt)
        clubLogBytes = try values.decodeIfPresent(Int.self, forKey: .clubLogBytes) ?? 0
        lotwBytes = try values.decodeIfPresent(Int.self, forKey: .lotwBytes) ?? 0
        wavelogCatalogUpdatedAt = try values.decodeIfPresent(Date.self, forKey: .wavelogCatalogUpdatedAt)
        wavelogCatalogBytes = try values.decodeIfPresent(Int.self, forKey: .wavelogCatalogBytes) ?? 0
        activationUpdatedAt = try values.decodeIfPresent([String: Date].self, forKey: .activationUpdatedAt) ?? [:]
        activationBytes = try values.decodeIfPresent([String: Int].self, forKey: .activationBytes) ?? [:]
        activationCounts = try values.decodeIfPresent([String: Int].self, forKey: .activationCounts) ?? [:]
        validators = try values.decodeIfPresent([String: ReferenceDataValidator].self, forKey: .validators) ?? [:]
        sourceMetadata = try values.decodeIfPresent([String: ReferenceSourceMetadata].self, forKey: .sourceMetadata) ?? [:]
    }
}

public enum ReferenceDataUpdaterError: Error, LocalizedError {
    case refreshFailed

    public var errorDescription: String? {
        "One or more reference sources could not be updated; available validated cache was retained."
    }
}

/// Never let URLSession forward a ClubLog query key or Wavelog bearer token to
/// an origin selected by an HTTP redirect (including a TLS downgrade).
final class CredentialRedirectBlocker: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public actor ReferenceDataUpdater {
    private struct DownloadResult {
        var bytes: Int
        var validator: ReferenceDataValidator
        var downloaded: Bool
    }

    private struct ActivationDownloadResult {
        var bytes: Int
        var count: Int
        var validator: ReferenceDataValidator
        var downloaded: Bool
    }

    private let directory: URL
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    public static let activationSourceURLs: [ActivationReferenceKind: URL] = [
        .pota: URL(string: "https://pota.app/all_parks_ext.csv")!,
        .sota: URL(string: "https://www.sotadata.org.uk/summitslist.csv")!,
        .iota: URL(string: "https://www.iota-world.org/islands-on-the-air/downloads/download-file.html?path=groups.json")!,
        .wwff: URL(string: "https://wwff.co/wwff-data/wwff_directory.csv")!,
    ]

    public static func clubLogRequestURL(_ base: URL, apiKey: String) -> URL? {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        guard components?.scheme?.lowercased() == "https", components?.host != nil,
              components?.user == nil, components?.password == nil else { return nil }
        if !apiKey.isEmpty {
            var items = components?.queryItems ?? []
            items.removeAll { $0.name == "api" }
            items.append(URLQueryItem(name: "api", value: apiKey))
            components?.queryItems = items
        }
        return components?.url
    }

    public static func wavelogCatalogURL(_ base: URL) -> URL? {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        let path = components?.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
        guard components?.scheme?.lowercased() == "https", components?.host != nil,
              components?.user == nil, components?.password == nil,
              components?.query == nil, components?.fragment == nil else { return nil }
        let rootPath = path.lowercased().hasSuffix("/index.php")
            ? String(path.dropLast("/index.php".count))
            : (path.lowercased() == "index.php" ? "" : path)
        components?.path = "/" + [rootPath, "index.php/api/v2/catalog"].filter { !$0.isEmpty }.joined(separator: "/")
        return components?.url
    }

    /// Opaque source identity only; never persist the underlying URL/key.
    public static func sourceIdentity(for url: URL, credential: String = "") -> String {
        let digest = SHA256.hash(data: Data((url.absoluteString + "\u{0}" + credential).utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    public static func defaultDirectory() throws -> URL {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return support.appendingPathComponent("OM0RX-xLog/Reference Data", isDirectory: true)
    }

    public init(directory: URL? = nil, session: URLSession = .shared) throws {
        if let directory { self.directory = directory }
        else { self.directory = try Self.defaultDirectory() }
        self.session = session
        try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
    }

    public func currentState() -> ReferenceDataState {
        let url = directory.appendingPathComponent("state.json")
        guard let data = try? Data(contentsOf: url), let state = try? decoder.decode(ReferenceDataState.self, from: data) else { return .init() }
        return state
    }

    public func refresh(clubLogURL: URL, clubLogAPIKey: String, lotwURL: URL) async throws -> ReferenceDataState {
        var state = currentState()
        guard let resolvedClubURL = Self.clubLogRequestURL(clubLogURL, apiKey: clubLogAPIKey) else {
            markAttempt("cty.xml", in: &state)
            markFailure("cty.xml", in: &state)
            try persist(state)
            throw ReferenceDataUpdaterError.refreshFailed
        }
        markAttempt("cty.xml", in: &state)
        markAttempt("lotw-user-activity.csv", in: &state)
        try persist(state)
        let clubValidator = matchingValidator(state.validators["cty.xml"], for: resolvedClubURL)
        let lotwValidator = matchingValidator(state.validators["lotw-user-activity.csv"], for: lotwURL)
        async let club = downloadOutcome(resolvedClubURL, minimumBytes: 10_000, name: "cty.xml", decompressGzip: true, validator: clubValidator, credentialBearing: true)
        async let lotw = downloadOutcome(lotwURL, minimumBytes: 1_000, name: "lotw-user-activity.csv", validator: lotwValidator)
        let (clubOutcome, lotwOutcome) = await (club, lotw)
        state = currentState()
        switch clubOutcome {
        case .success(let result):
            state.clubLogUpdatedAt = Date() // Legacy field means checked, not necessarily downloaded.
            state.clubLogBytes = result.bytes
            state.validators["cty.xml"] = identified(result.validator, for: resolvedClubURL)
            markSuccess("cty.xml", downloaded: result.downloaded, in: &state)
        case .failure: markFailure("cty.xml", in: &state)
        }
        switch lotwOutcome {
        case .success(let result):
            state.lotwUpdatedAt = Date()
            state.lotwBytes = result.bytes
            state.validators["lotw-user-activity.csv"] = identified(result.validator, for: lotwURL)
            markSuccess("lotw-user-activity.csv", downloaded: result.downloaded, in: &state)
        case .failure: markFailure("lotw-user-activity.csv", in: &state)
        }
        try persist(state)
        guard case .success = clubOutcome, case .success = lotwOutcome else {
            throw ReferenceDataUpdaterError.refreshFailed
        }
        return state
    }

    /// Scheduled CTY checks must not also touch LoTW when its own weekly TTL
    /// has not elapsed. Manual combined refresh retains its original behavior.
    public func refreshClubLog(_ clubLogURL: URL, apiKey: String) async throws -> ReferenceDataState {
        var state = currentState()
        guard let url = Self.clubLogRequestURL(clubLogURL, apiKey: apiKey) else {
            markAttempt("cty.xml", in: &state)
            markFailure("cty.xml", in: &state)
            try persist(state)
            throw ReferenceDataUpdaterError.refreshFailed
        }
        markAttempt("cty.xml", in: &state)
        try persist(state)
        let result: DownloadResult
        do {
            result = try await download(url, minimumBytes: 10_000, name: "cty.xml",
                decompressGzip: true,
                validator: matchingValidator(state.validators["cty.xml"], for: url),
                credentialBearing: true)
        } catch {
            state = currentState()
            markFailure("cty.xml", in: &state)
            try persist(state)
            throw ReferenceDataUpdaterError.refreshFailed
        }
        state = currentState()
        state.clubLogUpdatedAt = Date()
        state.clubLogBytes = result.bytes
        state.validators["cty.xml"] = identified(result.validator, for: url)
        markSuccess("cty.xml", downloaded: result.downloaded, in: &state)
        try persist(state)
        return state
    }

    public func refreshLoTW(_ url: URL) async throws -> ReferenceDataState {
        var state = currentState()
        markAttempt("lotw-user-activity.csv", in: &state)
        try persist(state)
        let result: DownloadResult
        do {
            result = try await download(url, minimumBytes: 1_000, name: "lotw-user-activity.csv",
                                        validator: matchingValidator(state.validators["lotw-user-activity.csv"], for: url))
        } catch {
            state = currentState()
            markFailure("lotw-user-activity.csv", in: &state)
            try persist(state)
            throw ReferenceDataUpdaterError.refreshFailed
        }
        state = currentState()
        state.lotwUpdatedAt = Date()
        state.lotwBytes = result.bytes
        state.validators["lotw-user-activity.csv"] = identified(result.validator, for: url)
        markSuccess("lotw-user-activity.csv", downloaded: result.downloaded, in: &state)
        try persist(state)
        return state
    }

    public func refreshWavelogCatalog(baseURL: URL, token: String) async throws -> ReferenceDataState {
        var state = currentState()
        markAttempt("wavelog-catalog.json", in: &state)
        try persist(state)
        // Settings may contain either the installation root or its index.php
        // front controller. Append the catalogue route exactly once.
        guard let url = Self.wavelogCatalogURL(baseURL) else {
            markFailure("wavelog-catalog.json", in: &state)
            try persist(state)
            throw ReferenceDataUpdaterError.refreshFailed
        }
        var request = URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 20)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("OM0RX-xLog/0.2.3", forHTTPHeaderField: "User-Agent")
        let scopedIdentity = Self.sourceIdentity(for: url, credential: token)
        let priorValidator = matchingValidator(state.validators["wavelog-catalog.json"], identity: scopedIdentity)
        apply(priorValidator, to: &request)
        let result: DownloadResult
        do {
            let (data, response) = try await session.data(for: request, delegate: CredentialRedirectBlocker())
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            let destination = directory.appendingPathComponent("wavelog-catalog.json")
            if http.statusCode == 304 {
                guard priorValidator != nil, let cached = try? Data(contentsOf: destination),
                      (try? JSONSerialization.jsonObject(with: cached)) != nil else { throw URLError(.cannotParseResponse) }
                result = DownloadResult(bytes: cached.count,
                                        validator: mergedValidator(from: http, fallback: priorValidator),
                                        downloaded: false)
            } else {
                guard 200..<300 ~= http.statusCode,
                      (try? JSONSerialization.jsonObject(with: data)) != nil else { throw URLError(.cannotParseResponse) }
                try data.write(to: destination, options: .atomic)
                result = DownloadResult(bytes: data.count,
                                        validator: mergedValidator(from: http, fallback: priorValidator),
                                        downloaded: true)
            }
        } catch {
            state = currentState()
            markFailure("wavelog-catalog.json", in: &state)
            try persist(state)
            throw ReferenceDataUpdaterError.refreshFailed
        }
        state = currentState()
        state.wavelogCatalogBytes = result.bytes
        state.wavelogCatalogUpdatedAt = Date()
        var scopedValidator = result.validator
        scopedValidator.sourceIdentity = scopedIdentity
        state.validators["wavelog-catalog.json"] = scopedValidator
        markSuccess("wavelog-catalog.json", downloaded: result.downloaded, in: &state)
        try persist(state)
        return state
    }

    public func refreshActivationDirectories() async throws -> ReferenceDataState {
        var failed = false
        for kind in [ActivationReferenceKind.pota, .sota, .iota, .wwff] {
            do { _ = try await refreshActivationDirectory(kind) }
            catch { failed = true }
        }
        if failed { throw ReferenceDataUpdaterError.refreshFailed }
        return currentState()
    }

    public func refreshActivationDirectory(_ kind: ActivationReferenceKind) async throws -> ReferenceDataState {
        var state = currentState()
        markAttempt(kind.fileName, in: &state)
        try persist(state)
        guard let url = Self.activationSourceURLs[kind] else {
            markFailure(kind.fileName, in: &state)
            try persist(state)
            throw ReferenceDataUpdaterError.refreshFailed
        }
        let result: ActivationDownloadResult
        do {
            result = try await downloadActivationDirectory(url, kind: kind,
                validator: matchingValidator(state.validators[kind.fileName], for: url))
        } catch {
            state = currentState()
            markFailure(kind.fileName, in: &state)
            try persist(state)
            throw ReferenceDataUpdaterError.refreshFailed
        }
        state = currentState()
        let key = kind.rawValue
        state.activationUpdatedAt[key] = Date()
        state.activationBytes[key] = result.bytes
        state.activationCounts[key] = result.count
        state.validators[kind.fileName] = identified(result.validator, for: url)
        markSuccess(kind.fileName, downloaded: result.downloaded, in: &state)
        try persist(state)
        return state
    }

    private func download(_ url: URL, minimumBytes: Int, name: String, decompressGzip: Bool = false,
                          validator: ReferenceDataValidator? = nil,
                          credentialBearing: Bool = false) async throws -> DownloadResult {
        if credentialBearing {
            guard url.scheme?.lowercased() == "https", url.host != nil,
                  url.user == nil, url.password == nil else { throw URLError(.unsupportedURL) }
        }
        var request = URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30)
        request.setValue("OM0RX-xLog/0.2.3", forHTTPHeaderField: "User-Agent")
        apply(validator, to: &request)
        let (data, response) = try await (credentialBearing
            ? session.data(for: request, delegate: CredentialRedirectBlocker())
            : session.data(for: request))
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        let destination = directory.appendingPathComponent(name)
        if http.statusCode == 304 {
            guard validator != nil, let cached = try? Data(contentsOf: destination), cached.count >= minimumBytes else {
                throw URLError(.cannotParseResponse)
            }
            try validateReference(cached, name: name, xmlURL: destination)
            return DownloadResult(bytes: cached.count, validator: mergedValidator(from: http, fallback: validator), downloaded: false)
        }
        guard 200..<300 ~= http.statusCode, data.count >= minimumBytes else {
            throw URLError(.cannotParseResponse)
        }
        let payload = decompressGzip && data.starts(with: [0x1f, 0x8b]) ? try gunzip(data) : data
        let temporary = directory.appendingPathComponent(".\(name).download")
        try payload.write(to: temporary, options: .atomic)
        defer { try? FileManager.default.removeItem(at: temporary) }
        try validateReference(payload, name: name, xmlURL: temporary)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
        } else {
            try FileManager.default.moveItem(at: temporary, to: destination)
        }
        return DownloadResult(bytes: payload.count, validator: mergedValidator(from: http, fallback: validator), downloaded: true)
    }

    private func validateReference(_ data: Data, name: String, xmlURL: URL) throws {
        if name == "cty.xml" {
            // XML well-formedness alone is not enough: the resolver accepts an
            // empty document. Demand usable rules from three independent DXCC
            // regions so an error page or partial XML cannot replace the cache.
            guard let resolver = try? CTYResolver(xmlURL: xmlURL),
                  let us = resolver.resolve("K1ABC"),
                  let germany = resolver.resolve("DL1ABC"),
                  let japan = resolver.resolve("JA1ABC"),
                  Set([us.adif, germany.adif, japan.adif]).count == 3 else {
                throw URLError(.cannotParseResponse)
            }
        } else if name == "lotw-user-activity.csv" {
            guard let text = String(data: data, encoding: .utf8) else { throw URLError(.cannotParseResponse) }
            let lines = text.split(whereSeparator: \.isNewline)
            var calls = Set<String>()
            var records = 0
            for line in lines {
                let first = line.split(separator: ",", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
                let call = first.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "\""))).uppercased()
                guard call.count >= 3, call.count <= 16,
                      call.contains(where: \.isLetter), call.contains(where: \.isNumber),
                      call.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "/") }),
                      line.contains(",") else { continue }
                records += 1
                calls.insert(call)
            }
            // The public activity file is a large callsign table, not an
            // arbitrary text response or a repeated header line.
            guard calls.count >= 20, records * 4 >= lines.count * 3 else {
                throw URLError(.cannotParseResponse)
            }
        }
    }

    private func downloadActivationDirectory(_ url: URL, kind: ActivationReferenceKind, validator: ReferenceDataValidator?) async throws -> ActivationDownloadResult {
        var request = URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 90)
        request.setValue("OM0RX-xLog/0.2.3", forHTTPHeaderField: "User-Agent")
        apply(validator, to: &request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        let destination = directory.appendingPathComponent(kind.fileName)
        let payload: Data
        if http.statusCode == 304 {
            guard validator != nil, let cached = try? Data(contentsOf: destination), cached.count >= 10_000 else {
                throw URLError(.cannotParseResponse)
            }
            payload = cached
        } else {
            guard 200..<300 ~= http.statusCode, data.count >= 10_000 else {
                throw URLError(.cannotParseResponse)
            }
            payload = data
        }
        let records = try ActivationReferenceDirectory.parse(data: payload, kind: kind)
        guard records.count >= minimumActivationCount(for: kind) else { throw URLError(.cannotParseResponse) }

        if http.statusCode != 304 {
            let temporary = directory.appendingPathComponent(".\(kind.fileName).download")
            try payload.write(to: temporary, options: .atomic)
            if FileManager.default.fileExists(atPath: destination.path) {
                _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
            } else {
                try FileManager.default.moveItem(at: temporary, to: destination)
            }
        }
        return ActivationDownloadResult(
            bytes: payload.count,
            count: records.count,
            validator: mergedValidator(from: http, fallback: validator),
            downloaded: http.statusCode != 304
        )
    }

    private func downloadOutcome(_ url: URL, minimumBytes: Int, name: String,
                                 decompressGzip: Bool = false,
                                 validator: ReferenceDataValidator?,
                                 credentialBearing: Bool = false) async -> Result<DownloadResult, Error> {
        do {
            return .success(try await download(url, minimumBytes: minimumBytes, name: name,
                                               decompressGzip: decompressGzip, validator: validator,
                                               credentialBearing: credentialBearing))
        } catch { return .failure(error) }
    }

    private func markAttempt(_ source: String, in state: inout ReferenceDataState) {
        var metadata = state.sourceMetadata[source] ?? .init()
        metadata.lastAttemptAt = Date()
        state.sourceMetadata[source] = metadata
    }

    private func markSuccess(_ source: String, downloaded: Bool, in state: inout ReferenceDataState) {
        var metadata = state.sourceMetadata[source] ?? .init()
        let now = Date()
        metadata.lastAttemptAt = metadata.lastAttemptAt ?? now
        metadata.checkedAt = now
        if downloaded { metadata.downloadedAt = now }
        metadata.status = downloaded ? "downloaded" : "up_to_date"
        metadata.lastError = nil
        state.sourceMetadata[source] = metadata
    }

    private func markFailure(_ source: String, in state: inout ReferenceDataState) {
        var metadata = state.sourceMetadata[source] ?? .init()
        metadata.lastAttemptAt = metadata.lastAttemptAt ?? Date()
        metadata.status = "failed"
        // Never persist an Error description: URLSession errors can include
        // source URLs, query-string API keys or server-supplied text.
        metadata.lastError = "download_or_validation_failed"
        state.sourceMetadata[source] = metadata
    }

    private func persist(_ state: ReferenceDataState) throws {
        try encoder.encode(state).write(to: directory.appendingPathComponent("state.json"), options: .atomic)
    }

    private func minimumActivationCount(for kind: ActivationReferenceKind) -> Int {
        switch kind {
        case .iota: return 1_000
        case .pota, .sota, .wwff: return 10_000
        case .castle: return 1
        }
    }

    private func matchingValidator(_ validator: ReferenceDataValidator?, for url: URL) -> ReferenceDataValidator? {
        matchingValidator(validator, identity: Self.sourceIdentity(for: url))
    }

    private func matchingValidator(_ validator: ReferenceDataValidator?, identity: String) -> ReferenceDataValidator? {
        guard validator?.sourceIdentity == identity else { return nil }
        return validator
    }

    private func identified(_ validator: ReferenceDataValidator, for url: URL) -> ReferenceDataValidator {
        var value = validator
        value.sourceIdentity = Self.sourceIdentity(for: url)
        return value
    }

    private func apply(_ validator: ReferenceDataValidator?, to request: inout URLRequest) {
        if let eTag = validator?.eTag, !eTag.isEmpty {
            request.setValue(eTag, forHTTPHeaderField: "If-None-Match")
        }
        if let lastModified = validator?.lastModified, !lastModified.isEmpty {
            request.setValue(lastModified, forHTTPHeaderField: "If-Modified-Since")
        }
    }

    private func mergedValidator(from response: HTTPURLResponse, fallback: ReferenceDataValidator?) -> ReferenceDataValidator {
        ReferenceDataValidator(
            eTag: response.value(forHTTPHeaderField: "ETag") ?? fallback?.eTag,
            lastModified: response.value(forHTTPHeaderField: "Last-Modified") ?? fallback?.lastModified
        )
    }

    private func gunzip(_ data: Data) throws -> Data {
        var stream = z_stream()
        guard inflateInit2_(&stream, 15 + 32, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
            throw URLError(.cannotDecodeContentData)
        }
        defer { inflateEnd(&stream) }
        return try data.withUnsafeBytes { input in
            guard let base = input.bindMemory(to: Bytef.self).baseAddress else { return Data() }
            stream.next_in = UnsafeMutablePointer(mutating: base)
            stream.avail_in = uInt(data.count)
            var output = Data()
            var status: Int32 = Z_OK
            repeat {
                var buffer = [UInt8](repeating: 0, count: 64 * 1024)
                let produced = buffer.withUnsafeMutableBytes { target -> Int in
                    stream.next_out = target.bindMemory(to: Bytef.self).baseAddress
                    stream.avail_out = uInt(target.count)
                    status = inflate(&stream, Z_NO_FLUSH)
                    return target.count - Int(stream.avail_out)
                }
                output.append(contentsOf: buffer.prefix(produced))
            } while status == Z_OK
            guard status == Z_STREAM_END else { throw URLError(.cannotDecodeContentData) }
            return output
        }
    }
}
