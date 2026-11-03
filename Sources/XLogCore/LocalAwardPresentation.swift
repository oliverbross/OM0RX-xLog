import Foundation

struct LocalAwardViewKey: Hashable { let scope: String; let band: String; let mode: String; let role: String }
struct LocalAwardView { var base: [String:Any]; var rows: [[String:Any]]; var evidence: [String:[LocalAwardEvidence]]; var days: [String:[String:Int]] }
/// Derived values belong to one immutable revision/rule/reference snapshot.
/// Four recently requested facets bound retention; matrices never rescan per cell.
final class LocalAwardPresentationCache: @unchecked Sendable {
    private let lock=NSLock()
    private var values: [LocalAwardViewKey:LocalAwardView]=[:]
    private var order: [LocalAwardViewKey]=[]
    func view(_ key: LocalAwardViewKey, build: () -> LocalAwardView) -> LocalAwardView {
        if let existing=lock.withLock({values[key]}) { return existing }
        let value=build()
        return lock.withLock {
            if let existing=values[key] { return existing }
            values[key]=value;order.append(key)
            if order.count>4 { values.removeValue(forKey:order.removeFirst()) }
            return value
        }
    }
}
extension LocalAwardSnapshot {
    public func preparePresentation(scope:String,band:String,mode:String,role:String) {
        _=presentation(scope:scope,band:band,mode:mode,role:role)
    }
    private func presentation(scope requestedScope:String,band:String,mode:String,role:String) -> LocalAwardView {
        let scope=requestedScope.isEmpty ? (scopes.first ?? "") : requestedScope
        return presentationCache.view(.init(scope:scope,band:band,mode:mode,role:role)) {
            func selected(_ e:LocalAwardEvidence) -> Bool {
                guard band.isEmpty || e.band.caseInsensitiveCompare(band) == .orderedSame else { return false }
                if mode.isEmpty || mode == "Mixed" { return true }
                if programme == "wpx",mode == "SSB" { return ["SSB","USB","LSB"].contains(e.mode.uppercased()) }
                return LocalAwardEngine.modeGroup(e.mode) == mode || e.mode.uppercased() == mode.uppercased()
            }
            func confirmed(_ e:LocalAwardEvidence) -> Bool { ["Y","V"].contains(e.paper.uppercased()) || (programme != "wac" && ["Y","V"].contains(e.lotw.uppercased())) }
            let scoped=units.filter{$0.scope == scope && (role.isEmpty || $0.role == role)}
            let visible=scoped.map{($0,$0.evidence.filter(selected))}
            let all=visible.flatMap(\.1),formatter=ISO8601DateFormatter()
            var evidence:[String:[LocalAwardEvidence]]=[:],allDays:[String:[String:Int]]=[:]
            let exclusions=(unclassified[scope] ?? []).filter(selected)
            evidence["unknown|__unknown__"]=exclusions
            let rows=visible.map{item,records -> [String:Any] in
                evidence[item.role+"|"+item.unit]=records
                let bands=Dictionary(grouping:records,by:\.band).mapValues{bandRows in
                    Dictionary(grouping:bandRows,by:{LocalAwardEngine.modeGroup($0.mode)}).mapValues{["worked":$0.count,"confirmationRecorded":$0.filter(confirmed).count]}
                }
                let days=Dictionary(grouping:records,by:{Int(floor($0.start.timeIntervalSince1970/86400))}).map{day,records in
                    (String(formatter.string(from:Date(timeIntervalSince1970:Double(day)*86400)).prefix(10)),Set(records.map(\.id)).count)
                }
                allDays[item.role+"|"+item.unit]=Dictionary(uniqueKeysWithValues:days)
                let points=item.chaserPointsPerDay.map{$0*days.count} ?? item.points
                return ["unit":item.unit,"role":item.role,"worked":records.count,"confirmationRecorded":records.filter(confirmed).count,
                    "bands":bands,"utcDays":Dictionary(uniqueKeysWithValues:days.sorted{$0.0>$1.0}.prefix(12)),"utcDayCount":days.count,"points":points as Any? ?? NSNull(),
                    "directoryMatched":records.first.map{!$0.reason.contains("directory match unavailable")} ?? false]
            }
            var target:Int?=nil
            if programme == "wac" { target=6 }
            if programme == "wpx", ["","Mixed","CW","SSB","Data"].contains(mode) {
                target=["CW","SSB","Data"].contains(mode) ? 300 : 400
                if !band.isEmpty { target=["160m":50,"80m":175,"60m":175,"40m":250,"30m":250,"20m":300,"17m":300,"15m":300,"12m":300,"10m":300,"6m":250][band.lowercased()] }
            }
            let base:[String:Any]=["programme":programme,"rulesVersion":LocalAwardEngine.rulesVersion,"referenceVersion":referenceVersion,
                "scopes":Array(scopes.prefix(128)),"scopeTotal":scopes.count,"stationScope":scope,"roles":Set(units.map(\.role)).sorted(),
                "bands":Set((units.flatMap(\.evidence)+unclassified.values.flatMap{$0}).map(\.band)).sorted(),"totalUnits":scoped.count,"workedUnits":visible.filter{!$0.1.isEmpty}.count,
                "supportingQSOs":Set(all.map(\.id)).count,"confirmationUnits":visible.filter{$0.1.contains(where:confirmed)}.count,
                "target":target as Any? ?? NSNull(),"directoryMatchedUnits":visible.filter{!$0.1.isEmpty && $0.1.first?.reason.contains("directory match unavailable") == false}.count,
                "unknownContacts":unknownContacts,"unclassifiedContacts":exclusions.count,"eligibility":"Local progress only. Sponsor eligibility incomplete; official credit unavailable.",
                "analytics":"Band/mode detail is local analysis; it does not imply a sponsor endorsement."]
            return LocalAwardView(base:base,rows:rows,evidence:evidence,days:allDays)
        }
    }
    public func projection(scope:String,band:String,mode:String,role:String,unit:String,unitRole:String="",offset:Int,limit:Int,dayOffset:Int=0,scopeSearch:String="") throws -> [String:Any] {
        let view=presentation(scope:scope,band:band,mode:mode,role:role)
        let records:[LocalAwardEvidence]
        if unit.isEmpty { records=[] }
        else if !unitRole.isEmpty { records=view.evidence[unitRole+"|"+unit] ?? [] }
        else {
            let matching=view.evidence.filter{$0.key.hasSuffix("|"+unit)}.flatMap(\.value)
            records=Dictionary(matching.map{($0.id,$0)},uniquingKeysWith:{first,_ in first}).values.sorted{$0.start == $1.start ? $0.id.uuidString<$1.id.uuidString : $0.start>$1.start}
        }
        var result=view.base
        let matchingScopes=scopes.filter{scopeSearch.isEmpty || $0.localizedCaseInsensitiveContains(scopeSearch)}
        result["scopes"]=Array(matchingScopes.prefix(128));result["scopeTotal"]=matchingScopes.count
        result["units"]=Array(view.rows.dropFirst(offset).prefix(limit))
        result["evidence"]=try JSONSerialization.jsonObject(with:JSONEncoder().encode(Array(records.dropFirst(offset).prefix(limit))))
        result["evidenceTotal"]=records.count;result["offset"]=offset;result["limit"]=limit
        let days=(view.days[unitRole+"|"+unit] ?? [:]).sorted{$0.key>$1.key}
        result["activationDays"]=days.dropFirst(dayOffset).prefix(limit).map{["day":$0.key,"qsos":$0.value] as [String:Any]}
        result["activationDayTotal"]=days.count
        return result
    }
}
