// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation
#if canImport(CoreFoundation)
import CoreFoundation
#endif

public enum CWComputeError: Error, Equatable, Sendable {
    case invalidEvent, invalidFrame, resourceValidation, occupied, spawnFailed(Int32)
    case startupTimeout, outputOverflow, inputOverflow, staleInput, childExited(Int32), stopped
    case memoryLimitExceeded, memoryMetricsUnavailable
}

public struct CWNativeTrack: Sendable {
    public let kind: String
    public let streamToken: String
    public let epoch: UInt64
    public let trackID: String
    public let revision: UInt64
    public let state: String
    public let firstSample: UInt64
    public let endSample: UInt64
    public let sourceFirstSample: UInt64
    public let filterDelaySeconds: Double
    public let offsetHz: Double
    public let ambiguous: Bool
    public let replay: Bool
    public var rfObservation:CWCarrierObservation?=nil
}
public struct CWNativeToken: Sendable {
    public let symbol: String
    public let firstSample: UInt64
    public let endSample: UInt64
    public let logScore: Double
    public var rfObservation:CWCarrierObservation?=nil
    /// Reflection padding at the exact window edge has no observed duration.
    public var aligned: CWAlignedToken? { try? CWAlignedToken(symbol:symbol,firstSample:firstSample,endSample:endSample,rfObservation:rfObservation) }
}
public struct CWNativeDecode: Sendable {
    public let track: CWNativeTrack
    public let text: String
    public let tokens: [CWNativeToken]
    public let inferenceMilliseconds: Double
    public var estimatedWPM:Double?=nil
    public var estimatedSNRDB:Double?=nil
    public var snrReferenceHz:Int?=nil
}
public struct CWNativeMetrics: Sendable {
    public let requestSequence: UInt64
    public let sources: Int
    public let tracks: Int
    public let pending: Int
    public let inFlight: Int
    public let coalesced: UInt64
    public let droppedEvents: UInt64
}
public enum CWComputeEvent: Sendable {
    case ready(runtime: String)
    case track(CWNativeTrack)
    case decode(CWNativeDecode)
    case metrics(CWNativeMetrics)
}

public enum CWComputeWire {
    public static let maximumEventBytes = 131_072
    private static let alphabet=Set(",./0123456789?ABCDEFGHIJKLMNOPQRSTUVWXYZ ".utf8)
    private static let trackKeys:Set<String>=["type","stream_token","epoch","track_id","state","first_sample","end_sample",
        "source_first_sample","filter_delay_seconds","track_revision","offset_hz","ambiguous","replay"]

    private static func counter(_ value:Any?) throws -> UInt64 {
        guard let text=value as? String, let number=UInt64(text), String(number)==text else { throw CWComputeError.invalidEvent }
        return number
    }
    private static func number(_ value:Any?) throws -> Double {
        guard let number=value as? NSNumber, !isJSONBoolean(number), number.doubleValue.isFinite else { throw CWComputeError.invalidEvent }
        return number.doubleValue
    }
    private static func integer(_ value:Any?,range:ClosedRange<Int>) throws -> Int {
        let number=try number(value)
        guard number.rounded()==number, number>=Double(range.lowerBound),number<=Double(range.upperBound) else { throw CWComputeError.invalidEvent }
        return Int(number)
    }
    private static func boolean(_ value:Any?) throws -> Bool {
        guard let number=value as? NSNumber, isJSONBoolean(number) else { throw CWComputeError.invalidEvent }
        return number.boolValue
    }
    private static func isJSONBoolean(_ number:NSNumber) -> Bool {
        #if canImport(CoreFoundation)
        CFGetTypeID(number)==CFBooleanGetTypeID()
        #else
        isFoundationBoolean(number)
        #endif
    }
    // Match the portable backend's canonical Foundation boolean check. Numeric
    // Int8/UInt8 values must not become booleans through objCType or Bool casts.
    static func isFoundationBoolean(_ number:NSNumber) -> Bool {
        number === NSNumber(value:true) || number === NSNumber(value:false)
    }
    private static func track(_ object:[String:Any],kind:String) throws -> CWNativeTrack {
        guard let token=object["stream_token"] as? String, token.utf8.count==32,
              token.utf8.allSatisfy({(48...57).contains($0)||(97...102).contains($0)}),
              let id=object["track_id"] as? String, id.isEmpty || UUID(uuidString:id) != nil,
              id.isEmpty ? ["stream","fault"].contains(kind) : true,
              let state=object["state"] as? String,
              (["stream":["acquiring"],"track":["acquiring","ambiguous","muted","overloaded"],"decode":["provisional"],
                "retired":["retired"],"fault":["inference_failed","discontinuity"]][kind] ?? []).contains(state) else { throw CWComputeError.invalidEvent }
        let delay=try number(object["filter_delay_seconds"]),offset=try number(object["offset_hz"])
        let revision=try counter(object["track_revision"]),first=try counter(object["first_sample"]),end=try counter(object["end_sample"])
        guard (0...1).contains(delay),abs(offset)<=192_000 else { throw CWComputeError.invalidEvent }
        guard state != "overloaded" || (revision>0 && first==end && end>0) else {throw CWComputeError.invalidEvent}
        let observation=try carrier(object,at:end)
        return CWNativeTrack(kind:kind,streamToken:token,epoch:try counter(object["epoch"]),trackID:id,
            revision:revision,state:state,firstSample:first,
            endSample:end,sourceFirstSample:try counter(object["source_first_sample"]),
            filterDelaySeconds:delay,offsetHz:offset,ambiguous:try boolean(object["ambiguous"]),replay:try boolean(object["replay"]),rfObservation:observation)
    }
    private static func carrier(_ object:[String:Any],at end:UInt64) throws -> CWCarrierObservation? {
        guard object["rf_offset_hz"] != nil || object["rf_sample"] != nil else{return nil}
        let offset=try number(object["rf_offset_hz"]),sample=try counter(object["rf_sample"])
        guard let measured=try? CWCarrierObservation(offsetHz:offset,sample:sample),measured.valid(at:end) else{throw CWComputeError.invalidEvent}
        return measured
    }

