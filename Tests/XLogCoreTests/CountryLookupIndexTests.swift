import Foundation
import Testing
@testable import XLogCore

/// Opt-in before/after oracle for immutable lookup-index changes. The normal
/// suite uses the independent country corpus; this additionally preserves the
/// complete Facts result for representatives of every admitted pack rule.
@Suite(.enabled(if: ProcessInfo.processInfo.environment["XLOG_COUNTRY_INDEX_ORACLE"] != nil))
struct CountryLookupIndexTests {
    private struct Entry: Codable {
        let call: String
        let date: Date
        let facts: CTYResolver.Facts
    }

    private func representative(_ pattern: String) -> String {
        let chars = Array(pattern)
        var value = "", cursor = 0
        while cursor < chars.count {
            switch chars[cursor] {
            case "#": value.append("3")
            case "?", "%": value.append("A")
            case "[":
                value.append(chars[cursor + 1])
                while chars[cursor] != "]" { cursor += 1 }
            default: value.append(chars[cursor])
            }
            cursor += 1
        }
        return value
    }

    @Test("Every real rule preserves complete facts while warm lookup cost is measured")
    func fullPackOracle() throws {
        let environment = ProcessInfo.processInfo.environment
        let url = URL(fileURLWithPath: try #require(environment["XLOG_COUNTRY_INDEX_ORACLE"]))
        let resolver = try CTYResolver.bundledCountryPack()
        let day = Date(timeIntervalSince1970: 1_577_880_000)
        let entries: [Entry]
        if environment["XLOG_COUNTRY_INDEX_WRITE"] == "1" {
            let pack = try #require(resolver.countryPack)
            var calls: Set<String> = ["FT4XZZZ", "R1ANZZZ", "3Y0ZZZ", "VK2ZZZ/MM", "3Y0ZZZ/AM",
                "EA8/OM0RX/P", "OM0RX/EA8", "MM/LY3X/P", "OM0RX/4", "KL7AA/1", "LU1ZZZ/F"]
            for record in pack.records {
                let value = representative(record.pattern)
                calls.insert(record.exact ? value : value + "1ZZZ")
            }
            var values: [Entry] = []
            for (index, call) in calls.sorted().enumerated() {
                let dates = index.isMultiple(of: 20) ? [day, Date(timeIntervalSince1970: 630_720_000), Date(timeIntervalSince1970: 1_798_761_600)] : [day]
                for date in dates { values.append(Entry(call: call, date: date, facts: resolver.facts(call, at: date))) }
            }
            entries = values
            try JSONEncoder().encode(entries).write(to: url, options: .atomic)
        } else {
            entries = try JSONDecoder().decode([Entry].self, from: Data(contentsOf: url))
            #expect(entries.count > 20_000)
            for entry in entries {
                #expect(resolver.facts(entry.call, at: entry.date) == entry.facts, "\(entry.call) at \(entry.date)")
            }
        }
        let corpus = ["OM0RX", "K1ABC", "DL1ABC", "JA1ABC", "EA8/OM0RX/P", "FT4XZZZ", "R1ANZZZ", "VK2ZZZ/MM", "3Y0ZZZ", "LU1ZZZ/F", "KL7AA/1", "OK1AYY"]
        let started = ContinuousClock.now
        var checksum = 0
        for index in 0..<10_000 {
            let facts = resolver.facts(corpus[index % corpus.count], at: day)
            checksum += (facts.country?.adif ?? 0) + facts.status.rawValue.utf8.count + (facts.matchedRule?.utf8.count ?? 0)
        }
        let elapsed = started.duration(to: .now).components
        let milliseconds = Double(elapsed.seconds) * 1000 + Double(elapsed.attoseconds) / 1e15
        print("COUNTRY_INDEX_ORACLE entries=\(entries.count) warmLookups=10000 milliseconds=\(milliseconds) checksum=\(checksum) mode=\(environment["XLOG_COUNTRY_INDEX_WRITE"] == "1" ? "write" : "check")")
    }
}
