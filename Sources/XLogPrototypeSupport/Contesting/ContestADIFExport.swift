import Foundation
import XContestCore
#if canImport(XLogCore)
import XLogCore
#elseif canImport(XLogPortableCore)
import XLogPortableCore
#endif

public enum ContestADIFExportError: Error, Equatable {
    case invalidInput
    case invalidExtensionMetadata
}

public enum ContestADIFExport {
    private static let programID = "OM0RXXLOG"

    public static func records(input: ContestExportInput, rule: any ContestRule) throws -> [ADIFRecord] {
        do { _ = try input.validatedScore(rule: rule) }
        catch { throw ContestADIFExportError.invalidInput }
        return try input.deterministicallyOrderedQSOs.map { qso in
            var fields = try standardFields(qso: qso, input: input, rule: rule)
            guard validADIFDate(qso.timestampUTC), fields.values.allSatisfy(validADIFText) else {
                throw ContestADIFExportError.invalidInput
            }
            let extensions = extensionFields(qso: qso, input: input)
            fields.merge(extensions, uniquingKeysWith: { _, new in new })
            let metadata = ADIFFieldMetadata(extensions: Dictionary(uniqueKeysWithValues: extensions.keys.map { key in
                let name = String(key.dropFirst("APP_\(programID)_".count))
                let type = ["SESSION_REVISION", "IMPORTED_CLAIMED_SCORE"].contains(name) ? "N" : "S"
                return (key, .init(kind: "APP", attributes: ["PROGRAMID": programID, "FIELDNAME": name, "TYPE": type]))
            }))
            do { try metadata.validate(fields: fields) }
            catch { throw ContestADIFExportError.invalidExtensionMetadata }
            return ADIFRecord(fields: fields, fieldMetadata: metadata)
        }
    }

    public static func document(input: ContestExportInput, rule: any ContestRule,
                                programName: String = "OM0RX-xLog") throws -> String {
        let records = try records(input: input, rule: rule)
        guard validADIFDate(input.generatedAtUTC), validADIFText(programName),
              validADIFText(input.formatterVersion) else { throw ContestADIFExportError.invalidInput }
        var headerFields = [
            ("ADIF_VER", "3.1.7"),
            ("PROGRAMID", programName),
            ("PROGRAMVERSION", input.formatterVersion),
            ("CREATED_TIMESTAMP", utc("yyyyMMdd HHmmss", input.generatedAtUTC)),
        ]
        if let projection = (rule as? any ContestRuleDeclarativeExportPolicy)?.declarativeExportProjection {
            guard projection.purpose == .operatorArchive else { throw ContestADIFExportError.invalidInput }
            headerFields.append(("APP_\(programID)_EXPORT_PURPOSE", "OPERATOR_ARCHIVE"))
        }
        let header = headerFields.map { "<\($0.0):\($0.1.utf8.count)>\($0.1)" }.joined() + "<EOH>\r\n"
        return header + records.map(\.recordDocument).joined(separator: "\r\n") + (records.isEmpty ? "" : "\r\n")
    }