    public static func event(_ data:Data) throws -> CWComputeEvent {
        guard !data.isEmpty,data.count<=maximumEventBytes,
              let object=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],
              let kind=object["type"] as? String else { throw CWComputeError.invalidEvent }
        switch kind {
        case "ready":
            guard Set(object.keys)==["type","protocol_version","sample_rate","max_spans","max_tracks_per_span","inference_workers","runtime_version"],
                  try integer(object["protocol_version"],range:1...1)==1,
                  try integer(object["sample_rate"],range:3200...3200)==3200,
                  try integer(object["max_spans"],range:2...2)==2,
                  try integer(object["max_tracks_per_span"],range:16...16)==16,
                  try integer(object["inference_workers"],range:1...4)>=1,
                  let runtime=object["runtime_version"] as? String, (1...32).contains(runtime.utf8.count),
                  runtime.utf8.allSatisfy({(48...57).contains($0)||$0==46}) else { throw CWComputeError.invalidEvent }
            return .ready(runtime:runtime)
        case "status":
            guard Set(object.keys)==["type","request_sequence","sources","tracks","pending","in_flight","coalesced","dropped_events"] else { throw CWComputeError.invalidEvent }
            return .metrics(CWNativeMetrics(requestSequence:try counter(object["request_sequence"]),sources:try integer(object["sources"],range:0...2),
                tracks:try integer(object["tracks"],range:0...32),pending:try integer(object["pending"],range:0...32),inFlight:try integer(object["in_flight"],range:0...4),
                coalesced:try counter(object["coalesced"]),droppedEvents:try counter(object["dropped_events"])))
        case "stream","track","retired","fault":
            guard Set(object.keys)==trackKeys else { throw CWComputeError.invalidEvent }
            return .track(try track(object,kind:kind))
        case "decode":
            let required=trackKeys.union(["text","inference_ms","tokens"])
            guard required.isSubset(of:Set(object.keys)),Set(object.keys).isSubset(of:required.union(["estimated_wpm","estimated_snr_db","snr_reference_hz","rf_offset_hz","rf_sample"])),
                  let text=object["text"] as? String, text.utf8.count<=667,text.utf8.allSatisfy({alphabet.contains($0)}),
                  let rows=object["tokens"] as? [[String:Any]],rows.count<=667 else { throw CWComputeError.invalidEvent }
            let metadata=try track(object,kind:kind),inference=try number(object["inference_ms"])
            guard metadata.firstSample<metadata.endSample,metadata.endSample-metadata.firstSample<=32000,
                  (0...60_000).contains(inference) else { throw CWComputeError.invalidEvent }
            var tokens:[CWNativeToken]=[],last=metadata.firstSample
            for row in rows {
                let requiredToken:Set<String>=["symbol","first_sample","end_sample","log_score"]
                guard requiredToken.isSubset(of:Set(row.keys)),Set(row.keys).isSubset(of:requiredToken.union(["rf_offset_hz","rf_sample"])),
                      let symbol=row["symbol"] as? String,symbol.utf8.count==1,symbol.utf8.allSatisfy({alphabet.contains($0)}) else { throw CWComputeError.invalidEvent }
                let first=try counter(row["first_sample"]),end=try counter(row["end_sample"]),score=try number(row["log_score"])
                guard first>=last,end>=first,end<=metadata.endSample,first<end || end==metadata.endSample,
                      (-10000...0.001).contains(score) else { throw CWComputeError.invalidEvent }
                let observation=try carrier(row,at:end)
                tokens.append(CWNativeToken(symbol:symbol,firstSample:first,endSample:end,logScore:score,rfObservation:observation));last=end
            }
            guard tokens.map(\.symbol).joined()==text else { throw CWComputeError.invalidEvent }
            let wpm=try object["estimated_wpm"].map{try number($0)}
            let snr=try object["estimated_snr_db"].map{try number($0)}
            let reference=try object["snr_reference_hz"].map{try integer($0,range:2500...2500)}
            guard wpm.map({(5...80).contains($0)}) ?? true,snr.map({(-100...150).contains($0)}) ?? true,
                  (snr != nil)==(reference != nil) else{throw CWComputeError.invalidEvent}
            return .decode(CWNativeDecode(track:metadata,text:text,tokens:tokens,inferenceMilliseconds:inference,
                estimatedWPM:wpm,estimatedSNRDB:snr,snrReferenceHz:reference))
        default: throw CWComputeError.invalidEvent
        }
    }

    private static func append<T:FixedWidthInteger>(_ number:T,to data:inout Data) {
        var value=number.littleEndian; withUnsafeBytes(of:&value){data.append(contentsOf:$0)}
    }
    private static func header(kind:UInt16,token:UUID?,epoch:UInt64,sequence:UInt64,first:UInt64,rate:UInt32,count:UInt32) -> Data {
        var data=Data(); append(UInt16(1),to:&data);append(kind,to:&data)
        if let token { var bytes=token.uuid; withUnsafeBytes(of:&bytes){data.append(contentsOf:$0)} } else { data.append(Data(repeating:0,count:16)) }
        append(epoch,to:&data);append(sequence,to:&data);append(first,to:&data);append(rate,to:&data);append(count,to:&data)
        return data
    }
    private static func frame(_ body:Data) -> Data {
        var data=Data("XCW1".utf8);append(UInt32(body.count),to:&data);data.append(body);return data
    }
    public static func open(_ descriptor:CWStreamDescriptor) throws -> Data {
        guard let epoch=UInt64(descriptor.epoch) else { throw CWComputeError.invalidFrame }
        var body=header(kind:1,token:descriptor.streamToken,epoch:epoch,sequence:0,first:0,rate:UInt32(descriptor.sampleRate),count:0)
        let sign=Double(descriptor.spectralSign ?? 1)
        let a=Double(descriptor.usableLowerHz-descriptor.centreHz)*sign,b=Double(descriptor.usableUpperHz-descriptor.centreHz)*sign
        append(min(a,b).bitPattern,to:&body);append(max(a,b).bitPattern,to:&body)
        append(UInt32(descriptor.replay ? 1 : 0),to:&body);return frame(body)
    }
    public static func iq(_ block:CWIQBlock) throws -> Data {
        guard let epoch=UInt64(block.descriptor.epoch),block.sampleCount<=block.descriptor.sampleRate/8 else { throw CWComputeError.invalidFrame }
        // Build the final bounded frame once. Native LE Float32 bytes already
        // have the wire representation; avoid thousands of tiny Data appends
        // and a second whole-payload copy through frame(body).
        var packet=Data("XCW1".utf8);packet.reserveCapacity(60+block.samples.count*4)
        append(UInt32(52+block.samples.count*4),to:&packet)
        packet.append(header(kind:5,token:block.descriptor.streamToken,epoch:epoch,sequence:block.sequence,first:block.firstSample,
                             rate:UInt32(block.descriptor.sampleRate),count:UInt32(block.sampleCount)))
        #if _endian(little)
        block.samples.withUnsafeBytes{packet.append(contentsOf:$0)}
        #else
        for value in block.samples {append(value.bitPattern,to:&packet)}
        #endif
        return packet
    }
    public static func end(_ descriptor:CWStreamDescriptor,gap:Bool=false) throws -> Data {
        guard let epoch=UInt64(descriptor.epoch) else { throw CWComputeError.invalidFrame }
        return frame(header(kind:gap ? 6:3,token:descriptor.streamToken,epoch:epoch,sequence:0,first:0,rate:0,count:0))
    }
    public static func stop() -> Data { frame(header(kind:4,token:nil,epoch:0,sequence:0,first:0,rate:0,count:0)) }
    public static func mute(_ descriptor:CWStreamDescriptor,trackID:UUID) throws -> Data {
        guard let epoch=UInt64(descriptor.epoch),trackID != UUID(uuid:(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)) else {throw CWComputeError.invalidFrame}
        var body=header(kind:8,token:descriptor.streamToken,epoch:epoch,sequence:0,first:0,rate:0,count:0)
        var bytes=trackID.uuid;withUnsafeBytes(of:&bytes){body.append(contentsOf:$0)}
        return frame(body)
    }
    public static func metrics(sequence:UInt64) -> Data { frame(header(kind:7,token:nil,epoch:0,sequence:sequence,first:0,rate:0,count:0)) }
    public static func focus(_ descriptor:CWStreamDescriptor,trackID:UUID,revision:UInt64) throws -> Data {
        guard let epoch=UInt64(descriptor.epoch),trackID != UUID(uuid:(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0)) else{throw CWComputeError.invalidFrame}
        var body=header(kind:9,token:descriptor.streamToken,epoch:epoch,sequence:revision,first:0,rate:0,count:0)
        var bytes=trackID.uuid;withUnsafeBytes(of:&bytes){body.append(contentsOf:$0)}
        return frame(body)
    }
    public static func clearFocus() -> Data {frame(header(kind:10,token:nil,epoch:0,sequence:0,first:0,rate:0,count:0))}
}
