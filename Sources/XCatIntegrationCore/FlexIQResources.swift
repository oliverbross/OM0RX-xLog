// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

public enum FlexIQSubscriptionError: Error, Equatable, Sendable {
    case unavailable, stationChanged, unknownOwnership, missingPanadapter, missingChannel, ambiguousChannel
    case busy, handoffRequired, rateConflict, invalidPacket, overflow, noData, stalled, stopped
    case discoveryUnavailable, receiveUnverified
}
/// Bounded control-plane evidence only. Never includes IQ, license or discovery payloads.
public struct FlexIQDiagnosticEvent: Encodable, Sendable {
    public let monotonicNS:String
    public let connectionGeneration:Int
    public let operation:String
    public let detail:String
}
/// Last stopped UDP destination, before IQ parsing. Connection counts are not packet counts.
public struct FlexIQInputDiagnostics: Encodable, Sendable {
    public let expectedPeer:String
    public let expectedSourcePort:UInt16?
    public let acceptedSourcePort:UInt16?
    public let destinationPort:UInt16?
    public let candidateConnections:Int
    public let rejectedPeerConnections:Int
    public let rejectedPortConnections:Int
    public let extraMatchingConnections:Int
    public let firstRejectedEndpoint:String?
    public let acceptedPeerDatagrams:Int
    public let acceptedPeerBytes:UInt64
    public let firstPacketByteCount:Int?
    public let overflow:Bool
    public let readFailed:Bool
    public var maximumReaderQueueAgeNS:UInt64?=nil
    public var measuredReaderPackets:UInt64=0
}
public struct FlexIQPanadapter: Encodable, Equatable, Sendable {
    public let id:String
    public var clientHandle:UInt32?
    public var channel:Int?
    public var centreHz:Int64?
    public var receiveAntenna:String?
    public var transverter:String?
    public var pathProperties:[String:String]=[:]
}
public struct FlexIQStreamResource: Equatable, Sendable {
    public let id:UInt32
    public var clientHandle:UInt32?
    public var channel:Int?
    public var panadapter:UInt32?
    public var sampleRate:Int?
    public var active:Bool?
}
/// Pure observed metadata. Absence from this subscription is not proof that a
/// DAX channel is unused. An explicit, current operator handoff is still needed
/// before creating a new stream; known active competitors always block it.
public struct FlexIQResourceInventory: Sendable {
    public private(set) var revision:UInt64=0
    public private(set) var pans:[UInt32:FlexIQPanadapter]=[:]
    public private(set) var streams:[UInt32:FlexIQStreamResource]=[:]
    public init(){}
    public static func handle(_ text:String)->UInt32? {
        let value=text.lowercased().hasPrefix("0x") ? String(text.dropFirst(2)):text
        guard (1...8).contains(value.utf8.count),value.utf8.allSatisfy({(48...57).contains($0)||(65...70).contains($0)||(97...102).contains($0)}) else{return nil}
        return UInt32(value,radix:16)
    }
    public static func identifier(_ value:UInt32)->String{String(format:"%08x",value)}
    /// Receives the status body after S<handle>|. Unrelated objects are ignored.
    @discardableResult public mutating func consume(_ body:String)->Bool {
        guard body.utf8.count<=4096 else{return false}
        let words=body.split(separator:" ").map(String.init)
        let pan=words.count>=3 && words[0]=="display" && words[1]=="pan"
        let stream=words.count>=2 && words[0]=="stream"
        guard pan || stream,let id=Self.handle(words[pan ? 2:1]) else{return false}
        let tail=words.dropFirst(pan ? 3:2)
        let pairs=tail.compactMap {word -> (String,String)? in
            let pair=word.split(separator:"=",maxSplits:1,omittingEmptySubsequences:false)
            return pair.count==2 ? (String(pair[0]),String(pair[1])):nil
        }
        // Duplicate metadata keys cannot be resolved by guessing which is true.
        guard Set(pairs.map(\.0)).count==pairs.count else {
            let changed=pan ? pans.removeValue(forKey:id) != nil:streams.removeValue(forKey:id) != nil
            if changed{advance()};return changed
        }
        let values=Dictionary(uniqueKeysWithValues:pairs)
        if tail.contains("removed") || values["removed"] != nil {
            let changed=pan ? pans.removeValue(forKey:id) != nil:streams.removeValue(forKey:id) != nil
            if changed{advance()};return changed
        }
        if pan {
            guard pans[id] != nil || pans.count<16 else{return false}
            var next=pans[id] ?? FlexIQPanadapter(id:Self.identifier(id))
            if let text=values["client_handle"]{next.clientHandle=Self.handle(text)}
            if let text=values["daxiq_channel"]{next.channel=Self.channel(text)}
            if let text=values["center"] {
                if let mhz=Double(text),mhz.isFinite,(0.1...1000).contains(mhz){next.centreHz=Int64((mhz*1e6).rounded())}
                else{next.centreHz=nil}
            }
            if let text=values["rxant"]{next.receiveAntenna=Self.label(text)}
            if let text=values["xvtr"]{next.transverter=Self.label(text)}
            for key in ["rf_gain","pre","wide","loopa","loopb","preselector"] where values[key] != nil {
                next.pathProperties[key]=Self.label(values[key]!) ?? "invalid"
            }
            guard next != pans[id] else{return false};pans[id]=next;advance();return true
        }
        guard values["type"]=="dax_iq" || streams[id] != nil else{return false}
        guard streams[id] != nil || streams.count<128 else{return false}
        var next=streams[id] ?? FlexIQStreamResource(id:id)
        if let type=values["type"],type != "dax_iq" {streams.removeValue(forKey:id);advance();return true}
        if let text=values["client_handle"]{next.clientHandle=Self.handle(text)}
        if let text=values["daxiq_channel"]{next.channel=Self.channel(text)}
        if let text=values["pan"]{next.panadapter=Self.handle(text)}
        if let text=values["daxiq_rate"] ?? values["rate"] {
            next.sampleRate=Int(text).flatMap{[24000,48000,96000,192000].contains($0) ? $0:nil}
        }
        if let text=values["active"]{next.active=text=="1" ? true:text=="0" ? false:nil}
        guard next != streams[id] else{return false};streams[id]=next;advance();return true
    }
    public func permittedPanadapter(_ id:UInt32,stationHandle:UInt32?,ownedStreams:Set<UInt32>=[]) throws -> FlexIQPanadapter {
        guard revision<UInt64.max,let stationHandle else{throw FlexIQSubscriptionError.unknownOwnership}
        guard let pan=pans[id] else{throw FlexIQSubscriptionError.missingPanadapter}
        guard let owner=pan.clientHandle else{throw FlexIQSubscriptionError.unknownOwnership}
        guard owner==stationHandle else{throw FlexIQSubscriptionError.stationChanged}
        guard let channel=pan.channel,(1...8).contains(channel) else{throw FlexIQSubscriptionError.missingChannel}
        guard pan.centreHz != nil,let antenna=pan.receiveAntenna,!antenna.isEmpty,
              !pan.pathProperties.values.contains("invalid") else{throw FlexIQSubscriptionError.unavailable}
        guard !pans.contains(where:{$0.key != id && $0.value.clientHandle==stationHandle && $0.value.channel==channel}) else {
            throw FlexIQSubscriptionError.ambiguousChannel
        }
        guard !streams.values.contains(where:{$0.channel==channel && !ownedStreams.contains($0.id) && $0.active==true}) else {
            throw FlexIQSubscriptionError.busy
        }
        return pan
    }
    private mutating func advance(){if revision<UInt64.max{revision+=1}}
    private static func channel(_ text:String)->Int?{Int(text).flatMap{(0...8).contains($0) ? $0:nil}}
    private static func label(_ text:String)->String? {
        guard text.utf8.count<=64,text.utf8.allSatisfy({$0>=32 && $0<127}) else{return nil};return text
    }
}
