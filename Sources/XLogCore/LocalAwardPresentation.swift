import Foundation

struct LocalAwardViewKey: Hashable { let scope: String; let band: String; let mode: String; let role: String }
struct LocalAwardView { var base: [String:Any]; var rows: [[String:Any]]; var evidence: [String:[LocalAwardEvidence]]; var days: [String:[String:Int]]; var potaDays: [String:[[String:Any]]] }

/// Local counting only. Uploaded-account identity and operation eligibility are
/// not inferred from a stored callsign, a park reference or a count of rows.
private func potaActivationDay(_ day:String,records:[LocalAwardEvidence]) -> [String:Any] {
    var programmeKeys=Set<String>(),eventKeys=Set<String>(),expanded=0,unknown=Set<UUID>(),excluded=Set<UUID>(),reasons=Set<String>()
    var directoryVerified=true
    for record in records {
        guard let context=record.pota else { unknown.insert(record.id);reasons.insert("Counting evidence unavailable");continue }
        if let issue=context.issue {
            if context.invalid { excluded.insert(record.id) } else { unknown.insert(record.id) }
            reasons.insert(issue);continue
        }
        if context.state.isEmpty { unknown.insert(record.id);reasons.insert("Subdivision/location not recorded; cross-subdivision grouping is unresolved");continue }
        let parks=context.contactedParks.isEmpty ? [""] : context.contactedParks
        // Official uniqueness includes individual SIG_INFO, but not QSO time.
        // A conservative contact-event lower bound excludes contacted parks:
        // expanded or overlapping park sets cannot inflate the ten-QSO minimum.
        let base=[context.stationCall,record.call.trimmingCharacters(in:.whitespacesAndNewlines).uppercased(),context.countingMode,day,record.band.uppercased(),context.state]
        for park in parks { expanded+=1;programmeKeys.insert((base+[park]).joined(separator:"\u{1f}")) }
        if record.reason.contains("directory match unavailable") { directoryVerified=false;unknown.insert(record.id);continue }
        eventKeys.insert(base.joined(separator:"\u{1f}"))
    }
    if !directoryVerified { reasons.insert("Own park directory membership unverified") }
    let reached=eventKeys.count>=10
    let status:String
    if reached { status="local candidate" }
    else if !unknown.isEmpty || !directoryVerified { status="incomplete" }
    else if programmeKeys.count>=10 && !reached {
        status="conditional";reasons.insert("Multi-park log-record expansion reaches ten, but its effect on the activation minimum is not established; no threshold success inferred")
    } else { status="below threshold" }
    return ["day":day,"physicalRows":Set(records.map(\.id)).count,"countableContacts":eventKeys.count,
        "programmeLogRecords":programmeKeys.count,"duplicateProgrammeRecords":expanded-programmeKeys.count,
        "unknownEligibilityRows":unknown.count,"excludedRows":excluded.count,"threshold":10,
        "thresholdReached":reached,"candidateStatus":status,"reasons":reasons.sorted(),
        "eligibility":"Operation/location access, licensing, relays, automation, account ownership and portal acceptance remain unverified."]
}
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
            var evidence:[String:[LocalAwardEvidence]]=[:],allDays:[String:[String:Int]]=[:],potaDays:[String:[[String:Any]]]=[:]
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
                var row:[String:Any] = ["unit":item.unit,"role":item.role,"worked":records.count,"confirmationRecorded":records.filter(confirmed).count,
                    "bands":bands,"utcDays":Dictionary(uniqueKeysWithValues:days.sorted{$0.0>$1.0}.prefix(12)),"utcDayCount":days.count,"points":points as Any? ?? NSNull(),
                    "directoryMatched":records.first.map{!$0.reason.contains("directory match unavailable")} ?? false]
                if programme == "pota", item.role == "activator" {
                    let grouped=Dictionary(grouping:records,by:{String(formatter.string(from:$0.start).prefix(10))})
                    let summaries=grouped.keys.sorted(by:>).map{potaActivationDay($0,records:grouped[$0]!)}
                    potaDays[item.role+"|"+item.unit]=summaries
                    row["activationCandidates"]=Array(summaries.prefix(12))
                }
                return row
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
                "recordedLocationCount":Set((all+exclusions).compactMap(\.recordedContext)).count,
                "analytics":"Band/mode detail is local analysis; it does not imply a sponsor endorsement."]
            return LocalAwardView(base:base,rows:rows,evidence:evidence,days:allDays,potaDays:potaDays)
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
        result["activationCandidates"]=Array((view.potaDays[unitRole+"|"+unit] ?? []).dropFirst(dayOffset).prefix(limit))
        return result
    }
}