    private static func standardFields(qso: ContestQSO, input: ContestExportInput,
                                       rule: any ContestRule) throws -> [String: String] {
        var fields = [
            "CALL": qso.callsign,
            "QSO_DATE": utc("yyyyMMdd", qso.timestampUTC),
            "TIME_ON": utc("HHmmss", qso.timestampUTC),
            "BAND": qso.band,
            "MODE": rule.metadata.entry.modeProfile(for: qso.mode)?.adifMode ?? qso.mode,
            "FREQ": String(format: "%.6f", Double(qso.frequencyHz) / 1_000_000.0),
            "STATION_CALLSIGN": input.session.station.callsign,
            "OPERATOR": qso.operatorCallsign.isEmpty ? input.metadata.operatorCallsign : qso.operatorCallsign,
            "CONTEST_ID": adifContestID(for: rule),
            "STX_STRING": qso.exchange.rawSent,
            "SRX_STRING": qso.exchange.rawReceived,
        ]
        if !qso.rstSent.isEmpty { fields["RST_SENT"] = qso.rstSent }
        if !qso.rstReceived.isEmpty { fields["RST_RCVD"] = qso.rstReceived }
        if let submode = rule.metadata.entry.modeProfile(for: qso.mode)?.adifSubmode {
            fields["SUBMODE"] = submode
        }
        switch rule.metadata.entry.exchange.adifFields {
        case .stxSrx:
            if let sent = Int(qso.exchange.normalizedSent) { fields["STX"] = String(sent) }
            if let received = Int(qso.exchange.normalizedReceived) { fields["SRX"] = String(received) }
        case .exchangeStrings:
            try addStructuredExchangeFields(to: &fields, qso: qso, input: input, rule: rule)
        case .none:
            break
        }
        return fields
    }

    private static func adifContestID(for rule: any ContestRule) -> String {
        if rule.metadata.entry.cabrilloFormatterVersion == ContestExportInput.jidxPreviewFormatterVersion,
           rule.metadata.identity == JIDXSSBRule.identity {
            return "JIDX-SSB"
        }
        return rule.metadata.cabrilloName
    }

    private static func addStructuredExchangeFields(to fields: inout [String: String], qso: ContestQSO,
                                                     input: ContestExportInput, rule: any ContestRule) throws {
        if rule.metadata.entry.cabrilloFormatterVersion == ContestExportInput.arrlRTTYPreviewFormatterVersion {
            addARRLRTTYExchangeFields(to: &fields, qso: qso, input: input)
            return
        }
        if rule.metadata.entry.cabrilloFormatterVersion == ContestExportInput.arrlDXCWPreviewFormatterVersion ||
            rule.metadata.entry.cabrilloFormatterVersion == ContestExportInput.arrlDXSSBPreviewFormatterVersion {
            addARRLDXExchangeFields(to: &fields, qso: qso, input: input)
            return
        }
        if rule.metadata.entry.cabrilloFormatterVersion == ContestExportInput.jidxPreviewFormatterVersion {
            addDescriptorMappedNumberFields(to: &fields,
                                            descriptors: rule.metadata.entry.exchange.sentFields,
                                            values: qso.exchange.sentFields, expectedField: .stx)
            addDescriptorMappedNumberFields(to: &fields,
                                            descriptors: rule.metadata.entry.exchange.receivedFields,
                                            values: qso.exchange.receivedFields, expectedField: .srx)
            return
        }
        if rule.metadata.entry.cabrilloFormatterVersion == ContestExportInput.naqpPreviewFormatterVersion {
            if let name = qso.exchange.sentFields["name"]?.normalized { fields["MY_NAME"] = name }
            if let name = qso.exchange.receivedFields["name"]?.normalized { fields["NAME"] = name }
            if let entity = input.session.station.entity,
               !isAirOrMaritimeMobile(input.session.station.callsign), adifStateIsApplicable(entity),
               let state = qso.exchange.sentFields["location"]?.normalized {
                fields["MY_STATE"] = state
            }
            if let entity = qso.entity, !isAirOrMaritimeMobile(qso.callsign),
               adifStateIsApplicable(entity),
               let state = qso.exchange.receivedFields["location"]?.normalized {
                fields["STATE"] = state
            }
            return
        }
        guard let projection = (rule as? any ContestRuleDeclarativeExportPolicy)?.declarativeExportProjection,
              projection.purpose == .operatorArchive else { return }
        let mapped = try descriptorMappedFields(
            sentDescriptors: rule.metadata.entry.exchange.sentFields,
            receivedDescriptors: rule.metadata.entry.exchange.receivedFields,
            sentValues: qso.exchange.sentFields, receivedValues: qso.exchange.receivedFields,
            stationCallsign: input.session.station.callsign, stationEntity: input.session.station.entity,
            workedCallsign: qso.callsign, workedEntity: qso.entity)
        for (name, value) in mapped { fields[name] = value }
    }

