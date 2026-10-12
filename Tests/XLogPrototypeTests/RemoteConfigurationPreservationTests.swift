#if os(macOS)
import Foundation
import XCTest
import XCatIntegrationCore

final class RemoteConfigurationPreservationTests: XCTestCase {
    func testFutureFieldsSurviveLoadEditSaveAndReturnedConfiguration() throws {
        var configuration = try fixture()
        configuration["future_feature"] = ["enabled": true, "limits": [1, 2, 3], "nullable": NSNull()] as [String: Any]
        var flex = configuration["flex"] as! [String: Any]
        flex["future_slice_policy"] = "keep"
        configuration["flex"] = flex
        var policy = configuration["policy"] as! [String: Any]
        policy["future_interlock"] = ["enabled": true]
        configuration["policy"] = policy
        let response = try JSONSerialization.data(withJSONObject: ["success": true, "config": configuration])
        let loaded = try RemoteAgentClient.configurationData(fromResponse: response)
        var edited = try JSONSerialization.jsonObject(with: loaded) as! [String: Any]
        edited["commissioned"] = true
        let editedData = try JSONSerialization.data(withJSONObject: edited)
        let request = try RemoteAgentClient.configurationRequestBody(editedData)
        let requestEnvelope = try JSONSerialization.jsonObject(with: request) as! [String: Any]
        let outgoing = requestEnvelope["config"] as! [String: Any]
        XCTAssertTrue(NSDictionary(dictionary: outgoing).isEqual(to: edited))
        let savedResponse = try JSONSerialization.data(withJSONObject: ["success": true, "config": outgoing])
        let returned = try RemoteAgentClient.configurationData(fromResponse: savedResponse)
        let saved = try JSONSerialization.jsonObject(with: returned) as! [String: Any]
        XCTAssertTrue(NSDictionary(dictionary: saved).isEqual(to: edited))
    }

    func testKnownSchemaRemainsValidatedBeforeBuildingSaveRequest() throws {
        var configuration = try fixture()
        configuration["commissioned"] = "true"
        let invalid = try JSONSerialization.data(withJSONObject: configuration)
        XCTAssertThrowsError(try RemoteAgentClient.configurationRequestBody(invalid))
        XCTAssertThrowsError(try RemoteAgentClient.configurationData(fromResponse:
            JSONSerialization.data(withJSONObject: ["success": false, "config": try fixture()])))
    }

    func testOversizedFutureFieldIsRejectedBeforeSave() throws {
        var configuration = try fixture()
        configuration["future_blob"] = String(repeating: "x", count: 32_768)
        let oversized = try JSONSerialization.data(withJSONObject: configuration)
        XCTAssertThrowsError(try RemoteAgentClient.configurationRequestBody(oversized))
    }

    private func fixture() throws -> [String: Any] {
        let data = try JSONEncoder().encode(RemoteStationConfiguration.placeholder)
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }
}
#endif
