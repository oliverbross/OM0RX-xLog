import Foundation

public struct QSO: Codable, Identifiable, Hashable, Sendable {
    public var id: UUID
    public var wavelogID: Int?
    public var call: String
    public var start: Date
    public var end: Date?
    public var band: String
    public var mode: String
    public var submode: String
    public var frequencyHz: Int64?
    public var receiveFrequencyHz: Int64?
    public var receiveBand: String
    public var rstSent: String
    public var rstReceived: String
    public var name: String
    public var gridSquare: String
    public var country: String
    public var dxcc: Int?
    public var continent: String
    public var cqZone: String
    public var ituZone: String
    public var state: String
    public var county: String
    public var qth: String
    public var iota: String
    public var sotaReference: String
    public var potaReference: String
    public var wwffReference: String
    public var sig: String
    public var sigInfo: String
    public var dok: String
    public var comment: String
    public var notes: String
    public var stationProfileID: Int?
    public var stationLocation: String
    public var radio: String
    public var txPower: String
    public var operatorCall: String
    public var myCall: String
    public var myGrid: String
    public var propagationMode: String
    public var antennaPath: String
    public var email: String
    public var qslSent: String
    public var qslReceived: String
    public var qslMethod: String
    public var qslVia: String
    public var qslMessage: String
    public var lotwSent: String
    public var lotwReceived: String
    public var extraFields: [String: String]
    public var isDirty: Bool
    public var deletedAt: Date?
    public var updatedAt: Date

    public init(
        id: UUID = UUID(),
        wavelogID: Int? = nil,
        call: String,
        start: Date = Date(),
        end: Date? = nil,
        band: String,
        mode: String,
        submode: String = "",
        frequencyHz: Int64? = nil,
        receiveFrequencyHz: Int64? = nil,
        receiveBand: String = "",
        rstSent: String = "59",
        rstReceived: String = "59",
        name: String = "",
        gridSquare: String = "",
        country: String = "",
        dxcc: Int? = nil,
        continent: String = "",
        cqZone: String = "",
        ituZone: String = "",
        state: String = "",
        county: String = "",
        qth: String = "",
        iota: String = "",
        sotaReference: String = "",
        potaReference: String = "",
        wwffReference: String = "",
        sig: String = "",
        sigInfo: String = "",
        dok: String = "",
        comment: String = "",
        notes: String = "",
        stationProfileID: Int? = nil,
        stationLocation: String = "",
        radio: String = "",
        txPower: String = "",
        operatorCall: String = "",
        myCall: String = "",
        myGrid: String = "",
        propagationMode: String = "",
        antennaPath: String = "",
        email: String = "",
        qslSent: String = "",
        qslReceived: String = "",
        qslMethod: String = "",
        qslVia: String = "",
        qslMessage: String = "",
        lotwSent: String = "",
        lotwReceived: String = "",
        extraFields: [String: String] = [:],
        isDirty: Bool = true,
        deletedAt: Date? = nil,
        updatedAt: Date = Date()
    ) {
        self.id = id; self.wavelogID = wavelogID; self.call = call.uppercased()
        self.start = start; self.end = end; self.band = band.lowercased(); self.mode = mode.uppercased()
        self.submode = submode.uppercased(); self.frequencyHz = frequencyHz
        self.receiveFrequencyHz = receiveFrequencyHz; self.receiveBand = receiveBand.lowercased()
        self.rstSent = rstSent; self.rstReceived = rstReceived; self.name = name
        self.gridSquare = gridSquare.uppercased(); self.country = country; self.dxcc = dxcc
        self.continent = continent; self.cqZone = cqZone; self.ituZone = ituZone
        self.state = state; self.county = county; self.qth = qth; self.iota = iota
        self.sotaReference = sotaReference; self.potaReference = potaReference
        self.wwffReference = wwffReference; self.sig = sig; self.sigInfo = sigInfo; self.dok = dok
        self.comment = comment; self.notes = notes; self.stationProfileID = stationProfileID
        self.stationLocation = stationLocation; self.radio = radio; self.txPower = txPower
        self.operatorCall = operatorCall; self.myCall = myCall; self.myGrid = myGrid
        self.propagationMode = propagationMode; self.antennaPath = antennaPath; self.email = email
        self.qslSent = qslSent; self.qslReceived = qslReceived; self.qslMethod = qslMethod
        self.qslVia = qslVia; self.qslMessage = qslMessage; self.lotwSent = lotwSent
        self.lotwReceived = lotwReceived; self.extraFields = extraFields; self.isDirty = isDirty
        self.deletedAt = deletedAt; self.updatedAt = updatedAt
    }

