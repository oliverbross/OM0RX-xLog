import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport
#if os(macOS)
import XLogCore
#else
import XLogPortableCore
#endif

final class CQWWCountryReferenceMaterializerTests: XCTestCase {
    private let version = "bundled-cty-fnv64-cf9c48a44d4b5e66"

    func testCompleteMaterializationCoversEveryReachableEndpointAndPinsExceptions() throws {
        let resolver = try CTYResolver.bundled()
        let reference = try CQWWCountryReferenceMaterializer.materialize(
            resolver: resolver, referenceDataVersion: version)
        let endpoints = Set(resolver.reachableCountryEndpoints(
            at: CQWWCountryReferenceMaterializer.referenceDate
        ).map(endpoint))
        XCTAssertEqual(Set(reference.records.map(\.endpoint)), endpoints)
        XCTAssertEqual(reference.records.count, endpoints.count)

        for endpoint in endpoints {
            _ = try reference.multiplier(for: entity(endpoint), referenceDataVersion: version)
        }
        let exceptions = Dictionary(uniqueKeysWithValues: reference.records.filter {
            $0.authority != .dxcc
        }.map { ($0.endpoint.entityName, ($0.multiplierKey, $0.authority)) })
        XCTAssertEqual(exceptions.count, 6)
        XCTAssertEqual(exceptions["VIENNA INTL CTR"]?.0, "WAE-4U1V")
        XCTAssertEqual(exceptions["SHETLAND ISLANDS"]?.0, "WAE-GM-SHETLAND")
        XCTAssertEqual(exceptions["BEAR ISLAND"]?.0, "WAE-JW-BEAR")
        XCTAssertEqual(exceptions["EUROPEAN TURKEY"]?.0, "WAE-TA1")
        XCTAssertEqual(exceptions["SICILY"]?.0, "WAE-IT9")
        XCTAssertEqual(exceptions["AFRICAN ITALY"]?.0, "CQWW-IG9-IH9")
        XCTAssertEqual(exceptions["AFRICAN ITALY"]?.1, .cqwwSupplement)
    }

    func testPinnedResolverAppliesReachableTokenZoneAndContinentOverrides() throws {
        let resolver = try CTYResolver.bundled()
        XCTAssertEqual(try XCTUnwrap(resolver.resolve("B0AAA")).cqZone, 24, "legacy B0")
        XCTAssertEqual(try XCTUnwrap(resolver.resolveCountryEndpoint("B0AAA")).cqZone, 23, "endpoint B0")
        XCTAssertEqual(try XCTUnwrap(resolver.resolveCountryEndpoint("B9ZAA")).cqZone, 23, "endpoint B9")
        XCTAssertEqual(try XCTUnwrap(resolver.resolveCountryEndpoint("R8HAA")).cqZone, 18, "endpoint R8H")
        XCTAssertEqual(try XCTUnwrap(resolver.resolveCountryEndpoint("4U1VIC")).continent, "EU")

        let endpoints = resolver.reachableCountryEndpoints(
            at: CQWWCountryReferenceMaterializer.referenceDate)
        XCTAssertTrue(endpoints.contains { $0.adif == 318 && $0.name == "CHINA" && $0.cqZone == 23 })
        XCTAssertTrue(endpoints.contains { $0.adif == 318 && $0.name == "CHINA" && $0.cqZone == 24 })
        XCTAssertTrue(endpoints.contains { $0.adif == 15 && $0.name == "ASIATIC RUSSIA" && $0.cqZone == 18 })
    }

    func testUnknownEndpointRejectsAndCanonicalResourceIsGeneratedFromResolver() throws {
        let reference = try CQWWCountryReferenceMaterializer.materialize(
            resolver: CTYResolver.bundled(), referenceDataVersion: version)
        XCTAssertThrowsError(try reference.multiplier(
            for: entity(.init(adif: 999_999, entityName: "UNKNOWN", continent: "EU", cqZone: 14)),
            referenceDataVersion: version
        ))

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(reference)
        data.append(0x0A)
        if let output = ProcessInfo.processInfo.environment["XLOG_CQWW_COUNTRY_REFERENCE_OUTPUT"] {
            try data.write(to: URL(fileURLWithPath: output), options: .atomic)
        } else {
            XCTAssertEqual(try ContestPackagedCountryReferenceLoader.cqww2026(), reference)
        }
    }

    private func endpoint(_ country: CountryInfo) -> ContestCountryMultiplierEndpoint {
        .init(adif: country.adif, entityName: country.name,
              continent: country.continent, cqZone: country.cqZone)
    }

    private func entity(_ endpoint: ContestCountryMultiplierEndpoint) -> ContestEntitySnapshot {
        .init(adif: endpoint.adif, name: endpoint.entityName, countryPrefix: "FIXTURE",
              continent: endpoint.continent, cqZone: endpoint.cqZone)
    }
}
