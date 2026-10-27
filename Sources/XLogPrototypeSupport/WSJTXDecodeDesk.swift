#if os(macOS)
import Foundation

/// Bounded, instance-scoped evidence from WSJT-X v3.0.2 schema 2/3.
/// Selection is not a QSO, and Reply is withheld without an admitted output owner.
struct WSJTXDecodeDesk {
    struct Decode {
        let id = UUID().uuidString
        let sender: String, instance: String, message: String, marker: String
        let schema: UInt32, time: UInt32, snr: Int32, delta: Double, offset: UInt32
        let low: Bool, offAir: Bool, receivedAt: UInt64
        var wire: [String: Any] { ["id":id,"sender":sender,"instanceID":instance,"schema":schema,"periodMS":time,
            "snr":snr,"deltaSeconds":delta,"offsetHz":offset,"decodeMode":marker,"message":message,
            "lowConfidence":low,"offAir":offAir,"receivedAtMS":receivedAt] }
    }
    private var rows: [Decode] = []
    private var contexts: [String: (frequency:UInt64,mode:String,version:String,seen:UInt64)] = [:]
    mutating func reset() { rows=[];contexts=[:] }
    mutating func receive(_ data:Data, sender:String, now:UInt64) throws {
        guard let activity=try WSJTXActivityMessage.parse(data) else{return}
        let key=sender+"\u{1f}"+activity.instance
        expire(now)
        switch activity {
        case .close, .clear: rows.removeAll{$0.sender==sender&&$0.instance==activity.instance};if case .close=activity{contexts[key]=nil}
        case .status(_,let frequency,let mode):
            if let old=contexts[key],old.frequency != frequency || old.mode != mode{rows.removeAll{$0.sender==sender&&$0.instance==activity.instance}}
            contexts[key]=(frequency,mode,contexts[key]?.version ?? "Unknown",now)
        case .heartbeat:
            var reader=Reader(data:data);_ = try reader.number(4);_ = try reader.number(4);_ = try reader.number(4);_ = try reader.text();_ = try reader.number(4)
            let version=try reader.text(),revision=try reader.text(),identity=version+" / "+revision
            if let old=contexts[key],old.version != identity{rows.removeAll{$0.sender==sender&&$0.instance==activity.instance}}
            let old=contexts[key];contexts[key]=(old?.frequency ?? 0,old?.mode ?? "",identity,now)
        case .decode:
            var reader=Reader(data:data);_ = try reader.number(4);let schema=UInt32(try reader.number(4));_ = try reader.number(4)
            let instance=try reader.text(),new=try reader.number(1),time=UInt32(try reader.number(4)),snr=Int32(bitPattern:UInt32(try reader.number(4)))
            let delta=Double(bitPattern:try reader.number(8)),offset=UInt32(try reader.number(4)),marker=try reader.text(),message=try reader.text()
            let low=try reader.number(1) != 0,offAir=try reader.number(1) != 0
            guard new==1,let context=contexts[key],context.frequency>0,now>=context.seen,now-context.seen<=120_000 else{return}
            let day=Int64(now/86_400_000*86_400_000),timeUTC=[day+Int64(time),day+Int64(time)-86_400_000,day+Int64(time)+86_400_000].min{abs($0-Int64(now))<abs($1-Int64(now))}!
            guard abs(timeUTC-Int64(now))<=60_000 else{return}
            guard !rows.contains(where:{$0.sender==sender&&$0.instance==instance&&$0.time==time&&$0.message==message&&$0.offset==offset})else{return}
            rows.append(Decode(sender:sender,instance:instance,message:message,marker:marker,schema:schema,time:time,snr:snr,delta:delta,offset:offset,low:low,offAir:offAir,receivedAt:now))
            if rows.count>100{rows.removeFirst(rows.count-100)}
        }
    }
    mutating func expire(_ now:UInt64){rows.removeAll{now<$0.receivedAt||now-$0.receivedAt>60_000};contexts=contexts.filter{now >= $0.value.seen&&now-$0.value.seen<=180_000}}
    mutating func select(_ id:String, now:UInt64)throws->[String:Any]{
        expire(now);guard let row=rows.first(where:{$0.id==id}),!row.low,!row.offAir,let context=contexts[row.sender+"\u{1f}"+row.instance],now-context.seen<=120_000 else{throw WorkerFailure("stale_decode","This decode expired or its instance changed. Review a fresh decode.")}
        return decorate(row,context:context)
    }
    mutating func snapshot(now:UInt64)->[[String:Any]]{expire(now);return rows.reversed().compactMap{row in contexts[row.sender+"\u{1f}"+row.instance].map{decorate(row,context:$0)}}}
    private func decorate(_ row:Decode,context:(frequency:UInt64,mode:String,version:String,seen:UInt64))->[String:Any]{
        var wire=row.wire;wire["frequencyHz"]=context.frequency+UInt64(row.offset);wire["mode"]=context.mode;wire["engineVersion"]=context.version
        wire["replySupported"]=false;wire["replyLimitation"]="Reply can initiate external transmission; no qualified shared output/release contract is available. Select only."
        return wire
    }
    private struct Reader {
        let data:Data;var offset=0
        mutating func number(_ count:Int)throws->UInt64{guard count<=8,offset<=data.count-count else{throw WSJTXMessageError.invalid};defer{offset+=count};return data[offset..<(offset+count)].reduce(0){($0<<8)|UInt64($1)}}
        mutating func text()throws->String{let count=try number(4);if count==UInt32.max{return ""};guard count<=4096,offset<=data.count-Int(count),let text=String(data:data[offset..<(offset+Int(count))],encoding:.utf8)else{throw WSJTXMessageError.invalid};offset+=Int(count);return text}
    }
}
#endif
