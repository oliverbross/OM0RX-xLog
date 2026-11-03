import Foundation
#if os(Windows)
import WinSDK
#elseif os(Linux)
import Glibc
#else
import Darwin
#endif

public enum ActivationReferenceKind: String, CaseIterable, Codable, Hashable, Sendable {
    case pota
    case sota
    case iota
    case wwff
    case castle

    public var label: String { rawValue.uppercased() }

    public var fileName: String {
        switch self {
        case .pota: return "pota-parks.csv"
        case .sota: return "sota-summits.csv"
        case .iota: return "iota-groups.json"
        case .wwff: return "wwff-directory.csv"
        case .castle: return "castle-cache.json"
        }
    }
}

public struct ActivationReference: Codable, Equatable, Hashable, Sendable {
    public var kind: ActivationReferenceKind
    public var reference: String
    public var name: String
    public var detail: String
    public var latitude: Double?
    public var longitude: Double?
    public var grid: String
    public var points: Int?
    public var validFrom: String?
    public var validTo: String?
    public var association: String?
    public var pointSource: String?

    public init(
        kind: ActivationReferenceKind,
        reference: String,
        name: String,
        detail: String = "",
        latitude: Double? = nil,
        longitude: Double? = nil,
        grid: String = "", points: Int? = nil, validFrom: String? = nil, validTo: String? = nil,
        association: String? = nil, pointSource: String? = nil
    ) {
        self.kind = kind
        self.reference = reference
        self.name = name
        self.detail = detail
        self.latitude = latitude
        self.longitude = longitude
        self.grid = grid
        self.points=points; self.validFrom=validFrom; self.validTo=validTo; self.association=association; self.pointSource=pointSource
    }
}

public struct ActivationReferenceDirectory: Sendable {
    private var records: [ActivationReferenceKind: [String: ActivationReference]]

    /// Metadata-only cache identity. Preserve native subsecond precision and
    /// physical identity so an equal-size atomic replacement cannot reuse a view.
    public static func fingerprint(directory: URL) throws -> String {
        try ActivationReferenceKind.allCases.map { kind in
            let url = directory.appendingPathComponent(kind.fileName)
            guard let path = LocalFilePath.nativeFileSystemPath(for: url) else {
                throw CocoaError(.fileReadInvalidFileName)
            }
            #if os(Windows)
            let handle = path.withCString(encodedAs: UTF16.self) {
                CreateFileW($0, DWORD(FILE_READ_ATTRIBUTES),
                    DWORD(FILE_SHARE_READ) | DWORD(FILE_SHARE_WRITE) | DWORD(FILE_SHARE_DELETE),
                    nil, DWORD(OPEN_EXISTING), DWORD(FILE_ATTRIBUTE_NORMAL), nil)
            }
            guard let handle, handle != HANDLE(bitPattern: -1) else {
                let code = GetLastError()
                if code == DWORD(ERROR_FILE_NOT_FOUND) || code == DWORD(ERROR_PATH_NOT_FOUND) { return "\(kind.rawValue):missing" }
                throw CocoaError(.fileReadNoPermission)
            }
            defer { CloseHandle(handle) }
            var info = BY_HANDLE_FILE_INFORMATION()
            guard GetFileInformationByHandle(handle, &info) else { throw CocoaError(.fileReadUnknown) }
            return "\(kind.rawValue):\(info.dwVolumeSerialNumber):\(info.nFileIndexHigh):\(info.nFileIndexLow):\(info.nFileSizeHigh):\(info.nFileSizeLow):\(info.ftLastWriteTime.dwHighDateTime):\(info.ftLastWriteTime.dwLowDateTime)"
            #else
            var info = stat()
            guard stat(path, &info) == 0 else {
                if errno == ENOENT || errno == ENOTDIR { return "\(kind.rawValue):missing" }
                throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
            }
            #if os(Linux)
            let modified = info.st_mtim
            #else
            let modified = info.st_mtimespec
            #endif
            return "\(kind.rawValue):\(info.st_dev):\(info.st_ino):\(info.st_size):\(modified.tv_sec):\(modified.tv_nsec)"
            #endif
        }.joined(separator: ";")
    }

