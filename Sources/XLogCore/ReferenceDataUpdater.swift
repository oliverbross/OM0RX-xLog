import Foundation
import zlib

public struct ReferenceDataState: Codable, Equatable, Sendable {
    public var clubLogUpdatedAt: Date?
    public var lotwUpdatedAt: Date?
    public var clubLogBytes = 0
    public var lotwBytes = 0
    public var wavelogCatalogUpdatedAt: Date?
    public var wavelogCatalogBytes = 0

    public init(clubLogUpdatedAt: Date? = nil, lotwUpdatedAt: Date? = nil, clubLogBytes: Int = 0, lotwBytes: Int = 0, wavelogCatalogUpdatedAt: Date? = nil, wavelogCatalogBytes: Int = 0) {
        self.clubLogUpdatedAt = clubLogUpdatedAt
        self.lotwUpdatedAt = lotwUpdatedAt
        self.clubLogBytes = clubLogBytes
        self.lotwBytes = lotwBytes
        self.wavelogCatalogUpdatedAt = wavelogCatalogUpdatedAt
        self.wavelogCatalogBytes = wavelogCatalogBytes
    }

    private enum CodingKeys: String, CodingKey {
        case clubLogUpdatedAt, lotwUpdatedAt, clubLogBytes, lotwBytes, wavelogCatalogUpdatedAt, wavelogCatalogBytes
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        clubLogUpdatedAt = try values.decodeIfPresent(Date.self, forKey: .clubLogUpdatedAt)
        lotwUpdatedAt = try values.decodeIfPresent(Date.self, forKey: .lotwUpdatedAt)
        clubLogBytes = try values.decodeIfPresent(Int.self, forKey: .clubLogBytes) ?? 0
        lotwBytes = try values.decodeIfPresent(Int.self, forKey: .lotwBytes) ?? 0
        wavelogCatalogUpdatedAt = try values.decodeIfPresent(Date.self, forKey: .wavelogCatalogUpdatedAt)
        wavelogCatalogBytes = try values.decodeIfPresent(Int.self, forKey: .wavelogCatalogBytes) ?? 0
    }
}

public actor ReferenceDataUpdater {
    private let directory: URL
    private let session: URLSession
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

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
        async let club = download(resolvedClubURL, minimumBytes: 10_000, name: "cty.xml", decompressGzip: true)
        async let lotw = download(lotwURL, minimumBytes: 1_000, name: "lotw-user-activity.csv")
        let (clubBytes, lotwBytes) = try await (club, lotw)
        let now = Date()
        var state = currentState()
        state.clubLogUpdatedAt = now
        state.lotwUpdatedAt = now
        state.clubLogBytes = clubBytes
        state.lotwBytes = lotwBytes
        let data = try encoder.encode(state)
        try data.write(to: directory.appendingPathComponent("state.json"), options: .atomic)
        return state
    }

    public func refreshLoTW(_ url: URL) async throws -> ReferenceDataState {
        let bytes = try await download(url, minimumBytes: 1_000, name: "lotw-user-activity.csv")
        var state = currentState()
        state.lotwUpdatedAt = Date()
        state.lotwBytes = bytes
        try encoder.encode(state).write(to: directory.appendingPathComponent("state.json"), options: .atomic)
        return state
    }

    public func refreshWavelogCatalog(baseURL: URL, token: String) async throws -> ReferenceDataState {
        let root = baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: root + "/index.php/api/v2/catalog") else { throw URLError(.badURL) }
        var request = URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 20)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("OM0RX-xLog/0.1.0", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode,
              (try? JSONSerialization.jsonObject(with: data)) != nil else { throw URLError(.cannotParseResponse) }
        try data.write(to: directory.appendingPathComponent("wavelog-catalog.json"), options: .atomic)
        var state = currentState()
        state.wavelogCatalogUpdatedAt = Date()
        state.wavelogCatalogBytes = data.count
        try encoder.encode(state).write(to: directory.appendingPathComponent("state.json"), options: .atomic)
        return state
    }

    private func download(_ url: URL, minimumBytes: Int, name: String, decompressGzip: Bool = false) async throws -> Int {
        var request = URLRequest(url: url, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30)
        request.setValue("OM0RX-xLog/0.1.0", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode, data.count >= minimumBytes else {
            throw URLError(.cannotParseResponse)
        }
        let payload = decompressGzip && data.starts(with: [0x1f, 0x8b]) ? try gunzip(data) : data
        if name == "cty.xml", !payload.starts(with: Data("<?xml".utf8)), payload.range(of: Data("<clublog".utf8)) == nil {
            throw URLError(.cannotParseResponse)
        }
        let temporary = directory.appendingPathComponent(".\(name).download")
        let destination = directory.appendingPathComponent(name)
        try payload.write(to: temporary, options: .atomic)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
        } else {
            try FileManager.default.moveItem(at: temporary, to: destination)
        }
        return payload.count
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