    static func descriptorMappedFields(
        sentDescriptors: [ContestExchangeFieldDescriptor],
        receivedDescriptors: [ContestExchangeFieldDescriptor],
        sentValues: [String: ContestExchangeFieldValue],
        receivedValues: [String: ContestExchangeFieldValue],
        stationCallsign: String, stationEntity: ContestEntitySnapshot?,
        workedCallsign: String, workedEntity: ContestEntitySnapshot?
    ) throws -> [String: String] {
        let sentTargets: Set<ContestADIFField> = [.stx, .myName, .myState, .myGridSquare]
        let receivedTargets: Set<ContestADIFField> = [.srx, .name, .state, .gridSquare]
        var result: [String: String] = [:]
        try mapDescriptors(sentDescriptors, values: sentValues, allowedTargets: sentTargets,
                           callsign: stationCallsign, entity: stationEntity, into: &result)
        try mapDescriptors(receivedDescriptors, values: receivedValues, allowedTargets: receivedTargets,
                           callsign: workedCallsign, entity: workedEntity, into: &result)
        return result
    }

    private static func mapDescriptors(
        _ descriptors: [ContestExchangeFieldDescriptor], values: [String: ContestExchangeFieldValue],
        allowedTargets: Set<ContestADIFField>, callsign: String, entity: ContestEntitySnapshot?,
        into result: inout [String: String]
    ) throws {
        var mappedTargets: Set<ContestADIFField> = []
        for descriptor in descriptors {
            guard let target = descriptor.adifField else { continue }
            guard allowedTargets.contains(target), mappedTargets.insert(target).inserted else {
                throw ContestADIFExportError.invalidInput
            }
            guard let value = values[descriptor.id]?.normalized, !value.isEmpty else {
                if descriptor.required { throw ContestADIFExportError.invalidInput }
                continue
            }
            let mapped: String
            switch target {
            case .stx, .srx:
                guard value.allSatisfy(\.isNumber), let number = Int(value), number >= 0 else {
                    throw ContestADIFExportError.invalidInput
                }
                mapped = String(number)
            case .gridSquare, .myGridSquare:
                let bytes = Array(value.utf8)
                guard bytes.count == 4, (65...82).contains(bytes[0]), (65...82).contains(bytes[1]),
                      (48...57).contains(bytes[2]), (48...57).contains(bytes[3]) else {
                    throw ContestADIFExportError.invalidInput
                }
                mapped = value
            case .state, .myState:
                guard printableASCII(value) else { throw ContestADIFExportError.invalidInput }
                guard let entity, !isAirOrMaritimeMobile(callsign), adifStateIsApplicable(entity) else { continue }
                mapped = value
            case .name, .myName:
                guard printableASCII(value) else { throw ContestADIFExportError.invalidInput }
                mapped = value
            }
            result[target.rawValue] = mapped
        }
    }

    private static func printableASCII(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.allSatisfy { (32...126).contains($0) }
    }

    private static func addDescriptorMappedNumberFields(to fields: inout [String: String],
                                                        descriptors: [ContestExchangeFieldDescriptor],
                                                        values: [String: ContestExchangeFieldValue],
                                                        expectedField: ContestADIFField) {
        for descriptor in descriptors where descriptor.adifField == expectedField {
            guard let normalized = values[descriptor.id]?.normalized,
                  let number = Int(normalized) else { continue }
            fields[expectedField.rawValue] = String(number)
        }
    }

