import XCTest
@testable import XClusterIntegrationCore

final class ClusterCountryDirectoryTests: XCTestCase {
    func testPJ4YUsesBonairePrefixRuleInsteadOfBangladeshFallback() throws {
        let directory = ClusterCountryDirectory(csv: """
        S2,Bangladesh,305,AS,22,41,24.12,-89.65,-6.0,S2 S3;
        PJ4,Bonaire,520,SA,9,11,12.20,68.25,4.0,PJ4;
        """)

        let bonaire = try XCTUnwrap(directory.resolve("PJ4Y"))
        XCTAssertEqual(bonaire.adif, 520)
        XCTAssertEqual(bonaire.name, "BONAIRE")

        let bangladesh = try XCTUnwrap(directory.resolve("S21ABC"))
        XCTAssertEqual(bangladesh.adif, 305)
        XCTAssertEqual(bangladesh.name, "BANGLADESH")
    }
}
