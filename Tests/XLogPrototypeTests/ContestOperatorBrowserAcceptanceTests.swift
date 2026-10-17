import Foundation
import XCTest
@testable import XLogPrototypeSupport
#if canImport(Darwin)
import Darwin
#endif

#if os(macOS)
private actor ContestOperatorAcceptanceBridge {
    private let supportRoot: URL
    private let profile: AppRuntimeProfile
    private let responseFD: Int32
    private let stallMode: String?
    private var worker: LiveWorker?

    init(supportRoot: URL, profile: AppRuntimeProfile, responseFD: Int32, stallMode: String?) {
        self.supportRoot = supportRoot
        self.profile = profile
        self.responseFD = responseFD
        self.stallMode = stallMode
    }

    private func newWorker() -> LiveWorker {
        LiveWorker(logbook: LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false,
                                               runtimeProfile: profile), runtimeProfile: profile)
    }

    private func respond(id: String, result: [String: Any] = [:]) throws {
        let data = try JSONSerialization.data(withJSONObject: ["id": id, "ok": true, "result": result], options: [.sortedKeys]) + Data([10])
        var written = 0
        try data.withUnsafeBytes { bytes in
            while written < bytes.count {
                let count = Darwin.write(responseFD, bytes.baseAddress!.advanced(by: written), bytes.count - written)
                guard count >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
                written += count
            }
        }
    }

    func handle(_ requestData: Data) async throws {
        guard let request = try JSONSerialization.jsonObject(with: requestData) as? [String: Any],
              let id = request["id"] as? String, let method = request["method"] as? String else {
            throw NSError(domain: "ContestOperatorBrowserAcceptance", code: 20,
                          userInfo: [NSLocalizedDescriptionKey: "Malformed test-host request frame."])
        }
        if stallMode == "response", method == "health" { while true { try? await Task.sleep(for: .seconds(3_600)) } }
        switch method {
        case "__acceptance_restart":
            if let worker { await worker.shutdown() }
            worker = newWorker()
            try respond(id: id, result: ["lifecycle": "restarted"])
        case "__acceptance_shutdown":
            if stallMode == "shutdown" { while true { try? await Task.sleep(for: .seconds(3_600)) } }
            if let worker { await worker.shutdown() }
            worker = nil
            try respond(id: id, result: ["lifecycle": "shutdown"])
        default:
            if worker == nil { worker = newWorker() }
            let response = await worker!.response(to: requestData) + Data([10])
            var written = 0
            try response.withUnsafeBytes { bytes in
                while written < bytes.count {
                    let count = Darwin.write(responseFD, bytes.baseAddress!.advanced(by: written), bytes.count - written)
                    guard count >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
                    written += count
                }
            }
        }
    }

    func shutdown() async {
        if let worker { await worker.shutdown() }
        worker = nil
    }
}

private actor ContestOperatorAcceptanceLifecycle {
    private(set) var timedOut = false
    func markTimedOut() { timedOut = true }
}

final class ContestOperatorBrowserAcceptanceTests: XCTestCase {
    private struct Diagnostics: Sendable { let data: Data; let truncated: Bool }

