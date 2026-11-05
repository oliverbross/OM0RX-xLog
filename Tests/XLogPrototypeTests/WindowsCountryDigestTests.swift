#if os(Windows)
import CPlatformDigest
import Crypto
import Foundation
import Testing

@Suite("Windows native country digest identity")
struct WindowsCountryDigestTests {
    @Test("Native SHA-256 matches the existing implementation for empty, small and multi-block inputs")
    func digestIdentity() {
        for data in [Data(), Data("abc".utf8), Data(repeating: 97, count: 1_000_000)] {
            var actual = [UInt8](repeating: 0, count: 32)
            let status = data.withUnsafeBytes { input in
                actual.withUnsafeMutableBufferPointer { output in
                    xlog_platform_sha256(input.baseAddress, input.count, output.baseAddress, output.count)
                }
            }
            #expect(status == 1)
            #expect(actual == Array(SHA256.hash(data: data)))
        }
    }

    @Test("Invalid native digest buffers fail without publishing bytes")
    func invalidBuffers() {
        var output = [UInt8](repeating: 77, count: 32)
        let missingInput = output.withUnsafeMutableBufferPointer {
            xlog_platform_sha256(nil, 1, $0.baseAddress, $0.count)
        }
        let shortOutput = output.withUnsafeMutableBufferPointer {
            xlog_platform_sha256(nil, 0, $0.baseAddress, 31)
        }
        #expect(missingInput == 0 && shortOutput == 0)
        #expect(output == [UInt8](repeating: 77, count: 32))
    }
}
#endif