    public init(directory: URL, kinds: Set<ActivationReferenceKind> = Set(ActivationReferenceKind.allCases)) throws {
        var loaded: [ActivationReferenceKind: [String: ActivationReference]] = [:]
        for kind in ActivationReferenceKind.allCases where kinds.contains(kind) {
            let url = directory.appendingPathComponent(kind.fileName)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            let data = try Data(contentsOf: url, options: .mappedIfSafe)
            let parsed = try Self.parse(data: data, kind: kind)
            loaded[kind] = Dictionary(parsed.map { (Self.normalize($0.reference), $0) }, uniquingKeysWith: { first, _ in first })
        }
        records = loaded
    }

    public init(records: [ActivationReference] = []) {
        self.records = Dictionary(grouping: records, by: \.kind).mapValues { values in
            Dictionary(values.map { (Self.normalize($0.reference), $0) }, uniquingKeysWith: { first, _ in first })
        }
    }

    public func exactMatch(_ value: String, kind: ActivationReferenceKind) -> ActivationReference? {
        records[kind]?[Self.normalize(value)]
    }

    public func hasData(for kind: ActivationReferenceKind) -> Bool {
        !(records[kind]?.isEmpty ?? true)
    }

    public func count(for kind: ActivationReferenceKind) -> Int {
        records[kind]?.count ?? 0
    }

    public func prefixMatches(_ value: String, kind: ActivationReferenceKind, limit: Int = 5) -> [ActivationReference] {
        let prefix = Self.normalize(value)
        guard prefix.count >= 2, let source = records[kind] else { return [] }
        return source
            .filter { $0.key.hasPrefix(prefix) }
            .sorted { $0.key < $1.key }
            .prefix(max(0, limit))
            .map(\.value)
    }

    public static func parse(data: Data, kind: ActivationReferenceKind) throws -> [ActivationReference] {
        switch kind {
        case .pota: return try parsePOTA(data)
        case .sota: return try parseSOTA(data)
        case .iota: return try parseIOTA(data)
        case .wwff: return try parseWWFF(data)
        case .castle:
            return try JSONDecoder().decode([ActivationReference].self, from: data)
        }
    }

    private static func parsePOTA(_ data: Data) throws -> [ActivationReference] {
        let rows = try csvRows(data)
        guard let headerIndex = rows.firstIndex(where: { $0.first?.lowercased() == "reference" }) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let header = columnMap(rows[headerIndex])
        return rows.dropFirst(headerIndex + 1).compactMap { row in
            guard let reference = value("reference", row, header),
                  let name = value("name", row, header), !reference.isEmpty, !name.isEmpty else { return nil }
            let location = value("locationdesc", row, header) ?? ""
            let active = value("active", row, header) ?? ""
            let detail = [location, active == "1" ? "Active" : "Inactive"].filter { !$0.isEmpty }.joined(separator: " · ")
            return ActivationReference(
                kind: .pota,
                reference: normalize(reference),
                name: name,
                detail: detail,
                latitude: Double(value("latitude", row, header) ?? ""),
                longitude: Double(value("longitude", row, header) ?? ""),
                grid: value("grid", row, header) ?? ""
            )
        }
    }

    private static func parseSOTA(_ data: Data) throws -> [ActivationReference] {
        let rows = try csvRows(data)
        guard let headerIndex = rows.firstIndex(where: { $0.first?.lowercased() == "summitcode" }) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let header = columnMap(rows[headerIndex])
        return rows.dropFirst(headerIndex + 1).compactMap { row in
            guard let reference = value("summitcode", row, header),
                  let name = value("summitname", row, header), !reference.isEmpty, !name.isEmpty else { return nil }
            let association = value("associationname", row, header) ?? ""
            let region = value("regionname", row, header) ?? ""
            let detail = [association, region].filter { !$0.isEmpty }.joined(separator: " · ")
            return ActivationReference(
                kind: .sota,
                reference: normalize(reference),
                name: name,
                detail: detail,
                latitude: Double(value("latitude", row, header) ?? ""),
                longitude: Double(value("longitude", row, header) ?? ""),
                points: value("points",row,header).flatMap(Int.init),
                validFrom: value("validfrom",row,header), validTo: value("validto",row,header),
                association: association.isEmpty ? nil : association,
                pointSource: "https://www.sotadata.org.uk/summitslist.csv"
            )
        }
    }

