import Foundation

public extension QSO {
    init?(adif record: ADIFRecord, wavelogID: Int? = nil) {
        guard let call = record["CALL"], !call.isEmpty,
              let dateText = record["QSO_DATE"], dateText.count == 8,
              let timeText = record["TIME_ON"], !timeText.isEmpty else { return nil }
        let paddedTime = timeText.padding(toLength: 6, withPad: "0", startingAt: 0)
        let stamp = dateText + paddedTime
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyyMMddHHmmss"
        guard let start = formatter.date(from: stamp) else { return nil }
        let frequencyHz = record["FREQ"].flatMap(Double.init).map { Int64(($0 * 1_000_000).rounded()) }
        self.init(
            wavelogID: wavelogID,
            call: call,
            start: start,
            band: record["BAND"] ?? frequencyHz.map(BandPlan.band(for:)) ?? "",
            mode: record["MODE"] ?? "SSB",
            submode: record["SUBMODE"] ?? "",
            frequencyHz: frequencyHz,
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
            email: record["EMAIL"] ?? "",
            qslSent: record["QSL_SENT"] ?? "",
            qslReceived: record["QSL_RCVD"] ?? "",
            qslMethod: record["QSL_SENT_VIA"] ?? "",
            qslVia: record["QSL_VIA"] ?? "",
            lotwSent: record["LOTW_QSL_SENT"] ?? "",
            lotwReceived: record["LOTW_QSL_RCVD"] ?? "",
            extraFields: record.fields,
            isDirty: false
        )
    }

    var adifRecord: ADIFRecord {
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
        set("BAND", band); set("MODE", mode); set("SUBMODE", submode)
        if let frequencyHz { set("FREQ", String(format: "%.6f", Double(frequencyHz) / 1_000_000)) }
        set("RST_SENT", rstSent); set("RST_RCVD", rstReceived); set("NAME", name)
        set("GRIDSQUARE", gridSquare); set("COUNTRY", country); set("DXCC", dxcc.map(String.init))
        set("CONT", continent); set("CQZ", cqZone); set("ITUZ", ituZone); set("STATE", state)
        set("CNTY", county); set("QTH", qth); set("IOTA", iota); set("SOTA_REF", sotaReference)
        set("POTA_REF", potaReference); set("WWFF_REF", wwffReference); set("SIG", sig)
        set("SIG_INFO", sigInfo); set("DARC_DOK", dok); set("COMMENT", comment); set("NOTES", notes)
        set("TX_PWR", txPower); set("OPERATOR", operatorCall); set("STATION_CALLSIGN", myCall)
        set("MY_GRIDSQUARE", myGrid); set("PROP_MODE", propagationMode); set("EMAIL", email)
        set("QSL_SENT", qslSent); set("QSL_RCVD", qslReceived); set("QSL_SENT_VIA", qslMethod)
        set("QSL_VIA", qslVia); set("LOTW_QSL_SENT", lotwSent); set("LOTW_QSL_RCVD", lotwReceived)
        return ADIFRecord(fields: fields)
    }
}
