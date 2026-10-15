import Foundation

private func adifDate(day: String, time: String) -> Date? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyyMMddHHmmss"
    formatter.isLenient = false
    return formatter.date(from: day + time.padding(toLength: 6, withPad: "0", startingAt: 0))
}

private func adifFrequency(_ text: String) -> Int64? {
    guard let mhz = Double(text), mhz.isFinite else { return nil }
    let hertz = mhz * 1_000_000
    return hertz.isFinite ? Int64(exactly: hertz.rounded()) : nil
}

public extension QSO {
    init?(adif record: ADIFRecord, wavelogID: Int? = nil) {
        guard let call = record["CALL"], !call.isEmpty,
              let dateText = record["QSO_DATE"], dateText.count == 8,
              let timeText = record["TIME_ON"], !timeText.isEmpty else { return nil }
        guard let start = adifDate(day: dateText, time: timeText) else { return nil }
        let frequencyHz: Int64?
        if let text = record["FREQ"] {
            guard let value = adifFrequency(text) else { return nil }
            frequencyHz = value
        } else {
            frequencyHz = nil
        }
        let receiveFrequencyHz: Int64?
        if let text = record["FREQ_RX"] {
            guard let value = adifFrequency(text) else { return nil }
            receiveFrequencyHz = value
        } else {
            receiveFrequencyHz = nil
        }
        let end: Date?
        if record["QSO_DATE_OFF"] != nil || record["TIME_OFF"] != nil {
            guard let value = adifDate(day: record["QSO_DATE_OFF"] ?? dateText,
                                       time: record["TIME_OFF"] ?? timeText) else { return nil }
            end = value
        } else {
            end = nil
        }
        self.init(
            wavelogID: wavelogID,
            call: call,
            start: start,
            end: end,
            band: record["BAND"] ?? frequencyHz.map(BandPlan.band(for:)) ?? "",
            mode: record["MODE"] ?? "SSB",
            submode: record["SUBMODE"] ?? "",
            frequencyHz: frequencyHz,
            receiveFrequencyHz: receiveFrequencyHz,
            receiveBand: record["BAND_RX"] ?? receiveFrequencyHz.map(BandPlan.band(for:)) ?? "",
            rstSent: record["RST_SENT"] ?? "",
            rstReceived: record["RST_RCVD"] ?? "",
            name: record["NAME"] ?? "",
            gridSquare: record["GRIDSQUARE"] ?? "",
            country: record["COUNTRY"] ?? "",
            dxcc: record["DXCC"].flatMap(Int.init),
            continent: record["CONT"] ?? "",
            cqZone: record["CQZ"] ?? "",
            ituZone: record["ITUZ"] ?? "",
            state: record["STATE"] ?? "",
            county: record["CNTY"] ?? "",
            qth: record["QTH"] ?? "",
            iota: record["IOTA"] ?? "",
            sotaReference: record["SOTA_REF"] ?? "",
            potaReference: record["POTA_REF"] ?? "",
            wwffReference: record["WWFF_REF"] ?? "",
            sig: record["SIG"] ?? "",
            sigInfo: record["SIG_INFO"] ?? "",
            dok: record["DARC_DOK"] ?? "",
            comment: record["COMMENT"] ?? "",
            notes: record["NOTES"] ?? "",
            txPower: record["TX_PWR"] ?? "",
            operatorCall: record["OPERATOR"] ?? "",
            myCall: record["STATION_CALLSIGN"] ?? "",
            myGrid: record["MY_GRIDSQUARE"] ?? "",
            propagationMode: record["PROP_MODE"] ?? "",
            antennaPath: record["ANT_PATH"] ?? "",
            email: record["EMAIL"] ?? "",
            qslSent: record["QSL_SENT"] ?? "",
            qslReceived: record["QSL_RCVD"] ?? "",
            qslMethod: record["QSL_SENT_VIA"] ?? "",
            qslVia: record["QSL_VIA"] ?? "",
            qslMessage: record["QSLMSG"] ?? "",
            lotwSent: record["LOTW_QSL_SENT"] ?? "",
            lotwReceived: record["LOTW_QSL_RCVD"] ?? "",
            extraFields: record.fields,
            isDirty: false
        )
        adifFieldMetadata = record.fieldMetadata
    }

