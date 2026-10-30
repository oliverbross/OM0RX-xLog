// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

/// A measured carrier offset on the track's 3.2-kHz channel clock. This is not
/// RF mapping qualification and does not synthesize a frequency for missing IQ.
public struct CWCarrierObservation:Encodable,Hashable,Sendable {
    public let offsetHz:Double
    public let sample:UInt64
    public init(offsetHz:Double,sample:UInt64) throws {
        guard offsetHz.isFinite,abs(offsetHz)<=192_000 else {throw CWContractError.invalidSamples}
        self.offsetHz=offsetHz;self.sample=sample
    }
    func valid(at end:UInt64)->Bool {sample<=end && end-sample<=1600}
}
