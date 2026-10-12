import Foundation
import zlib

public struct ReferenceDataValidator: Codable, Equatable, Sendable {
    public var eTag: String?
    public var lastModified: String?

    public init(eTag: String? = nil, lastModified: String? = nil) {
        self.eTag = eTag
        self.lastModified = lastModified
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

    public init(clubLogUpdatedAt: Date? = nil, lotwUpdatedAt: Date? = nil, clubLogBytes: Int = 0, lotwBytes: Int = 0, wavelogCatalogUpdatedAt: Date? = nil, wavelogCatalogBytes: Int = 0, activationUpdatedAt: [String: Date] = [:], activationBytes: [String: Int] = [:], activationCounts: [String: Int] = [:], validators: [String: ReferenceDataValidator] = [:]) {
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
    }

    private enum CodingKeys: String, CodingKey {
        case clubLogUpdatedAt, lotwUpdatedAt, clubLogBytes, lotwBytes, wavelogCatalogUpdatedAt, wavelogCatalogBytes
        case activationUpdatedAt, activationBytes, activationCounts, validators
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
    }
}

public actor ReferenceDataUpdater {
    private struct DownloadResult {
        var bytes: Int
        var validator: ReferenceDataValidator
    }

    private struct ActivationDownloadResult {
        var bytes: Int
        var count: Int
        var validator: ReferenceDataValidator
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
        var components = URLComponents(url: clubLogURL, resolvingAgainstBaseURL: false)
        if !clubLogAPIKey.isEmpty {
            var items = components?.queryItems ?? []
            items.removeAll { $0.name == "api" }
            items.append(URLQueryItem(name: "api", value: clubLogAPIKey))
            components?.queryItems = items
        }
        guard let resolvedClubURL = components?.url else { throw URLError(.badURL) }
        var state = currentState()
        let clubValidator = state.validators["cty.xml"]
        let lotwValidator = state.validators["lotw-user-activity.csv"]
        async let club = download(resolvedClubURL, minimumBytes: 10_000, name: "cty.xml", decompressGzip: true, validator: clubValidator)
        async let lotw = download(lotwURL, minimumBytes: 1_000, name: "lotw-user-activity.csv", validator: lotwValidator)
        let (clubResult, lotwResult) = try await (club, lotw)
        let now = Date()
        state.clubLogUpdatedAt = now
        state.lotwUpdatedAt = now
        state.clubLogBytes = clubResult.bytes
        state.lotwBytes = lotwResult.bytes
        state.validators["cty.xml"] = clubResult.validator
        state.validators["lotw-user-activity.csv"] = lotwResult.validator
        let data = try encoder.encode(state)
        try data.write(to: directory.appendingPathComponent("state.json"), options: .atomic)
        return state
    }

    public func refreshLoTW(_ url: URL) async throws -> ReferenceDataState {
        var state = currentState()
        let result = try await download(url, minimumBytes: 1_000, name: "lotw-user-activity.csv", validator: state.validators["lotw-user-activity.csv"])
        state.lotwUpdatedAt = Date()
        state.lotwBytes = result.bytes
        state.validators["lotw-user-activity.csv"] = result.validator
        try encoder.encode(state).write(to: directory.appendingPathComponent("state.json"), options: .atomic)
        return state
    }

    public func refreshWavelogCatalog(baseURL: URL, token: String) async throws -> ReferenceDataState {
        let root = baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: root + "/index.php/api/v2/catalog") else { throw URLError(.badURL) }
        var request = URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 20)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("OM0RX-xLog/0.2.0", forHTTPHeaderField: "User-Agent")
        var state = currentState()
        apply(state.validators["wavelog-catalog.json"], to: &request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        let destination = directory.appendingPathComponent("wavelog-catalog.json")
        if http.statusCode == 304 {
            guard let cached = try? Data(contentsOf: destination),
                  (try? JSONSerialization.jsonObject(with: cached)) != nil else { throw URLError(.cannotParseResponse) }
            state.wavelogCatalogBytes = cached.count
        } else {
            guard 200..<300 ~= http.statusCode,
                  (try? JSONSerialization.jsonObject(with: data)) != nil else { throw URLError(.cannotParseResponse) }
            try data.write(to: destination, options: .atomic)
            state.wavelogCatalogBytes = data.count
        }
        state.wavelogCatalogUpdatedAt = Date()
        state.validators["wavelog-catalog.json"] = mergedValidator(from: http, fallback: state.validators["wavelog-catalog.json"])
        try encoder.encode(state).write(to: directory.appendingPathComponent("state.json"), options: .atomic)
        return state
    }

