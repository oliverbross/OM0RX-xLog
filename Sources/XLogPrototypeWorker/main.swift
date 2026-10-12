import Foundation
import XLogPrototypeSupport
#if os(Windows)
import ucrt
#elseif canImport(Darwin)
import Darwin
#else
import Glibc
#endif

let worker = PrototypeWorker()
let output = FileHandle.standardOutput

private actor OutputWriter {
    func send(_ response: Data) {
        var frame = response
        frame.append(10)
        FileHandle.standardOutput.write(frame)
    }
}

private actor Admission {
    private var running = 0
    private let limit = 16
    func enter() -> Bool {
        guard running < limit else { return false }
        running += 1
        return true
    }
    func leave() { running -= 1 }
}

private let writer = OutputWriter()
private let admission = Admission()
func overloaded(_ input: Data?) -> Data {
    let object = input.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    let id = (object?["id"] as? String).flatMap { $0.utf8.count <= 128 ? $0 : nil } ?? ""
    return (try? JSONSerialization.data(withJSONObject: [
        "id": id, "ok": false,
        "error": ["code": "worker_busy", "message": "Station service is busy; try again."]
    ])) ?? Data()
}

func emit(_ input: Data?, using liveWorker: LiveWorker) async {
    let response: Data
    if let input { response = await liveWorker.response(to: input) }
    else { response = PrototypeWorker().oversizedResponse() }
    await writer.send(response)
}

if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--self-test" {
    let response = worker.response(to: Data("{\"id\":\"self-test\",\"method\":\"self_test\",\"params\":{}}".utf8))
    output.write(response)
    output.write(Data([10]))
    let object = try? JSONSerialization.jsonObject(with: response) as? [String: Any]
    exit(object?["ok"] as? Bool == true ? 0 : 1)
} else if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--local-logbook-self-test" {
    do {
        let result = try LocalLogbookSelfTest.run()
        output.write(try JSONSerialization.data(withJSONObject: ["id": "local-logbook-self-test", "ok": true, "result": result], options: [.sortedKeys]))
        output.write(Data([10]))
        exit(0)
    } catch {
        // Never print raw dependency errors, paths, preferences or contact data.
        output.write(Data("{\"id\":\"local-logbook-self-test\",\"ok\":false,\"error\":{\"code\":\"local_self_test_failed\",\"message\":\"Local logbook acceptance failed.\"}}\n".utf8))
        exit(1)
    }
} else if CommandLine.arguments.count == 1 || CommandLine.arguments == [CommandLine.arguments[0], "--local-ui-acceptance"] {
    let acceptance: LocalAcceptanceSession?
    do { acceptance = CommandLine.arguments.count == 2 ? try LocalAcceptanceSession() : nil }
    catch {
        FileHandle.standardError.write(Data("Could not create isolated local acceptance session.\n".utf8))
        exit(1)
    }
    let liveWorker = acceptance?.worker ?? LiveWorker.shared
    var lines = WorkerLineReader()
    #if os(Windows)
    // Prevent CRT text-mode CRLF translation from altering byte limits/framing.
    _ = ucrt._setmode(0, _O_BINARY)
    #endif
    await withTaskGroup(of: Void.self) { group in
    func dispatch(_ requests: [Data?]) async {
        for request in requests {
            if await admission.enter() {
                group.addTask {
                    await emit(request, using: liveWorker)
                    await admission.leave()
                }
            } else {
                // A saturated lane rejects immediately with the same request
                // ID; it never builds an unbounded queue behind slow I/O.
                await writer.send(overloaded(request))
            }
        }
    }
    while true {
        // Foundation read(upToCount:) may wait for the full count on a pipe.
        // Native reads return the available fragment without waiting for EOF.
        let (count, chunk, readError) = await Task.detached {
            var bytes = [UInt8](repeating: 0, count: 4096)
            let count = bytes.withUnsafeMutableBytes { buffer -> Int in
            #if os(Windows)
            return Int(ucrt._read(0, buffer.baseAddress, UInt32(buffer.count)))
            #elseif canImport(Darwin)
            return Darwin.read(STDIN_FILENO, buffer.baseAddress, buffer.count)
            #else
            return Glibc.read(STDIN_FILENO, buffer.baseAddress, buffer.count)
            #endif
            }
            return (count, Data(bytes.prefix(max(0, count))), errno)
        }.value
        if count == 0 { break }
        if count < 0 {
            #if !os(Windows)
            if readError == EINTR { continue }
            #endif
            FileHandle.standardError.write(Data("Worker input stream failed.\n".utf8))
            break
        }
        var requests: [Data?] = []
        lines.consume(chunk) { requests.append($0) }
        await dispatch(requests)
    }
    var requests: [Data?] = []
    lines.finish { requests.append($0) }
    await dispatch(requests)
    // EOF is the graceful shutdown signal. Retire station ownership before
    // waiting on unrelated slow service/logbook work so RF releases are not
    // delayed behind a network lookup or database import.
    if acceptance == nil { await liveWorker.shutdown() }
    await group.waitForAll()
    }
    if let acceptance {
        do { try await acceptance.close() }
        catch {
            FileHandle.standardError.write(Data("Could not clean isolated local acceptance session.\n".utf8))
            exit(1)
        }
    }
} else {
    FileHandle.standardError.write(Data("Usage: xlog-prototype-worker [--self-test | --local-logbook-self-test | --local-ui-acceptance]\n".utf8))
    exit(2)
}