    private static func parseIOTA(_ data: Data) throws -> [ActivationReference] {
        guard let objects = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return objects.compactMap { object in
            guard let reference = object["refno"] as? String,
                  let name = object["name"] as? String, !reference.isEmpty, !name.isEmpty else { return nil }
            let dxcc = object["dxcc_num"] as? String ?? ""
            let latitude = midpoint(object["latitude_min"], object["latitude_max"])
            let longitude = midpoint(object["longitude_min"], object["longitude_max"], longitude: true)
            return ActivationReference(
                kind: .iota,
                reference: normalize(reference),
                name: name,
                detail: dxcc.isEmpty ? "" : "DXCC #\(dxcc)",
                latitude: latitude,
                longitude: longitude
            )
        }
    }

    private static func parseWWFF(_ data: Data) throws -> [ActivationReference] {
        let rows = try csvRows(data)
        guard let headerIndex = rows.firstIndex(where: { $0.first?.lowercased() == "reference" }) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let header = columnMap(rows[headerIndex])
        return rows.dropFirst(headerIndex + 1).compactMap { row in
            guard let reference = value("reference", row, header),
                  let name = value("name", row, header), !reference.isEmpty, !name.isEmpty else { return nil }
            let country = value("country", row, header) ?? ""
            let status = value("status", row, header) ?? ""
            let detail = [country, status.capitalized].filter { !$0.isEmpty && $0 != "-" }.joined(separator: " · ")
            return ActivationReference(
                kind: .wwff,
                reference: normalize(reference),
                name: name,
                detail: detail,
                latitude: Double(value("latitude", row, header) ?? ""),
                longitude: Double(value("longitude", row, header) ?? ""),
                grid: value("iarulocator", row, header) ?? ""
            )
        }
    }

    private static func csvRows(_ data: Data) throws -> [[String]] {
        guard let text = String(data: data, encoding: .utf8) else { throw CocoaError(.fileReadInapplicableStringEncoding) }
        return text.split(whereSeparator: \.isNewline).map(parseCSVLine)
    }

    private static func parseCSVLine(_ line: Substring) -> [String] {
        var fields: [String] = []
        var field = ""
        var quoted = false
        var index = line.startIndex
        while index < line.endIndex {
            let character = line[index]
            if character == "\"" {
                let next = line.index(after: index)
                if quoted, next < line.endIndex, line[next] == "\"" {
                    field.append("\"")
                    index = line.index(after: next)
                    continue
                }
                quoted.toggle()
            } else if character == ",", !quoted {
                fields.append(field.trimmingCharacters(in: .whitespaces))
                field = ""
            } else {
                field.append(character)
            }
            index = line.index(after: index)
        }
        fields.append(field.trimmingCharacters(in: .whitespaces))
        return fields
    }

    private static func columnMap(_ header: [String]) -> [String: Int] {
        Dictionary(uniqueKeysWithValues: header.enumerated().map { ($0.element.lowercased(), $0.offset) })
    }

    private static func value(_ name: String, _ row: [String], _ header: [String: Int]) -> String? {
        guard let index = header[name], row.indices.contains(index) else { return nil }
        return row[index].trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func midpoint(_ minimum: Any?, _ maximum: Any?, longitude: Bool = false) -> Double? {
        func number(_ value: Any?) -> Double? {
            if let value = value as? Double { return value }
            if let value = value as? NSNumber { return value.doubleValue }
            if let value = value as? String { return Double(value) }
            return nil
        }
        let limit = longitude ? 180.0 : 90.0
        guard let minimum = number(minimum), let maximum = number(maximum),
              minimum.isFinite, maximum.isFinite, abs(minimum) <= limit, abs(maximum) <= limit else { return nil }
        if longitude, abs(maximum - minimum) > 180 {
            let centre = (minimum + maximum + 360) / 2
            return centre > 180 ? centre - 360 : centre
        }
        return (minimum + maximum) / 2
    }

    private static func normalize(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
    }
}