    public func refreshActivationDirectories() async throws -> ReferenceDataState {
        var state = currentState()
        for kind in [ActivationReferenceKind.pota, .sota, .iota, .wwff] {
            state = try await refreshActivationDirectory(kind, state: state)
        }
        return state
    }

    public func refreshActivationDirectory(_ kind: ActivationReferenceKind) async throws -> ReferenceDataState {
        try await refreshActivationDirectory(kind, state: currentState())
    }

    private func refreshActivationDirectory(_ kind: ActivationReferenceKind, state initialState: ReferenceDataState) async throws -> ReferenceDataState {
        guard let url = Self.activationSourceURLs[kind] else { throw URLError(.badURL) }
        var state = initialState
        let result = try await downloadActivationDirectory(url, kind: kind, validator: state.validators[kind.fileName])
        let key = kind.rawValue
        state.activationUpdatedAt[key] = Date()
        state.activationBytes[key] = result.bytes
        state.activationCounts[key] = result.count
        state.validators[kind.fileName] = result.validator
        try encoder.encode(state).write(to: directory.appendingPathComponent("state.json"), options: .atomic)
        return state
    }

    private func download(_ url: URL, minimumBytes: Int, name: String, decompressGzip: Bool = false, validator: ReferenceDataValidator? = nil) async throws -> DownloadResult {
        var request = URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30)
        request.setValue("OM0RX-xLog/0.2.0", forHTTPHeaderField: "User-Agent")
        apply(validator, to: &request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        let destination = directory.appendingPathComponent(name)
        if http.statusCode == 304 {
            guard let cached = try? Data(contentsOf: destination), cached.count >= minimumBytes else {
                throw URLError(.cannotParseResponse)
            }
            return DownloadResult(bytes: cached.count, validator: mergedValidator(from: http, fallback: validator))
        }
        guard 200..<300 ~= http.statusCode, data.count >= minimumBytes else {
            throw URLError(.cannotParseResponse)
        }
        let payload = decompressGzip && data.starts(with: [0x1f, 0x8b]) ? try gunzip(data) : data
        if name == "cty.xml", !payload.starts(with: Data("<?xml".utf8)), payload.range(of: Data("<clublog".utf8)) == nil {
            throw URLError(.cannotParseResponse)
        }
        let temporary = directory.appendingPathComponent(".\(name).download")
        try payload.write(to: temporary, options: .atomic)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
        } else {
            try FileManager.default.moveItem(at: temporary, to: destination)
        }
        return DownloadResult(bytes: payload.count, validator: mergedValidator(from: http, fallback: validator))
    }

    private func downloadActivationDirectory(_ url: URL, kind: ActivationReferenceKind, validator: ReferenceDataValidator?) async throws -> ActivationDownloadResult {
        var request = URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 90)
        request.setValue("OM0RX-xLog/0.2.0", forHTTPHeaderField: "User-Agent")
        apply(validator, to: &request)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        let destination = directory.appendingPathComponent(kind.fileName)
        let payload: Data
        if http.statusCode == 304 {
            guard let cached = try? Data(contentsOf: destination), cached.count >= 10_000 else {
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
            validator: mergedValidator(from: http, fallback: validator)
        )
    }

    private func minimumActivationCount(for kind: ActivationReferenceKind) -> Int {
        switch kind {
        case .iota: return 1_000
        case .pota, .sota, .wwff: return 10_000
        case .castle: return 1
        }
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
