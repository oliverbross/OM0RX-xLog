import Foundation
import XCTest
@testable import XLogPrototypeSupport

final class NativeCredentialStoreTests: XCTestCase {
    func testInvalidIdentitiesAndOversizedValuesFailBeforeVaultAccess() throws {
        for invalid in ["", "a\0b", "a\nb", String(repeating: "a", count: 129)] {
            let store = NativeCredentialStore(service: "fixture")
            XCTAssertThrowsError(try store.load(invalid)) { error in
                XCTAssertEqual((error as? WorkerFailure)?.code, "credential_identity_invalid")
            }
            XCTAssertThrowsError(try NativeCredentialStore(service: invalid).save("value", account: "account"))
        }
        XCTAssertThrowsError(try NativeCredentialStore(service: "fixture").save(
            String(repeating: "é", count: NativeCredentialStore.maximumBytes), account: "account")) { error in
            XCTAssertEqual((error as? WorkerFailure)?.code, "credential_too_large")
        }
    }

    func testUnsupportedNativeBackendDoesNotPretendASecretIsMissingOrRemoved() throws {
        #if !os(Windows) && !os(Linux)
        XCTAssertFalse(NativeCredentialStore.supported)
        let store = NativeCredentialStore(service: "fixture")
        for operation in [ { _ = try store.load("account") },
                           { try store.save("fixture-value", account: "account") },
                           { try store.remove("account") } ] {
            XCTAssertThrowsError(try operation()) { error in
                XCTAssertEqual((error as? WorkerFailure)?.code, "credential_unavailable")
            }
        }
        #endif
    }

    func testNativeRoundTripExactIdentityIsolationAndDeletion() throws {
        #if os(Windows) || os(Linux)
        try XCTSkipUnless(ProcessInfo.processInfo.environment["XLOG_TEST_NATIVE_VAULT"] == "1",
                          "Native vault writes require the dedicated disposable CI fixture opt-in.")
        #if os(Linux)
        let environment = ProcessInfo.processInfo.environment
        let fixtureRoot = environment["XLOG_TEST_LINUX_VAULT_ROOT"] ?? ""
        try XCTSkipUnless(!fixtureRoot.isEmpty && environment["XDG_DATA_HOME"] == fixtureRoot + "/data"
                          && environment["DBUS_SESSION_BUS_ADDRESS"] != nil,
                          "Linux vault writes require the isolated D-Bus/keyring test runner.")
        #endif
        XCTAssertTrue(NativeCredentialStore.supported)
        let service = "com.oliverbross.xlog.ci." + UUID().uuidString
        let first = NativeCredentialStore(service: service)
        let second = NativeCredentialStore(service: service + "/other")
        let accounts = ["Account", "account", "a/b", "a", "päss/秘密"]
        // Only exact identities created by this test are removed. Never enumerate
        // the current user's vault or touch the production service namespace.
        defer {
            for account in accounts {
                do { try first.remove(account); try second.remove(account) }
                catch { XCTFail("Fixture credential cleanup failed") }
            }
        }
        for (index, account) in accounts.enumerated() {
            XCTAssertNil(try first.load(account))
            try first.save("fixture-\(index)-é秘密\0end", account: account)
            try second.save("second-\(index)", account: account)
        }
        let reopened = NativeCredentialStore(service: service)
        for (index, account) in accounts.enumerated() {
            XCTAssertEqual(try reopened.load(account), "fixture-\(index)-é秘密\0end")
            XCTAssertEqual(try second.load(account), "second-\(index)")
        }
        try first.save(String(repeating: "x", count: NativeCredentialStore.maximumBytes), account: "Account")
        XCTAssertEqual(try reopened.load("Account")?.utf8.count, NativeCredentialStore.maximumBytes)
        XCTAssertThrowsError(try first.save(String(repeating: "x", count: NativeCredentialStore.maximumBytes + 1), account: "Account"))
        XCTAssertEqual(try reopened.load("Account")?.utf8.count, NativeCredentialStore.maximumBytes)
        try first.save("replacement", account: "Account")
        XCTAssertEqual(try reopened.load("Account"), "replacement")
        try first.save("", account: "Account")
        XCTAssertNil(try first.load("Account"))
        try first.remove("Account") // Missing deletion is idempotent.
        XCTAssertEqual(try first.load("account"), "fixture-1-é秘密\0end")
        #else
        throw XCTSkip("Native vault round trips require a Windows or isolated Linux runner.")
        #endif
    }
}
