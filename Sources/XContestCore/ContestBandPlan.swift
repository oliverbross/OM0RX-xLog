import Foundation

public struct ContestBandDefinition: Codable, Hashable, Sendable {
    public let id: String
    public let lowerFrequencyHz: Int64
    public let upperFrequencyHzExclusive: Int64

    public init(id: String, lowerFrequencyHz: Int64, upperFrequencyHzExclusive: Int64) {
        self.id = id
        self.lowerFrequencyHz = lowerFrequencyHz
        self.upperFrequencyHzExclusive = upperFrequencyHzExclusive
    }

    public func contains(_ frequencyHz: Int64) -> Bool {
        lowerFrequencyHz <= frequencyHz && frequencyHz < upperFrequencyHzExclusive
    }
}

public enum ContestBandPlan {
    public static let bands: [ContestBandDefinition] = [
        .init(id: "160m", lowerFrequencyHz: 1_800_000, upperFrequencyHzExclusive: 2_000_000),
        .init(id: "80m", lowerFrequencyHz: 3_500_000, upperFrequencyHzExclusive: 4_000_000),
        .init(id: "40m", lowerFrequencyHz: 7_000_000, upperFrequencyHzExclusive: 7_300_000),
        .init(id: "20m", lowerFrequencyHz: 14_000_000, upperFrequencyHzExclusive: 14_350_000),
        .init(id: "15m", lowerFrequencyHz: 21_000_000, upperFrequencyHzExclusive: 21_450_000),
        .init(id: "10m", lowerFrequencyHz: 28_000_000, upperFrequencyHzExclusive: 29_700_000),
        .init(id: "6m", lowerFrequencyHz: 50_000_000, upperFrequencyHzExclusive: 54_000_000),
        .init(id: "2m", lowerFrequencyHz: 144_000_000, upperFrequencyHzExclusive: 148_000_000),
        .init(id: "1.25m", lowerFrequencyHz: 222_000_000, upperFrequencyHzExclusive: 225_000_000),
        .init(id: "70cm", lowerFrequencyHz: 420_000_000, upperFrequencyHzExclusive: 450_000_000),
        .init(id: "33cm", lowerFrequencyHz: 902_000_000, upperFrequencyHzExclusive: 928_000_000),
        .init(id: "23cm", lowerFrequencyHz: 1_240_000_000, upperFrequencyHzExclusive: 1_300_000_000),
        .init(id: "13cm", lowerFrequencyHz: 2_300_000_000, upperFrequencyHzExclusive: 2_450_000_000),
        .init(id: "9cm", lowerFrequencyHz: 3_300_000_000, upperFrequencyHzExclusive: 3_500_000_000),
        .init(id: "6cm", lowerFrequencyHz: 5_650_000_000, upperFrequencyHzExclusive: 5_925_000_000),
        .init(id: "3cm", lowerFrequencyHz: 10_000_000_000, upperFrequencyHzExclusive: 10_500_000_000),
        .init(id: "1.25cm", lowerFrequencyHz: 24_000_000_000, upperFrequencyHzExclusive: 24_250_000_000),
        .init(id: "6mm", lowerFrequencyHz: 47_000_000_000, upperFrequencyHzExclusive: 47_200_000_000),
        .init(id: "4mm", lowerFrequencyHz: 75_500_000_000, upperFrequencyHzExclusive: 81_000_000_000),
        .init(id: "2.5mm", lowerFrequencyHz: 119_980_000_000, upperFrequencyHzExclusive: 123_000_000_000),
        .init(id: "2mm", lowerFrequencyHz: 134_000_000_000, upperFrequencyHzExclusive: 149_000_000_000),
        .init(id: "1mm", lowerFrequencyHz: 241_000_000_000, upperFrequencyHzExclusive: 250_000_000_000),
        .init(id: "submm", lowerFrequencyHz: 300_000_000_000,
              upperFrequencyHzExclusive: 7_500_000_000_000),
    ]

    public static func band(for frequencyHz: Int64) -> String? {
        bands.first { $0.contains(frequencyHz) }?.id
    }
}
