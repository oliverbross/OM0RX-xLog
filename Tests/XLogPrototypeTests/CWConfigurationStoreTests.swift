import Foundation
import XCTest
import XCWCore
@testable import XLogPrototypeSupport

final class CWConfigurationStoreTests: XCTestCase {
    private func directory() throws -> URL {
        // Darwin's /var temporary-directory alias is itself a symlink. Use an
        // owned directory under home when exercising the all-ancestor fence.
        let url=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".cache/cw-config-\(UUID())")
        try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true)
        addTeardownBlock{try? FileManager.default.removeItem(at:url)}
        return url
    }
    func testMissingLoadDoesNotCreateFileAndSaveUsesRevision() throws {
        let url=try directory().appendingPathComponent("CWDecode/settings.json")
        let store=CWConfigurationStore(url:url),before=try store.load()
        XCTAssertFalse(FileManager.default.fileExists(atPath:url.path))
        let next=try CWDecodeConfiguration(listenerEnabled:true)
        try store.save(next,expectedRevision:before.revision)
        XCTAssertEqual(try CWConfigurationStore(url:url).load(),next)
        XCTAssertThrowsError(try store.save(CWDecodeConfiguration(),expectedRevision:before.revision))
        XCTAssertEqual(try store.load(),next)
        #if os(macOS)
        let attributes=try FileManager.default.attributesOfItem(atPath:url.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue,0o600)
        #endif
    }
    func testSymlinkAncestorAndMalformedFileAreRejected() throws {
        let root=try directory(),target=root.appendingPathComponent("target"),link=root.appendingPathComponent("link")
        try FileManager.default.createDirectory(at:target,withIntermediateDirectories:true)
        try FileManager.default.createSymbolicLink(at:link,withDestinationURL:target)
        XCTAssertThrowsError(try CWConfigurationStore(url:link.appendingPathComponent("nested/settings.json")).load())
        let file=target.appendingPathComponent("settings.json")
        try Data("{}".utf8).write(to:file)
        XCTAssertThrowsError(try CWConfigurationStore(url:file).load())
    }
}
