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
func emit(_ input: Data?) {
    let response = input.map(worker.response(to:)) ?? worker.oversizedResponse()
    output.write(response)
    output.write(Data([10]))
}

if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--self-test" {
    let response = worker.response(to: Data("{\"id\":\"self-test\",\"method\":\"self_test\",\"params\":{}}".utf8))
    output.write(response)
    output.write(Data([10]))
    let object = try? JSONSerialization.jsonObject(with: response) as? [String: Any]
    exit(object?["ok"] as? Bool == true ? 0 : 1)
} else if CommandLine.arguments.count == 1 {
    var lines = WorkerLineReader()
    #if os(Windows)
    // Prevent CRT text-mode CRLF translation from altering byte limits/framing.
    _ = ucrt._setmode(0, _O_BINARY)
    #endif
    var bytes = [UInt8](repeating: 0, count: 4096)
    while true {
        // Foundation read(upToCount:) may wait for the full count on a pipe.
        // Native reads return the available fragment without waiting for EOF.
        let count = bytes.withUnsafeMutableBytes { buffer -> Int in
            #if os(Windows)
            return Int(ucrt._read(0, buffer.baseAddress, UInt32(buffer.count)))
            #elseif canImport(Darwin)
            return Darwin.read(STDIN_FILENO, buffer.baseAddress, buffer.count)
            #else
            return Glibc.read(STDIN_FILENO, buffer.baseAddress, buffer.count)
            #endif
        }
        if count == 0 { break }
        if count < 0 {
            #if !os(Windows)
            if errno == EINTR { continue }
            #endif
            FileHandle.standardError.write(Data("Worker input stream failed.\n".utf8))
            exit(1)
        }
        lines.consume(Data(bytes.prefix(count)), emit: emit)
    }
    lines.finish(emit: emit)
} else {
    FileHandle.standardError.write(Data("Usage: xlog-prototype-worker [--self-test]\n".utf8))
    exit(2)
}
