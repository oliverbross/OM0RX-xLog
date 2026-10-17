import Testing
@testable import XLogCore

@Suite("Passive Keychain query cache")
struct SecretStorePassiveCacheTests {
    @Test("Passive values and misses are read once and shared with presence checks")
    func valueAndMiss() throws {
        let cache = SecretStorePassiveCache()
        let present = SecretStorePassiveCache.Key(service: "test", account: "present")
        let missing = SecretStorePassiveCache.Key(service: "test", account: "missing")
        var valueReads = 0
        var missingReads = 0
        var presenceReads = 0

        #expect(try cache.load(key: present, bypass: false) { valueReads += 1; return "secret" } == "secret")
        #expect(try cache.load(key: present, bypass: false) { valueReads += 1; return "changed" } == "secret")
        #expect(try cache.contains(key: present) { presenceReads += 1; return false })
        #expect(try cache.load(key: missing, bypass: false) { missingReads += 1; return nil } == nil)
        #expect(try cache.load(key: missing, bypass: false) { missingReads += 1; return "late" } == nil)
        #expect(try !cache.contains(key: missing) { presenceReads += 1; return true })
        #expect(valueReads == 1)
        #expect(missingReads == 1)
        #expect(presenceReads == 0)
    }

    @Test("Passive failures are bounded but explicit reads bypass and refresh")
    func failureAndBypass() throws {
        let cache = SecretStorePassiveCache()
        let key = SecretStorePassiveCache.Key(service: "test", account: "denied")
        var reads = 0
        func denied() throws -> String? {
            reads += 1
            throw SecretStoreError.keychain(-25_337)
        }

        #expect(throws: SecretStoreError.self) { try cache.load(key: key, bypass: false, operation: denied) }
        #expect(throws: SecretStoreError.self) { try cache.load(key: key, bypass: false, operation: denied) }
        #expect(reads == 1)
        #expect(try cache.load(key: key, bypass: true) { reads += 1; return "authorized" } == "authorized")
        #expect(try cache.load(key: key, bypass: false, operation: denied) == "authorized")
        #expect(reads == 2)
    }
}