    public var displayFrequency: String {
        guard let frequencyHz else { return "—" }
        return String(format: "%.6f", Double(frequencyHz) / 1_000_000)
    }

    public var isConfirmed: Bool {
        [qslReceived, lotwReceived].contains { value in
            let normalized = value.uppercased()
            return normalized == "Y" || normalized == "V"
        }
    }
}

public struct LogbookStats: Equatable, Sendable {
    public var qsoCount = 0
    public var dxccCount = 0
    public var confirmedCount = 0
    public var thisYearCount = 0
    public static let empty = LogbookStats()
}

public struct BandModeCell: Hashable, Sendable {
    public let band: String
    public let mode: String
    public let worked: Bool
    public let confirmed: Bool
}

public struct DXCCSummary: Equatable, Sendable {
    public var qsoCount: Int
    public var confirmedCount: Int
    public var matrix: Set<BandModeCell>
    public var latest: QSO?

    public init(qsoCount: Int = 0, confirmedCount: Int = 0, matrix: Set<BandModeCell> = [], latest: QSO? = nil) {
        self.qsoCount = qsoCount
        self.confirmedCount = confirmedCount
        self.matrix = matrix
        self.latest = latest
    }

    public static let empty = DXCCSummary()
}

public struct SyncConflict: Codable, Identifiable, Hashable, Sendable {
    public let id: UUID
    public let localQSO: QSO
    public let remoteQSO: QSO
    public let detectedAt: Date

    public init(id: UUID = UUID(), localQSO: QSO, remoteQSO: QSO, detectedAt: Date = Date()) {
        self.id = id
        self.localQSO = localQSO
        self.remoteQSO = remoteQSO
        self.detectedAt = detectedAt
    }
}

public struct CountryInfo: Codable, Equatable, Hashable, Sendable {
    public let name: String
    public let adif: Int
    public let continent: String
    public let cqZone: Int
    public let ituZone: Int
    public let latitude: Double?
    public let longitude: Double?

    public init(name: String, adif: Int, continent: String, cqZone: Int, ituZone: Int, latitude: Double? = nil, longitude: Double? = nil) {
        self.name = name
        self.adif = adif
        self.continent = continent
        self.cqZone = cqZone
        self.ituZone = ituZone
        self.latitude = latitude
        self.longitude = longitude
    }
}

public enum BandPlan {
    public static let bands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"]
    public static let modes = ["CW", "SSB", "FT8", "FT4", "FT2", "RTTY", "PSK", "DIGI", "AM", "FM"]

    public static func band(for frequencyHz: Int64) -> String {
        switch frequencyHz {
        case 1_800_000..<2_000_000: return "160m"
        case 3_500_000..<4_000_000: return "80m"
        case 5_250_000..<5_500_000: return "60m"
        case 7_000_000..<7_300_000: return "40m"
        case 10_100_000..<10_150_000: return "30m"
        case 14_000_000..<14_350_000: return "20m"
        case 18_068_000..<18_168_000: return "17m"
        case 21_000_000..<21_450_000: return "15m"
        case 24_890_000..<24_990_000: return "12m"
        case 28_000_000..<29_700_000: return "10m"
        case 50_000_000..<54_000_000: return "6m"
        case 144_000_000..<148_000_000: return "2m"
        case 420_000_000..<450_000_000: return "70cm"
        default: return ""
        }
    }

    public static func frequencyHz(from text: String) -> Int64? {
        let clean = text.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
        guard let value = Double(clean), value > 0 else { return nil }
        if value < 1_000 { return Int64((value * 1_000_000).rounded()) }
        if value < 1_000_000 { return Int64((value * 1_000).rounded()) }
        return Int64(value.rounded())
    }
}
