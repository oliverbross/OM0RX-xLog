// Synthetic chunk-read allocation benchmark; compile with swiftc -O.
import Foundation
import Darwin
import CryptoKit

let mode = CommandLine.arguments.dropFirst().first ?? "before"
let line = "<CALL:5>K1ABC <COMMENT:11>Žilina 🏞 <EOR>\n"
let text = String(repeating: line, count: 150_000)
let total = text.utf8.count
let started = ContinuousClock.now
var output = Data(), copied = 0, chunks = 0
for offset in stride(from: 0, to: total, by: 12_000) {
    let chunk: Data
    if mode == "before" {
        let data = Data(text.utf8)
        copied += data.count
        chunk = data.subdata(in: offset..<min(data.count, offset + 12_000))
    } else {
        var value = text
        chunk = value.withUTF8 { Data($0[offset..<min($0.count, offset + 12_000)]) }
    }
    copied += chunk.count
    // Match the wire conversion, and independently reconstruct every byte.
    output.append(Data(base64Encoded: chunk.base64EncodedString())!)
    chunks += 1
}
precondition(output == Data(text.utf8))
let elapsed = started.duration(to: .now)
var usage = rusage()
getrusage(RUSAGE_SELF, &usage)
let digest = SHA256.hash(data: output).map { String(format: "%02x", $0) }.joined()
print("{\"mode\":\"\(mode)\",\"fileBytes\":\(total),\"fixtureSHA256\":\"\(digest)\",\"chunks\":\(chunks),\"dataBytesConstructed\":\(copied),\"elapsed\":\"\(elapsed)\",\"maxRSSBytes\":\(usage.ru_maxrss),\"exactBytes\":true}")
