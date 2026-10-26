// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

/// Includes the single active network write until its completion callback.
/// Limits are independent of the OS TCP send buffer and all other clients.
struct CWClientOutputQueue: Sendable {
    private struct Entry: Sendable {let data:Data;let enqueued:UInt64}
    private var entries:[Entry]=[]
    private(set) var byteCount=0
    var first:Data?{entries.first?.data}
    mutating func enqueue(_ data:Data,now:UInt64) -> Bool {
        guard !data.isEmpty,data.count<=262_144,byteCount<=262_144-data.count,!expired(now:now) else {return false}
        entries.append(Entry(data:data,enqueued:now));byteCount+=data.count;return true
    }
    mutating func complete() {
        guard !entries.isEmpty else {return}
        byteCount-=entries.removeFirst().data.count
    }
    func expired(now:UInt64) -> Bool {
        guard let oldest=entries.first?.enqueued else {return false}
        return now<oldest || now-oldest>=5_000_000_000
    }
}