    private static func addARRLRTTYExchangeFields(to fields: inout [String: String], qso: ContestQSO,
                                                   input: ContestExportInput) {
        if let own = input.session.station.entity {
            fields["MY_DXCC"] = String(own.adif)
            if own.adif == 291 || own.adif == 1 {
                if let location = qso.exchange.sentFields["location"]?.normalized {
                    fields["MY_STATE"] = arrlADIFSubdivision(location, entityADIF: own.adif)
                }
            } else if let serial = qso.exchange.sentFields["serial"]?.normalized,
                      Int(serial).map({ $0 > 0 }) == true {
                fields["STX"] = serial
            }
        }
        if let worked = qso.entity {
            fields["DXCC"] = String(worked.adif)
            if worked.adif == 291 || worked.adif == 1 {
                if let location = qso.exchange.receivedFields["exchange"]?.normalized {
                    fields["STATE"] = arrlADIFSubdivision(location, entityADIF: worked.adif)
                }
            } else if let serial = qso.exchange.receivedFields["exchange"]?.normalized,
                      Int(serial).map({ $0 > 0 }) == true {
                fields["SRX"] = serial
            }
        }
    }

    private static func addARRLDXExchangeFields(to fields: inout [String: String], qso: ContestQSO,
                                                 input: ContestExportInput) {
        if let own = input.session.station.entity {
            fields["MY_DXCC"] = String(own.adif)
            if own.adif == 291 || own.adif == 1,
               let location = qso.exchange.sentFields["location"]?.normalized {
                fields["MY_STATE"] = arrlADIFSubdivision(location, entityADIF: own.adif)
            }
        }
        if let worked = qso.entity {
            fields["DXCC"] = String(worked.adif)
            if worked.adif == 291 || worked.adif == 1,
               let location = qso.exchange.receivedFields["location"]?.normalized {
                fields["STATE"] = arrlADIFSubdivision(location, entityADIF: worked.adif)
            }
        }
    }

    private static func arrlADIFSubdivision(_ value: String, entityADIF: Int) -> String {
        entityADIF == 1 && (value == "LB" || value == "NF") ? "NL" : value
    }

    private static func adifStateIsApplicable(_ entity: ContestEntitySnapshot) -> Bool {
        [1, 6, 110, 291].contains(entity.adif)
    }

    private static func isAirOrMaritimeMobile(_ callsign: String) -> Bool {
        callsign.split(separator: "/").contains { $0 == "MM" || $0 == "AM" }
    }

    private static func extensionFields(qso: ContestQSO, input: ContestExportInput) -> [String: String] {
        var values = [
            app("SESSION_ID"): input.session.id.uuidString.lowercased(),
            app("WORKSPACE_GENERATION"): input.session.workspaceGeneration.uuidString.lowercased(),
            app("SESSION_REVISION"): String(input.sessionRevision),
            app("QSO_ID"): qso.id.uuidString.lowercased(),
            app("RULE_ID"): input.ruleIdentity.id,
            app("RULE_VERSION"): input.ruleIdentity.version,
            app("RULE_EDITION"): input.ruleIdentity.edition,
            app("RULE_SOURCE_REVISION"): input.ruleIdentity.sourceRevision,
            app("REFERENCE_DATA_VERSION"): input.referenceDataVersion,
            app("PROVENANCE_SOURCE"): qso.provenance.source.rawValue,
            app("INPUT_SCHEMA_VERSION"): input.schemaVersion,
            app("FORMATTER_VERSION"): input.formatterVersion,
        ]
        if let identity = qso.provenance.sourceIdentity { values[app("PROVENANCE_IDENTITY")] = identity }
        if let score = qso.provenance.importedClaimedScore { values[app("IMPORTED_CLAIMED_SCORE")] = String(score) }
        return values
    }

    private static func app(_ field: String) -> String { "APP_\(programID)_\(field)" }
    private static func validADIFText(_ value: String) -> Bool {
        value.unicodeScalars.allSatisfy { (32...126).contains($0.value) }
    }
    private static func validADIFDate(_ date: Date) -> Bool {
        let year = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(secondsFromGMT: 0)!, from: date).year
        return year.map { (1930...9999).contains($0) } == true
    }
    private static func utc(_ format: String, _ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = format
        return formatter.string(from: date)
    }
}
