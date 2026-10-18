import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
import XLogCore
#elseif canImport(XLogPortableCore)
import XLogPortableCore
#endif

final class ContestARRLVHFADIFExportTests: XCTestCase {
    func testFT4UsesADIFMFSKModeAndFT4Submode() throws {
        let rule = try ARRLVHFDeclarativeDefinitions.rule(for: .january, category: .fixed)
        let sessionID = UUID(uuidString: "EB400000-0000-0000-8000-000000000001")!
        let generation = UUID(uuidString: "EB500000-0000-0000-8000-000000000001")!
        let timestamp = Date(timeIntervalSince1970: 1_900_000_000)
        let stationEntity = ContestEntitySnapshot(adif: 503, name: "SLOVAK REPUBLIC",
                                                  countryPrefix: "OM", continent: "EU", cqZone: 15)
        let workedEntity = ContestEntitySnapshot(adif: 291, name: "UNITED STATES",
                                                 countryPrefix: "K", continent: "NA", cqZone: 5)
        let session = ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
            referenceDataVersion: "fixture-cty-1", startedAt: timestamp,
            station: .init(callsign: "OM0RX", entity: stationEntity, sentExchange: "JN98",
                           operatorCallsigns: ["OM0RX"], location: "JN98",
                           sentExchangeFields: ["grid": .init(raw: "JN98", normalized: "JN98")]))
        let qso = ContestQSO(
            id: UUID(uuidString: "EB600000-0000-0000-8000-000000000001")!, sessionID: sessionID,
            timestampUTC: timestamp, callsign: "K1ABC", band: "6m", mode: "FT4",
            frequencyHz: 50_313_000, rstSent: "", rstReceived: "",
            exchange: .init(rawSent: "JN98", normalizedSent: "JN98",
                            rawReceived: "FN31", normalizedReceived: "FN31",
                            sentFields: ["grid": .init(raw: "JN98", normalized: "JN98")],
                            receivedFields: ["grid": .init(raw: "FN31", normalized: "FN31")]),
            entity: workedEntity, operatorCallsign: "OM0RX", stationLocation: "JN98",
            provenance: .init(source: .operatorEntry, sourceIdentity: "operator-ui"))
        let header = CabrilloHeader(
            callsign: "OM0RX", categoryOperator: "SINGLE-OP", categoryAssisted: "NON-ASSISTED",
            categoryBand: "ALL", categoryMode: "AM", categoryTransmitter: "ONE",
            categoryPower: "LOW", operators: ["OM0RX"], location: "DX")
        let input = ContestExportInput(
            formatterVersion: "arrl-vhf-source-preview-1",
            generatedAtUTC: timestamp.addingTimeInterval(60), sessionRevision: 1, session: session,
            ruleIdentity: rule.metadata.identity, referenceDataVersion: "fixture-cty-1",
            metadata: .init(sessionName: "ARRL VHF FT4 preview", operatorCallsign: "OM0RX",
                            operatorCategory: "SINGLE-OP", cabrilloHeader: header), qsos: [qso])

        let score = try ContestEngine.score([qso], session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted], "\(score.qsos.first?.issues ?? [])")
        _ = try input.validatedScore(rule: rule)
        let record = try XCTUnwrap(ContestADIFExport.records(input: input, rule: rule).first)
        XCTAssertEqual(record["MODE"], "MFSK")
        XCTAssertEqual(record["SUBMODE"], "FT4")
    }
}
