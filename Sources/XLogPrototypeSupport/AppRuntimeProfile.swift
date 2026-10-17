import Foundation

public enum AppRuntimeProfile: Equatable, Sendable {
    case production
    case contestingTest(supportRoot: URL)

    static let contestingBundleIdentifier = "com.oliverbross.xlog.contesting-test"
    public static let contestingArgument = "--runtime-profile=contesting-test"
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

    var supportDirectory: URL? {
        if case .contestingTest(let root) = self { return root }
        return nil
    }

    var identityPrefix: String {
        self == .production ? "com.oliverbross.OM0RXXLog.Integration." : Self.contestingIdentityPrefix
    }
}
