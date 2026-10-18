import Foundation
import XContestCore
#if os(macOS)
import XLogCore
#else
import XLogPortableCore
#endif

public enum CQWWCountryReferenceMaterializationError: Error, Equatable {
    case emptyResolver
    case missingAuthorityEndpoint(ContestCountryMultiplierEndpoint)
    case unexpectedAuthorityEndpoint(ContestCountryMultiplierEndpoint)
    case ambiguousDXCCEntity(adif: Int, names: [String])
    case incompleteCoverage(expected: Int, actual: Int)
}

/// Deterministically projects every reachable endpoint from one pinned CTY snapshot into the
/// CQ WW country authority. It consumes resolver output; it never performs a second callsign lookup.
public enum CQWWCountryReferenceMaterializer {
    public static let referenceDate = Date(timeIntervalSince1970: 1_792_281_600) // 2026-10-18T00:00:00Z
    public static let identity = ContestCountryMultiplierReferenceIdentity(
        id: "cqww-country", version: "2026.1-complete")

    private struct Exception: Sendable {
        let endpoint: ContestCountryMultiplierEndpoint
        let key: String
        let label: String
        let authority: ContestCountryMultiplierAuthority
    }

    // Primary authorities:
    // - https://www.cqww.com/rules/ (DXCC + WAE + IG9/IH9)
    // - https://www.darc.de/fileadmin/filemounts/referate/dx/diplome/Award_Rules_DARC_DX_ENG_032023.pdf
    private static let exceptions: [Exception] = [
        .init(endpoint: .init(adif: 206, entityName: "VIENNA INTL CTR", continent: "EU", cqZone: 15),
              key: "WAE-4U1V", label: "Vienna International Centre", authority: .wae),
        .init(endpoint: .init(adif: 279, entityName: "SHETLAND ISLANDS", continent: "EU", cqZone: 14),
              key: "WAE-GM-SHETLAND", label: "Shetland Islands", authority: .wae),
        .init(endpoint: .init(adif: 259, entityName: "BEAR ISLAND", continent: "EU", cqZone: 40),
              key: "WAE-JW-BEAR", label: "Bear Island", authority: .wae),
        .init(endpoint: .init(adif: 390, entityName: "EUROPEAN TURKEY", continent: "EU", cqZone: 20),
              key: "WAE-TA1", label: "European Turkey", authority: .wae),
        .init(endpoint: .init(adif: 248, entityName: "SICILY", continent: "EU", cqZone: 15),
              key: "WAE-IT9", label: "Sicily", authority: .wae),
        .init(endpoint: .init(adif: 248, entityName: "AFRICAN ITALY", continent: "AF", cqZone: 33),
              key: "CQWW-IG9-IH9", label: "African Italy (IG9/IH9)", authority: .cqwwSupplement),
    ]

    public static func materialize(
        resolver: CTYResolver,
        referenceDataVersion: String,
        at date: Date = referenceDate
    ) throws -> ContestCountryMultiplierReference {
        let endpoints = resolver.reachableCountryEndpoints(at: date).map {
            ContestCountryMultiplierEndpoint(adif: $0.adif, entityName: $0.name,
                                             continent: $0.continent, cqZone: $0.cqZone)
        }
        guard !endpoints.isEmpty else { throw CQWWCountryReferenceMaterializationError.emptyResolver }
        let uniqueEndpoints = Set(endpoints)
        let exceptionByEndpoint = Dictionary(uniqueKeysWithValues: exceptions.map { ($0.endpoint, $0) })
        for expected in exceptions where !uniqueEndpoints.contains(expected.endpoint) {
            throw CQWWCountryReferenceMaterializationError.missingAuthorityEndpoint(expected.endpoint)
        }

        let specialNamesByADIF = Dictionary(grouping: exceptions, by: { $0.endpoint.adif })
            .mapValues { Set($0.map { $0.endpoint.entityName }) }
        var ordinaryNamesByADIF: [Int: Set<String>] = [:]
        for endpoint in uniqueEndpoints where exceptionByEndpoint[endpoint] == nil {
            if specialNamesByADIF[endpoint.adif]?.contains(endpoint.entityName) == true {
                throw CQWWCountryReferenceMaterializationError.unexpectedAuthorityEndpoint(endpoint)
            }
            ordinaryNamesByADIF[endpoint.adif, default: []].insert(endpoint.entityName)
        }
        for (adif, names) in ordinaryNamesByADIF where names.count != 1 {
            throw CQWWCountryReferenceMaterializationError.ambiguousDXCCEntity(
                adif: adif, names: names.sorted())
        }

        let records = try uniqueEndpoints.sorted().map { endpoint -> ContestCountryMultiplierRecord in
            if let special = exceptionByEndpoint[endpoint] {
                return .init(endpoint: endpoint, multiplierKey: special.key,
                             displayLabel: special.label, authority: special.authority)
            }
            guard let name = ordinaryNamesByADIF[endpoint.adif]?.first else {
                throw CQWWCountryReferenceMaterializationError.unexpectedAuthorityEndpoint(endpoint)
            }
            return .init(endpoint: endpoint, multiplierKey: "DXCC-\(endpoint.adif)",
                         displayLabel: name, authority: .dxcc)
        }
        guard records.count == uniqueEndpoints.count else {
            throw CQWWCountryReferenceMaterializationError.incompleteCoverage(
                expected: uniqueEndpoints.count, actual: records.count)
        }
        return try ContestCountryMultiplierReference(
            identity: identity, requiredReferenceDataVersion: referenceDataVersion, records: records)
    }
}
