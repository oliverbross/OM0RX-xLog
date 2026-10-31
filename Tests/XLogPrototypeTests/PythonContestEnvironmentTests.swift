import Foundation
import XCTest
#if os(Windows)
import WinSDK
#endif
@testable import XLogPrototypeSupport

final class PythonContestEnvironmentTests: XCTestCase {
    func testBaseEnvironmentContainsOnlyRequiredPlatformValues() throws {
        var expected = ["LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
                        "PYTHONNOUSERSITE": "1", "PYTHONDONTWRITEBYTECODE": "1"]
        #if os(Windows)
        // Compare with an independent OS query, never the inherited environment.
        var buffer = [WCHAR](repeating: 0, count: 32_768)
        let count = Int(buffer.withUnsafeMutableBufferPointer { GetWindowsDirectoryW($0.baseAddress, UINT($0.count)) })
        XCTAssertGreaterThan(count, 0)
        XCTAssertLessThan(count, buffer.count)
        guard count > 0, count < buffer.count else { return }
        let root = String(decoding: buffer.prefix(Int(count)), as: UTF16.self)
        var directory: ObjCBool = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: root, isDirectory: &directory))
        XCTAssertTrue(directory.boolValue)
        expected["SystemRoot"] = root
        #endif
        XCTAssertEqual(PythonContestLane.childEnvironment(n1mmUDPAllowed: false), expected)
    }

    func testOptionalCapabilitiesLeaveTheSanitizedBaseUnchanged() {
        let base = PythonContestLane.childEnvironment(n1mmUDPAllowed: false)
        let certificate = URL(fileURLWithPath: "/synthetic/ca.pem")
        var bound = PythonContestLane.childEnvironment(n1mmUDPAllowed: true, sslCertificateFileURL: certificate)
        XCTAssertEqual(bound.removeValue(forKey: "SSL_CERT_FILE"), certificate.path)
        XCTAssertEqual(bound.removeValue(forKey: "XLOG_CONTEST_N1MM_UDP_ALLOWED"), "1")
        XCTAssertEqual(bound, base)
        for key in ["PATH", "PYTHONHOME", "PYTHONPATH", "HOME", "USERPROFILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE"] {
            XCTAssertNil(bound[key], key)
        }
    }
}
