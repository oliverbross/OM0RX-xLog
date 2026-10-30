// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

public struct CWAlignedToken: Encodable, Equatable, Sendable {
    public let symbol: String
    public let firstSample: UInt64
    public let endSample: UInt64
    public let rfObservation:CWCarrierObservation?
    public init(symbol: String, firstSample: UInt64, endSample: UInt64,rfObservation:CWCarrierObservation?=nil) throws {
        guard symbol.utf8.count == 1, symbol.utf8.allSatisfy({ $0 == 32 || $0 == 44 || $0 == 46 || $0 == 47 ||
            (48...57).contains($0) || $0 == 63 || (65...90).contains($0) }), firstSample < endSample else {
            throw CWContractError.invalidSamples
        }
        self.symbol=symbol; self.firstSample=firstSample; self.endSample=endSample
        guard rfObservation?.valid(at:endSample) ?? true else {throw CWContractError.invalidSamples}
        self.rfObservation=rfObservation
    }
}

public struct CWTranscriptUpdate: Equatable, Sendable {
    public let committed: [CWAlignedToken]
    public let provisional: [CWAlignedToken]
    public let newCommitted: [CWAlignedToken]
    public let ambiguous: Bool
}

/// Reconciles sample-aligned windows; repeated words remain separate transmitted
/// occurrences. A material committed conflict is visible and suspends spotting.
/// One instance belongs to one track/epoch; reset on every discontinuity.
public struct CWTranscriptReconciler: Sendable {
    private var previous: [CWAlignedToken] = []
    private var committed: [CWAlignedToken] = []
    private var lastWindowEnd: UInt64 = 0
    private var ambiguous = false
    public init() {}
    public mutating func reset() { self=Self() }
    public mutating func process(_ tokens: [CWAlignedToken], firstSample: UInt64, endSample: UInt64) throws -> CWTranscriptUpdate {
        guard tokens.count <= 1024, firstSample < endSample, endSample > lastWindowEnd,
              endSample - firstSample <= 32_000,
              tokens.allSatisfy({ $0.firstSample >= firstSample && $0.endSample <= endSample }),
              zip(tokens,tokens.dropFirst()).allSatisfy({ $0.0.endSample <= $0.1.firstSample }) else {
            throw CWContractError.invalidSamples
        }
        let margin: UInt64 = 4800 // 1.5 seconds provisional at the right edge
        let cutoff = endSample >= margin ? endSample - margin : firstSample
        func aligned(_ a:CWAlignedToken,_ b:CWAlignedToken) -> Bool {
            // Alignment error is measured separately; never use string-only dedup.
            let delta = a.firstSample > b.firstSample ? a.firstSample-b.firstSample : b.firstSample-a.firstSample
            return a.symbol == b.symbol && delta <= 480
        }
        for old in committed where old.firstSample >= firstSample && old.firstSample-firstSample >= 640 && old.endSample < cutoff {
            if !tokens.contains(where:{ aligned(old,$0) }) { ambiguous=true }
        }
        var fresh: [CWAlignedToken] = []
        let committedEnd = committed.last?.endSample ?? 0
        var previousIndex = 0
        for token in tokens where token.firstSample >= committedEnd && token.endSample <= cutoff {
            while previousIndex < previous.count && token.firstSample > previous[previousIndex].endSample &&
                token.firstSample-previous[previousIndex].endSample > 480 { previousIndex += 1 }
            guard previousIndex < previous.count, aligned(token,previous[previousIndex]) else { break }
            fresh.append(token); previousIndex += 1
        }
        if !ambiguous { committed.append(contentsOf:fresh) } else { fresh=[] }
        if committed.count > 1024 { committed.removeFirst(committed.count-1024) }
        previous=tokens; lastWindowEnd=endSample
        let tailEnd = committed.last?.endSample ?? 0
        return CWTranscriptUpdate(committed:committed,provisional:tokens.filter{$0.firstSample>=tailEnd},
                                  newCommitted:fresh,ambiguous:ambiguous)
    }
}

public struct CWIdentityOccurrence: Hashable, Sendable {
    public let callsign: String
    public let firstSample: UInt64
    public let endSample: UInt64
    public let pattern: String
    public let rfObservation:CWCarrierObservation?
    public init(callsign:String,firstSample:UInt64,endSample:UInt64,pattern:String,rfObservation:CWCarrierObservation?=nil) {
        self.callsign=callsign;self.firstSample=firstSample;self.endSample=endSample;self.pattern=pattern;self.rfObservation=rfObservation
    }
}

public enum CWTransmittingIdentity {
    /// Count connected overlapping ranges once, retaining an original observed
    /// occurrence rather than inventing a merged RF evidence range.
    static func distinctOccurrences(_ occurrences:[CWIdentityOccurrence])->[CWIdentityOccurrence] {
        var result:[CWIdentityOccurrence]=[],coveredEnd:UInt64=0
        for item in occurrences.sorted(by:{$0.firstSample<$1.firstSample}) {
            if result.isEmpty || item.firstSample>=coveredEnd {result.append(item)}
            coveredEnd=max(coveredEnd,item.endSample)
        }
        return result
    }
    public static func plausible(_ text: String) -> Bool {
        guard (3...20).contains(text.utf8.count), !text.contains("?"),
              text.utf8.allSatisfy({ (65...90).contains($0) || (48...57).contains($0) || $0 == 47 }),
              !text.hasPrefix("/"), !text.hasSuffix("/"), !text.contains("//") else { return false }
        // Portable prefixes/suffixes and special events are permitted without
        // rewriting unfamiliar calls to entries in a callsign dictionary.
        return text.utf8.contains(where:{(65...90).contains($0)}) && text.utf8.contains(where:{(48...57).contains($0)})
    }

    public static func occurrences(in committed: [CWAlignedToken]) -> [CWIdentityOccurrence] {
        struct Word { let text:String; let first:UInt64; let end:UInt64;let rf:CWCarrierObservation? }
        var words:[Word]=[]; var current:[CWAlignedToken]=[]
        for token in committed.suffix(1024) {
            if token.symbol == " " {
                if let start=current.first,let end=current.last {
                    words.append(Word(text:current.map(\.symbol).joined(),first:start.firstSample,end:end.endSample,rf:end.rfObservation)); current=[]
                }
            } else { current.append(token) }
        }
        // No trailing space: the final word is still an unfinished callsign.
        var result:[CWIdentityOccurrence]=[],context:String?,phraseStart=0,lastWordEnd:UInt64?
        for word in words {
            if let lastWordEnd,word.first>lastWordEnd,word.first-lastWordEnd>3200 {
                context=nil;phraseStart=result.count
            }
            lastWordEnd=word.end
            if ["K","AR","SK","BK"].contains(word.text) {context=nil;phraseStart=result.count;continue}
            if ["CQ","TEST"].contains(word.text) {context=word.text;phraseStart=result.count;continue}
            if word.text=="DE" {
                // DE identifies this phrase's sender, not every earlier sender
                // in the track history. Preserve earlier DE evidence and other
                // completed phrases, so a later station cannot silently replace it.
                result=Array(result.prefix(phraseStart))+result.dropFirst(phraseStart).filter{$0.pattern=="de_self_identification"}
                context="DE";continue
            }
            if let context, plausible(word.text) {
                result.append(CWIdentityOccurrence(callsign:word.text,firstSample:word.first,endSample:word.end,
                                                   pattern:context == "DE" ? "de_self_identification" : "cq_self_identification",rfObservation:word.rf))
            } else if word.text != "DX" {context=nil;phraseStart=result.count}
        }
        return result
    }
}