    private static func readRequests(fd: Int32, bridge: ContestOperatorAcceptanceBridge) async throws -> Data {
        var buffer = Data(); let newline = Data([10])
        while true {
            var bytes = [UInt8](repeating: 0, count: 4096)
            let count = bytes.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if count == 0 { break }
            if count < 0 { if errno == EINTR { continue }; throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
            buffer.append(contentsOf: bytes.prefix(count))
            while let boundary = buffer.firstRange(of: newline) {
                let request = buffer[..<boundary.lowerBound]
                buffer.removeSubrange(...boundary.lowerBound)
                if !request.isEmpty { try await bridge.handle(Data(request)) }
            }
        }
        return buffer
    }

    private static func drainDiagnostics(fd: Int32, limit: Int = 1_048_576) -> Diagnostics {
        var data = Data(), truncated = false
        while true {
            var bytes = [UInt8](repeating: 0, count: 4096)
            let count = bytes.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if count == 0 { break }
            if count < 0 { if errno == EINTR { continue }; break }
            let remaining = max(0, limit - data.count)
            if count > remaining { truncated = true }
            if remaining > 0 { data.append(contentsOf: bytes.prefix(min(count, remaining))) }
        }
        return Diagnostics(data: data, truncated: truncated)
    }

    private static func terminateOwned(_ process: Process) async {
        guard process.isRunning else { return }
        process.terminate()
        try? await Task.sleep(for: .seconds(1))
        if process.isRunning { _ = Darwin.kill(process.processIdentifier, SIGKILL) }
    }

    func testRealWorkspaceAndMutationOwnerAgainstIsolatedLiveWorker() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["XLOG_RUN_CONTEST_OPERATOR_BROWSER_ACCEPTANCE"] == "1" else {
            throw XCTSkip("Real browser/LiveWorker acceptance is opt-in.")
        }
        guard environment["XLOG_OPERATOR_ACCEPTANCE_OUTER_GUARD"] == "owned-process-group-v1" else {
            throw NSError(domain: "ContestOperatorBrowserAcceptance", code: 6,
                          userInfo: [NSLocalizedDescriptionKey: "Run through run-contest-operator-browser-acceptance.mjs so the full test host is bounded."])
        }
        let previousPipeHandler = Darwin.signal(SIGPIPE, SIG_IGN)
        defer { _ = Darwin.signal(SIGPIPE, previousPipeHandler) }
        guard let outputValue = environment["XLOG_OPERATOR_ACCEPTANCE_OUTPUT"] else {
            throw NSError(domain: "ContestOperatorBrowserAcceptance", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Missing acceptance output root."])
        }
        let output = outputValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let sourceHead = try XCTUnwrap(environment["XLOG_OPERATOR_ACCEPTANCE_SOURCE_HEAD"])
        guard !output.isEmpty else {
            throw NSError(domain: "ContestOperatorBrowserAcceptance", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Acceptance output root is empty."])
        }
        let outputURL = URL(fileURLWithPath: output, isDirectory: true)
        guard !FileManager.default.fileExists(atPath: outputURL.path) else {
            throw NSError(domain: "ContestOperatorBrowserAcceptance", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "Acceptance output must be a new path."])
        }
        let applicationSupport = outputURL.appendingPathComponent("isolated-home/Library/Application Support", isDirectory: true)
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: applicationSupport)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected Contesting Test profile") }

        let repositoryRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true)
        let script = repositoryRoot.appendingPathComponent("prototype/scripts/accept-contest-operator-browser.mjs")
        guard FileManager.default.fileExists(atPath: script.path) else {
            throw NSError(domain: "ContestOperatorBrowserAcceptance", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "Acceptance driver is missing."])
        }
        guard let testHost = Bundle(for: ContestOperatorBrowserAcceptanceTests.self).executableURL,
              FileManager.default.isExecutableFile(atPath: testHost.path) else {
            throw NSError(domain: "ContestOperatorBrowserAcceptance", code: 5,
                          userInfo: [NSLocalizedDescriptionKey: "Compiled XLogPrototypeTests host is unavailable."])
        }
        let process = Process()
        let hostProcessGroup = Darwin.getpgrp()
        let joinHostGroup = "import os,sys; os.setpgid(0,int(sys.argv[1])); os.execv('/usr/bin/env',['env']+sys.argv[2:])"
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = ["-c", joinHostGroup, String(hostProcessGroup), "node", script.path,
                             "--output", outputURL.path, "--expected-head", sourceHead,
                             "--test-host-binary", testHost.path, "--test-runner-binary", CommandLine.arguments[0]]
        process.currentDirectoryURL = repositoryRoot
        var childEnvironment = environment
        childEnvironment["TZ"] = "UTC"
        process.environment = childEnvironment
        let requests = Pipe(), responses = Pipe(), diagnostics = Pipe()
        process.standardOutput = requests
        process.standardInput = responses
        process.standardError = diagnostics
        try process.run()
        let bridge = ContestOperatorAcceptanceBridge(supportRoot: supportRoot, profile: profile,
                                                     responseFD: responses.fileHandleForWriting.fileDescriptor,
                                                     stallMode: environment["XLOG_OPERATOR_ACCEPTANCE_STALL"])
        let lifecycle = ContestOperatorAcceptanceLifecycle()
        let requestFD = requests.fileHandleForReading.fileDescriptor
        let diagnosticFD = diagnostics.fileHandleForReading.fileDescriptor
        let requestTask = Task.detached { try await Self.readRequests(fd: requestFD, bridge: bridge) }
        let diagnosticTask = Task.detached { Self.drainDiagnostics(fd: diagnosticFD) }
        let exitTask = Task.detached { process.waitUntilExit(); return process.terminationStatus }
        let watchdog = Task.detached {
            try? await Task.sleep(for: .seconds(180))
            guard !Task.isCancelled else { return }
            await lifecycle.markTimedOut()
            await Self.terminateOwned(process)
        }
        var bridgeError: Error?, buffer = Data()
        do { buffer = try await requestTask.value }
        catch { bridgeError = error; await Self.terminateOwned(process) }
        responses.fileHandleForWriting.closeFile()
        await bridge.shutdown()
        _ = await exitTask.value
        watchdog.cancel()
        let captured = await diagnosticTask.value
        let diagnosticText = String(decoding: captured.data, as: UTF8.self) + (captured.truncated ? "\n[diagnostics truncated]" : "")
        let didTimeOut = await lifecycle.timedOut
        XCTAssertFalse(didTimeOut, "Browser/worker acceptance exceeded its 180 second lifecycle deadline.")
        XCTAssertEqual(process.terminationReason, .exit)
        XCTAssertNil(bridgeError, "Bridge failed: \(String(describing: bridgeError))\n\(diagnosticText)")
        XCTAssertEqual(process.terminationStatus, 0, diagnosticText)
        XCTAssertTrue(buffer.isEmpty, "Browser harness left a partial request frame.")
        XCTAssertTrue(diagnosticText.contains("\"ok\":true"), "Harness did not emit its completion receipt: \(diagnosticText)")
    }
}
#endif