    /// Older local rows retained these standard fields only in `extraFields`.
    /// Project them into the modeled editor fields without rewriting the row;
    /// an explicit contact update performs the durable normalization.
    func backfillingADIFFields() -> QSO {
        var value = self
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        if value.end == nil,
           let day = extraFields["QSO_DATE_OFF"] ?? extraFields["TIME_OFF"].map({ _ in
               formatter.dateFormat = "yyyyMMdd"
               return formatter.string(from: start)
           }),
           let parsed = adifDate(day: day, time: extraFields["TIME_OFF"] ?? {
               formatter.dateFormat = "HHmmss"
               return formatter.string(from: start)
           }()) {
            value.end = parsed
        }
        let backfillsReceiveFrequency = value.receiveFrequencyHz == nil && extraFields["FREQ_RX"] != nil
        if value.receiveFrequencyHz == nil, let text = extraFields["FREQ_RX"], let parsed = adifFrequency(text) {
            value.receiveFrequencyHz = parsed
        }
        if value.receiveBand.isEmpty {
            value.receiveBand = extraFields["BAND_RX"] ?? (backfillsReceiveFrequency ? value.receiveFrequencyHz.map(BandPlan.band(for:)) : nil) ?? ""
        }
        if value.antennaPath.isEmpty { value.antennaPath = extraFields["ANT_PATH"] ?? "" }
        if value.qslMessage.isEmpty { value.qslMessage = extraFields["QSLMSG"] ?? "" }
        return value
    }

    var adifRecord: ADIFRecord {
        let bridged = backfillingADIFFields()
        var fields = extraFields
        let dateFormatter = DateFormatter()
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.timeZone = TimeZone(secondsFromGMT: 0)
        dateFormatter.dateFormat = "yyyyMMdd"
        let timeFormatter = DateFormatter()
        timeFormatter.locale = Locale(identifier: "en_US_POSIX")
        timeFormatter.timeZone = TimeZone(secondsFromGMT: 0)
        timeFormatter.dateFormat = "HHmmss"
        func set(_ key: String, _ value: String?) {
            guard let value, !value.isEmpty else { fields.removeValue(forKey: key); return }
            fields[key] = value
        }
        set("CALL", call); set("QSO_DATE", dateFormatter.string(from: start)); set("TIME_ON", timeFormatter.string(from: start))
        if let end = bridged.end {
            set("QSO_DATE_OFF", dateFormatter.string(from: end)); set("TIME_OFF", timeFormatter.string(from: end))
        }
        set("BAND", band); set("MODE", mode); set("SUBMODE", submode)
        if let frequencyHz { set("FREQ", String(format: "%.6f", Double(frequencyHz) / 1_000_000)) }
        if let receiveFrequencyHz = bridged.receiveFrequencyHz { set("FREQ_RX", String(format: "%.6f", Double(receiveFrequencyHz) / 1_000_000)) }
        set("BAND_RX", bridged.receiveBand)
        set("RST_SENT", rstSent); set("RST_RCVD", rstReceived); set("NAME", name)
        set("GRIDSQUARE", gridSquare); set("COUNTRY", country); set("DXCC", dxcc.map(String.init))
        set("CONT", continent); set("CQZ", cqZone); set("ITUZ", ituZone); set("STATE", state)
        set("CNTY", county); set("QTH", qth); set("IOTA", iota); set("SOTA_REF", sotaReference)
        set("POTA_REF", potaReference); set("WWFF_REF", wwffReference); set("SIG", sig)
        set("SIG_INFO", sigInfo); set("DARC_DOK", dok); set("COMMENT", comment); set("NOTES", notes)
        set("TX_PWR", txPower); set("OPERATOR", operatorCall); set("STATION_CALLSIGN", myCall)
        set("MY_GRIDSQUARE", myGrid); set("PROP_MODE", propagationMode); set("ANT_PATH", bridged.antennaPath); set("EMAIL", email)
        set("QSL_SENT", qslSent); set("QSL_RCVD", qslReceived); set("QSL_SENT_VIA", qslMethod)
        set("QSL_VIA", qslVia); set("QSLMSG", bridged.qslMessage); set("LOTW_QSL_SENT", lotwSent); set("LOTW_QSL_RCVD", lotwReceived)
        return ADIFRecord(fields: fields, fieldMetadata: adifFieldMetadata)
    }
}
