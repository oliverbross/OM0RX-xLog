import Foundation

public enum ContestPackagedCountryReferenceError: Error, Equatable {
    case missingResource
    case invalidResource
    case digestMismatch
    case identityMismatch
    case recordCountMismatch(expected: Int, actual: Int)
}

/// Fixed loader for the reviewed CQ WW 2026 country-reference snapshot. Runtime discovery and
/// caller-selected files are intentionally unsupported.
public enum ContestPackagedCountryReferenceLoader {
    public static let resourceSHA256 = "3f4e9752188f47677661a156790ddbbf1ac8afde8b282d3e2ebbbc9f68ba070b"
    public static let recordCount = 362
    private static let maximumBytes = 512 * 1024

    public static func cqww2026() throws -> ContestCountryMultiplierReference {
        guard let root = Bundle.module.resourceURL else {
            throw ContestPackagedCountryReferenceError.missingResource
        }
        let url = root.appendingPathComponent("CountryReferences", isDirectory: true)
            .appendingPathComponent("cqww-2026-country-reference.json", isDirectory: false)
        let values: URLResourceValues
        do {
            values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        } catch {
            throw ContestPackagedCountryReferenceError.missingResource
        }
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, (1...maximumBytes).contains(size) else {
            throw ContestPackagedCountryReferenceError.invalidResource
        }
        let data: Data
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            data = try handle.read(upToCount: maximumBytes + 1) ?? Data()
        } catch {
            throw ContestPackagedCountryReferenceError.missingResource
        }
        guard data.count == size, ContestSCPIndex.sha256(data) == resourceSHA256 else {
            throw ContestPackagedCountryReferenceError.digestMismatch
        }
        let reference: ContestCountryMultiplierReference
        do { reference = try JSONDecoder().decode(ContestCountryMultiplierReference.self, from: data) }
        catch { throw ContestPackagedCountryReferenceError.invalidResource }
        guard reference.identity == .init(id: "cqww-country", version: "2026.1-complete"),
              reference.requiredReferenceDataVersion == "bundled-cty-fnv64-cf9c48a44d4b5e66" else {
            throw ContestPackagedCountryReferenceError.identityMismatch
        }
        guard reference.records.count == recordCount else {
            throw ContestPackagedCountryReferenceError.recordCountMismatch(
                expected: recordCount, actual: reference.records.count)
        }
        return reference
    }
}
