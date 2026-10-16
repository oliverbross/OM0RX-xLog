import Foundation
import Testing
@testable import XLogCore

@Suite("LoTW fixed-origin confirmation download contract")
struct LoTWConfirmationDownloadTests {
    private let empty = "<PROGRAMID:4>LoTW<APP_LoTW_NUMREC:1>0<EOH>"
    private func response(url: String = "https://lotw.arrl.org/lotwuser/lotwreport.adi", status: Int = 200,
                          type: String? = "text/plain", redirects: Int = 0, body: Data? = nil) -> LoTWConfirmationDownloadResponse {
        .init(url: URL(string: url)!, statusCode: status, contentType: type,
              redirectCount: redirects, body: body ?? Data(empty.utf8))
    }

    @Test func fixedGETQueryAndEncodedCredentials() throws {
        let plan = try LoTWConfirmationDownload(username: "account.name")
        let secret = "a+b &?=#/é"
        let request = try plan.makeURLRequest(password: secret)
        #expect(request.httpMethod == "GET")
        let url = try #require(request.url)
        #expect(url.scheme == "https")
        #expect(url.host == "lotw.arrl.org")
        #expect(url.path == "/lotwuser/lotwreport.adi")
        let items = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(items == [URLQueryItem(name: "login", value: "account.name"),
                          URLQueryItem(name: "password", value: secret),
                          URLQueryItem(name: "qso_query", value: "1"),
                          URLQueryItem(name: "qso_qsl", value: "yes"),
                          URLQueryItem(name: "qso_withown", value: "yes")])
        #expect(url.absoluteString.contains("%2B"))
        #expect(!String(reflecting: plan).contains(secret))
        #expect(request.httpBody == nil)
    }

    @Test func validatesAccountsSecretsAndWatermarks() throws {
        for name in ["", " user", "user\n", "a&password=x", "https://evil.test", String(repeating: "a", count: 129)] {
            #expect(throws: LoTWConfirmationDownloadError.invalidUsername) { try LoTWConfirmationDownload(username: name) }
        }
        let plan = try LoTWConfirmationDownload(username: "OM0RX/P")
        for secret in ["", " \n\t"] {
            #expect(throws: LoTWConfirmationDownloadError.emptyPassword) { try plan.makeURLRequest(password: secret) }
        }
        for watermark in ["", "2026-02-30", "2026-02-30 00:00:00", "2026-10-16 24:00:00", "2026-10-16 01:02:03Z"] {
            #expect(throws: LoTWConfirmationDownloadError.invalidWatermark) {
                try LoTWConfirmationDownload(username: "OM0RX", qslSince: watermark)
            }
        }
        #expect(try LoTWConfirmationDownload(username: "OM0RX", qslSince: "2026-10-16").qslSince == "2026-10-16")
    }

    @Test func preservesInclusiveContinuationAndEmptyReportCheckpoint() throws {
        let watermark = "2026-10-16 01:02:03"
        let plan = try LoTWConfirmationDownload(username: "OM0RX", qslSince: "2026-10-15 00:00:00")
        let report = try plan.parseResponse(response(body: Data(("<PROGRAMID:4>LoTW<APP_LoTW_NUMREC:1>0"
            + "<APP_LoTW_LASTQSL:19>" + watermark + "<EOH>").utf8)))
        let continuation = try plan.continuing(after: report)
        #expect(continuation.qslSince == watermark)
        let url = try #require(continuation.makeURLRequest(password: "test-fixture").url)
        #expect(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
            .first(where: { $0.name == "qso_qslsince" })?.value == watermark)
        #expect(try continuation.continuing(after: continuation.parseResponse(response())) == continuation)
    }

    @Test func rejectsForeignOriginsAlternatePathsAndAllRedirects() throws {
        let plan = try LoTWConfirmationDownload(username: "OM0RX")
        for url in ["http://lotw.arrl.org/lotwuser/lotwreport.adi", "https://evil.test/lotwuser/lotwreport.adi",
                    "https://lotw.arrl.org.evil.test/lotwuser/lotwreport.adi", "https://lotw.arrl.org:444/lotwuser/lotwreport.adi",
                    "https://lotw.arrl.org/lotwuser/default", "https://lotw.arrl.org/lotwuser/%6cotwreport.adi",
                    "https://user@lotw.arrl.org/lotwuser/lotwreport.adi", "https://lotw.arrl.org/lotwuser/lotwreport.adi#fragment"] {
            #expect(throws: LoTWConfirmationDownloadError.unexpectedEndpoint) { try plan.parseResponse(response(url: url)) }
        }
        for count in [-1, 1, 2] {
            #expect(throws: LoTWConfirmationDownloadError.redirectRejected) { try plan.parseResponse(response(redirects: count)) }
        }
    }

    @Test func validatesStatusHTMLSizeAndEncodingBeforeParsing() throws {
        let plan = try LoTWConfirmationDownload(username: "OM0RX")
        for status in [199, 301, 302, 401, 500] {
            #expect(throws: LoTWConfirmationDownloadError.unsuccessfulStatus) { try plan.parseResponse(response(status: status)) }
        }
        for type in ["text/html", "TEXT/HTML; charset=UTF-8", "application/xhtml+xml"] {
            #expect(throws: LoTWConfirmationDownloadError.htmlResponse) { try plan.parseResponse(response(type: type)) }
        }
        #expect(throws: LoTWConfirmationDownloadError.htmlResponse) {
            try plan.parseResponse(response(type: nil, body: Data("  <!DOCTYPE html><html>Login failed</html>".utf8)))
        }
        #expect(throws: LoTWConfirmationDownloadError.oversizedResponse) {
            try plan.parseResponse(response(body: Data(repeating: 32, count: 8 * 1_024 * 1_024 + 1)))
        }
        let atLimit = Data(empty.utf8) + Data(repeating: 32, count: 8 * 1_024 * 1_024 - empty.utf8.count)
        #expect(try plan.parseResponse(response(body: atLimit)).records.isEmpty)
        #expect(throws: LoTWConfirmationDownloadError.invalidEncoding) { try plan.parseResponse(response(body: Data([0xff]))) }
        #expect(throws: LoTWReportError.malformedEnvelope) { try plan.parseResponse(response(body: Data("Login failed".utf8))) }
        #expect(try plan.parseResponse(response()).records.isEmpty)
    }
}
