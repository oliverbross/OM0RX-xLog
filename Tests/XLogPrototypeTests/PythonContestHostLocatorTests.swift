import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class PythonContestHostLocatorTests: XCTestCase {
    private func fixture() throws -> (root: URL, worker: URL, support: URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-contest-locator-\(UUID().uuidString)", isDirectory: true)
        let worker = root.appendingPathComponent("Installed App/bin/xlog-prototype-worker.exe")
        try FileManager.default.createDirectory(at: worker.deletingLastPathComponent(), withIntermediateDirectories: true)
        return (root, worker, root.appendingPathComponent("Operator Support", isDirectory: true))
    }

    private func write(_ url: URL, executable: Bool = false) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        #if os(Windows)
        if executable {
            // Windows checks executable format; arbitrary text with an .exe
            // extension cannot stand in for a valid package interpreter.
            try FileManager.default.copyItem(at: URL(fileURLWithPath: CommandLine.arguments[0]), to: url)
            XCTAssertTrue(FileManager.default.isExecutableFile(atPath: url.path))
            return
        }
        #endif
        try Data("fixture".utf8).write(to: url)
        #if !os(Windows)
        try FileManager.default.setAttributes([.posixPermissions: executable ? 0o700 : 0o600], ofItemAtPath: url.path)
        #endif
    }

    func testWindowsRuntimeAndHostAreBoundToWorkerDirectoryWithoutAnExplicitCAOverride() throws {
        let fixture = try fixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let configuration = try PythonContestHostConfiguration.portablePaths(
            applicationSupport: fixture.support, workerExecutableURL: fixture.worker, platform: .windows)
        let workerDirectory = fixture.worker.deletingLastPathComponent()
        XCTAssertEqual(configuration.executableURL, workerDirectory.appendingPathComponent("Python/python.exe"))
        XCTAssertEqual(configuration.launcherURL, workerDirectory.appendingPathComponent("Not1MM/python/contest_host/launcher.py"))
        XCTAssertEqual(configuration.dataRootURL, fixture.support.appendingPathComponent("Contesting/Python", isDirectory: true))
        XCTAssertNil(configuration.sslCertificateFileURL)
        let environment = PythonContestLane.childEnvironment(n1mmUDPAllowed: false,
                                                            sslCertificateFileURL: configuration.sslCertificateFileURL)
        XCTAssertNil(environment["SSL_CERT_FILE"])
        XCTAssertNil(environment["PYTHONHOME"])
        XCTAssertNil(environment["PYTHONPATH"])
        XCTAssertNil(environment["PATH"])
    }

    func testLinuxRuntimeAndCAUseOnlyDeclaredAbsoluteOSPathsWhileHostStaysBesideWorker() throws {
        let fixture = try fixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let configuration = try PythonContestHostConfiguration.portablePaths(
            applicationSupport: fixture.support, workerExecutableURL: fixture.worker, platform: .linux)
        let executable = URL(fileURLWithPath: "/usr/bin/python3.12")
        let certificate = URL(fileURLWithPath: "/etc/ssl/certs/ca-certificates.crt")
        XCTAssertEqual(configuration.executableURL, executable)
        XCTAssertEqual(configuration.launcherURL, fixture.worker.deletingLastPathComponent().appendingPathComponent("Not1MM/python/contest_host/launcher.py"))
        XCTAssertEqual(configuration.sslCertificateFileURL, certificate)
        XCTAssertEqual(configuration.dataRootURL, fixture.support.appendingPathComponent("Contesting/Python", isDirectory: true))
        XCTAssertEqual(PythonContestLane.childEnvironment(n1mmUDPAllowed: false,
            sslCertificateFileURL: configuration.sslCertificateFileURL)["SSL_CERT_FILE"], certificate.path)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.support.path))
    }

    func testPortablePathsRejectNonFileCoordinates() throws {
        let local = URL(fileURLWithPath: "/fixture/worker")
        let remote = try XCTUnwrap(URL(string: "https://example.invalid/worker"))
        XCTAssertThrowsError(try PythonContestHostConfiguration.portablePaths(
            applicationSupport: local, workerExecutableURL: remote, platform: .windows))
        XCTAssertThrowsError(try PythonContestHostConfiguration.portablePaths(
            applicationSupport: remote, workerExecutableURL: local, platform: .linux))
    }

    func testPortableRuntimeRequiresItsOwnReadableExecutableAndLauncherWithoutFallback() throws {
        let fixture = try fixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let configuration = try PythonContestHostConfiguration.portablePaths(
            applicationSupport: fixture.support, workerExecutableURL: fixture.worker, platform: .windows)
        // A different interpreter in the package never substitutes for the exact declared one.
        try write(fixture.worker.deletingLastPathComponent().appendingPathComponent("Python/python3.exe"), executable: true)
        try write(configuration.launcherURL)
        XCTAssertThrowsError(try configuration.validatedPortableFiles()) { error in
            XCTAssertEqual((error as? ContestLaneError)?.code, "contest_host_unavailable")
        }
        try write(configuration.executableURL, executable: true)
        XCTAssertEqual(try configuration.validatedPortableFiles(), configuration)
        XCTAssertFalse(FileManager.default.fileExists(atPath: configuration.dataRootURL.path))
        try FileManager.default.removeItem(at: configuration.launcherURL)
        XCTAssertThrowsError(try configuration.validatedPortableFiles())
        try FileManager.default.createDirectory(at: configuration.launcherURL, withIntermediateDirectories: true)
        XCTAssertThrowsError(try configuration.validatedPortableFiles())
        #if !os(Windows)
        try FileManager.default.removeItem(at: configuration.launcherURL)
        try write(configuration.launcherURL)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configuration.executableURL.path)
        XCTAssertThrowsError(try configuration.validatedPortableFiles())
        #endif
    }

    func testExplicitCertificateMustBeReadableRegularAndNotASymlink() throws {
        let fixture = try fixture()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        let base = try PythonContestHostConfiguration.portablePaths(
            applicationSupport: fixture.support, workerExecutableURL: fixture.worker, platform: .windows)
        try write(base.executableURL, executable: true)
        try write(base.launcherURL)
        let certificate = fixture.root.appendingPathComponent("cert.pem")
        let configuration = PythonContestHostConfiguration(executableURL: base.executableURL,
            launcherURL: base.launcherURL, dataRootURL: base.dataRootURL, sslCertificateFileURL: certificate)
        XCTAssertThrowsError(try configuration.validatedPortableFiles())
        try write(certificate)
        XCTAssertEqual(try configuration.validatedPortableFiles(), configuration)
        try FileManager.default.removeItem(at: certificate)
        try FileManager.default.createDirectory(at: certificate, withIntermediateDirectories: true)
        XCTAssertThrowsError(try configuration.validatedPortableFiles())
        #if !os(Windows)
        try FileManager.default.removeItem(at: certificate)
        let target = fixture.root.appendingPathComponent("real-cert.pem")
        try write(target)
        try FileManager.default.createSymbolicLink(at: certificate, withDestinationURL: target)
        XCTAssertThrowsError(try configuration.validatedPortableFiles())
        #endif
    }
}
