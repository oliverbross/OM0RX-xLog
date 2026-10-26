// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

public struct FlexIQIdentity: Equatable, Encodable, Sendable {
    public let serial:String
    public let model:String
    public let address:String
    public let controlPort:UInt16
    /// Independently parsed manufacturer discovery, never inferred from a slice.
    public static func parse(_ data:Data) throws -> Self {
        guard (20...8192).contains(data.count),data.count%4==0 else{throw FlexIQSubscriptionError.invalidPacket}
        let bytes=[UInt8](data)
        func be(_ n:Int)->UInt32{UInt32(bytes[n])<<24|UInt32(bytes[n+1])<<16|UInt32(bytes[n+2])<<8|UInt32(bytes[n+3])}
        let header=be(0)
        guard header>>28==3,header&0x0800_0000 != 0,Int(header&0xffff)*4==data.count,
              be(8)==0x1c2d,be(12)&0xffff==0xffff else{throw FlexIQSubscriptionError.invalidPacket}
        let offset=16+(header>>22&3 != 0 ? 4:0)+(header>>20&3 != 0 ? 8:0)
        let end=bytes.count-(header&0x0400_0000 != 0 ? 4:0)
        guard end>offset,let text=String(bytes:bytes[offset..<end],encoding:.utf8),
              text.utf8.allSatisfy({$0>=32 && $0<127}) else{throw FlexIQSubscriptionError.invalidPacket}
        var fields:[String:String]=[:]
        for word in text.split(separator:" ") {
            let pair=word.split(separator:"=",maxSplits:1,omittingEmptySubsequences:false)
            guard pair.count==2 else{throw FlexIQSubscriptionError.invalidPacket}
            let key=String(pair[0]);guard fields[key]==nil else{throw FlexIQSubscriptionError.invalidPacket}
            fields[key]=String(pair[1])
        }
        guard let serial=fields["serial"],(4...64).contains(serial.utf8.count),
              serial.utf8.allSatisfy({(48...57).contains($0)||(65...90).contains($0)||(97...122).contains($0)||$0==45}),
              let model=fields["model"],model.hasPrefix("FLEX-"),model.utf8.count<=32,
              let address=fields["ip"],!address.isEmpty,address.utf8.count<=64,
              let port=fields["port"].flatMap(UInt16.init),port>0 else{throw FlexIQSubscriptionError.invalidPacket}
        return Self(serial:serial,model:model,address:address,controlPort:port)
    }
}
public struct FlexIQCapture:Equatable,Sendable {
    public let streamToken:UUID
    public let epoch:UInt64
    public let connectionGeneration:Int
    public let identity:FlexIQIdentity
    public let stationHandle:UInt32
    public let panadapter:FlexIQPanadapter
    public let streamID:UInt32
    public let sampleRate:Int
}
public struct FlexIQBlock:Sendable {
    public let capture:FlexIQCapture
    public let sequence:UInt64
    public let firstSample:UInt64
    public let receivedMonotonicNS:UInt64
    public let packet:FlexIQPacket
}
public struct FlexIQSubscription:Sendable {
    public let leaseID:UUID
    public let blocks:AsyncThrowingStream<FlexIQBlock,Error>
}
public struct FlexIQCapabilities:Encodable,Sendable {
    public let connectionGeneration:Int
    public let inventoryRevision:String
    public let ready:Bool
    public let identity:FlexIQIdentity?
    public let stationHandle:UInt32?
    public let panadapters:[FlexIQPanadapter]
    public let requestableSampleRates:[Int]
    public let transmitStateKnownOff:Bool
    public let handoffPanadapters:[String]
}
/// Explicit operator permission is bound to the exact metadata shown at handoff.
/// It cannot override a known competitor and is never persisted or auto-renewed.
struct FlexIQHandoff:Sendable {
    let generation:Int
    let competitors:[FlexIQStreamResource]
    let pan:FlexIQPanadapter
    let station:UInt32
    let expiresNS:UInt64
    func permits(generation:Int,inventory:FlexIQResourceInventory,owned:Set<UInt32>,pan:FlexIQPanadapter,station:UInt32,now:UInt64)->Bool {
        let current=inventory.streams.values.filter{$0.channel==pan.channel && !owned.contains($0.id)}.sorted{$0.id<$1.id}
        return self.generation==generation && competitors==current && self.pan==pan && self.station==station && now<expiresNS
    }
}
