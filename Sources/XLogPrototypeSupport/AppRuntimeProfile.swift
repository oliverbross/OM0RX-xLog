import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif

public enum AppRuntimeProfile: Equatable, Sendable {
    case production
    case contestingTest(supportRoot: URL)

    static let contestingBundleIdentifier = "com.oliverbross.xlog.contesting-test"
    public static let contestingArgument = "--runtime-profile=contesting-test"
    public static let localAcceptanceArgument = "--local-ui-acceptance"
    public static let offlineAcceptancePrefix = "--offline-contest-acceptance="
    static let contestingIdentityPrefix = "com.oliverbross.OM0RXXLog.ContestingTest.Integration."

    private static let lock = NSLock()
    nonisolated(unsafe) private static var configured: AppRuntimeProfile?

    static var current: AppRuntimeProfile {
        lock.withLock { configured ?? .production }
    }

    public static func configure(_ profile: AppRuntimeProfile) throws {
        try lock.withLock {
            guard configured == nil else { throw WorkerFailure("runtime_profile_locked", "Runtime profile was already resolved.") }
            configured = profile
        }
    }

    public static func resolve(arguments: [String], executableURL: URL,
                        fileManager: FileManager = .default) throws -> AppRuntimeProfile {
        let profileArguments = arguments.filter { $0.hasPrefix("--runtime-profile=") }
        guard profileArguments.count <= 1 else { throw WorkerFailure("runtime_profile_invalid", "Runtime profile is invalid.") }
        let contents = executableURL.deletingLastPathComponent().deletingLastPathComponent()
        let infoURL = contents.appendingPathComponent("Info.plist")
        let bundleIdentifier: String? = fileManager.contents(atPath: infoURL.path).flatMap { data in
            (try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])?["CFBundleIdentifier"] as? String
        }
        let testBundle = bundleIdentifier == contestingBundleIdentifier
        if arguments.contains(where: { $0.hasPrefix(offlineAcceptancePrefix) }) {
            guard arguments.count == 1, bundleIdentifier == "com.oliverbross.xlog.integration" else {
                throw WorkerFailure("runtime_profile_unbound", "Offline acceptance requires one production-candidate launch coordinate.")
            }
            let root = URL(fileURLWithPath: String(arguments[0].dropFirst(offlineAcceptancePrefix.count)), isDirectory: true)
            let resolved = try canonicalFilesystemPath(root)
            let parents = try [fileManager.temporaryDirectory, URL(fileURLWithPath: "/tmp", isDirectory: true)].map { try canonicalFilesystemPath($0) }
            let attributes = try fileManager.attributesOfItem(atPath: root.path)
            let marker = root.appendingPathComponent(".xlog-offline-acceptance.json")
            let markerAttributes = try fileManager.attributesOfItem(atPath: marker.path)
            guard root.path == resolved, root.lastPathComponent.hasPrefix("xlog-wave1-"),
                  parents.contains(root.deletingLastPathComponent().path),
                  attributes[.type] as? FileAttributeType == .typeDirectory,
                  ((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0) & 0o077 == 0,
                  markerAttributes[.type] as? FileAttributeType == .typeRegular,
                  let bytes = fileManager.contents(atPath: marker.path), bytes.count <= 1024,
                  let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any], value["schema"] as? Int == 1,
                  let id = value["id"] as? String, UUID(uuidString: id) != nil else {
                throw WorkerFailure("runtime_profile_invalid", "Offline acceptance requires private marked disposable temporary storage.")
            }
            return .contestingTest(supportRoot: root.appendingPathComponent("worker", isDirectory: true))
        }
        guard profileArguments.first == contestingArgument else {
            if profileArguments.isEmpty, !testBundle { return .production }
            throw WorkerFailure("runtime_profile_invalid", "Runtime profile is invalid.")
        }
        guard testBundle else {
            throw WorkerFailure("runtime_profile_unbound", "Contesting Test profile is not bound to the expected application bundle.")
        }
        let applicationSupport = try fileManager.url(for: .applicationSupportDirectory,
            in: .userDomainMask, appropriateFor: nil, create: false)
        return try contestingTestProfile(applicationSupport: applicationSupport, fileManager: fileManager)
    }

    /// Match Rust's filesystem canonicalization. Foundation deliberately presents
    /// /private/tmp and /private/var through their shorter macOS aliases.
    static func canonicalFilesystemPath(_ url: URL) throws -> String {
        #if canImport(Darwin) || canImport(Glibc)
        guard let path = realpath(url.path, nil) else {
            throw WorkerFailure("runtime_profile_invalid", "Offline acceptance directory is unavailable.")
        }
        defer { free(path) }
        return String(cString: path)
        #else
        return url.standardizedFileURL.resolvingSymlinksInPath().path
        #endif
    }

    /// Exact worker service modes. Unknown, duplicated, or reordered arguments
    /// remain fail-closed instead of silently acquiring acceptance authority.
    public static func workerServiceLocalAcceptance(arguments: [String]) -> Bool? {
        if arguments.count == 1, arguments[0].hasPrefix(offlineAcceptancePrefix) { return false }
        if arguments.isEmpty || arguments == [contestingArgument] { return false }
        if arguments == [localAcceptanceArgument]
            || arguments == [contestingArgument, localAcceptanceArgument] { return true }
        return nil
    }

    static func contestingTestProfile(applicationSupport: URL,
                                      fileManager: FileManager = .default) throws -> AppRuntimeProfile {
        let root = applicationSupport.appendingPathComponent("OM0RX-xLog Contesting Test", isDirectory: true)
        let production = [
            applicationSupport.appendingPathComponent("OM0RX-xLog", isDirectory: true),
            applicationSupport.appendingPathComponent("OM0RX-xLog-Integrated Preview", isDirectory: true),
        ]
        let resolvedRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        guard resolvedRoot.path != applicationSupport.standardizedFileURL.resolvingSymlinksInPath().path,
              production.allSatisfy({ candidate in
                  let resolved = candidate.standardizedFileURL.resolvingSymlinksInPath()
                  return resolvedRoot.path != resolved.path && !resolvedRoot.path.hasPrefix(resolved.path + "/")
              }) else {
            throw WorkerFailure("runtime_profile_alias", "Contesting Test storage aliases production storage.")
        }
        return .contestingTest(supportRoot: root)
    }

    var externalIOAllowed: Bool {
        if case .production = self { return true }
        return false
    }

    var contestN1MMUDPAllowed: Bool {
        if case .production = self { return true }
        return false
    }

    var supportDirectory: URL? {
        if case .contestingTest(let root) = self { return root }
        return nil
    }

    var identityPrefix: String {
        self == .production ? "com.oliverbross.OM0RXXLog.Integration." : Self.contestingIdentityPrefix
    }
}
