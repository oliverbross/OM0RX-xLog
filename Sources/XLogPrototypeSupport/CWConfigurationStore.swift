// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation
import XCWCore
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Accessed by the single LiveCWDecodeMethods actor. Loading a missing file is
/// passive, and a failed write cannot advance the in-memory revision.
final class CWConfigurationStore {
    let url: URL
    private var cached: CWDecodeConfiguration?
    init(url: URL) {self.url=url}
    func load() throws -> CWDecodeConfiguration {
        if let cached {return cached}
        try validatePath()
        let result: CWDecodeConfiguration
        if FileManager.default.fileExists(atPath:url.path) {
            let size=try url.resourceValues(forKeys:[.fileSizeKey,.isRegularFileKey])
            guard size.isRegularFile==true,(size.fileSize ?? Int.max)<=16_384 else {throw CWContractError.invalidConfiguration}
            result=try CWDecodeConfiguration.decode(Data(contentsOf:url))
        } else {result=try CWDecodeConfiguration()}
        cached=result;return result
    }
    func save(_ value: CWDecodeConfiguration, expectedRevision: UUID) throws {
        let previous=try load()
        guard previous.revision==expectedRevision,value.revision != previous.revision else {
            throw WorkerFailure("cw_configuration_changed","CW Decode settings changed. Reload before saving.")
        }
        try value.validate();try validatePath()
        try FileManager.default.createDirectory(at:url.deletingLastPathComponent(),withIntermediateDirectories:true,
                                                attributes:LocalFilePermissions.directoryAttributes)
        try JSONEncoder().encode(value).write(to:url,options:.atomic)
        try LocalFilePermissions.protectFile(url)
        cached=value
    }
    private func validatePath() throws {
        guard url.isFileURL else {throw CWContractError.invalidConfiguration}
        var path=url.path
        // Check every existing ancestor, including the file itself; checking
        // only the immediate parent misses a symlink higher in the path.
        while path != "/" && !path.isEmpty {
            if let attributes=try? FileManager.default.attributesOfItem(atPath:path),
               attributes[.type] as? FileAttributeType == .typeSymbolicLink {
                throw WorkerFailure("unsafe_configuration","CW Decode settings cannot use a symbolic link.")
            }
            path=(path as NSString).deletingLastPathComponent
        }
    }
}
