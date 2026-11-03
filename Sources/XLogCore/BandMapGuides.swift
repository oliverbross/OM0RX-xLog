import Foundation
import CoreFoundation

/// Bounded JSON carried by the existing workspace/backup preference owner.
/// Published guides stay bundled; only custom data and surface choices persist.
public enum BandMapGuides {
    public static func validate(_ text: String) throws {
        if text.isEmpty { return }
        func invalid() -> NSError { NSError(domain: "xLog.BandMapGuides", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid or oversized band-map guide configuration."]) }
        func label(_ value: Any?, _ maximum: Int) -> Bool {
            guard let value = value as? String, value.count <= maximum else { return false }
            return value.unicodeScalars.allSatisfy { !CharacterSet.controlCharacters.contains($0) }
        }
        func hz(_ value: Any?) -> Bool {
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return false }
            let n = number.doubleValue
            return n.isFinite && n.rounded() == n && (100_000...1_000_000_000).contains(n)
        }
        guard let data = text.data(using: .utf8), data.count <= 524_288,
              let doc = try JSONSerialization.jsonObject(with: data) as? [String: Any], doc["version"] as? Int == 1,
              let custom = doc["custom"] as? [[String: Any]], custom.count <= 16 else { throw invalid() }
        var ids = Set<String>()
        for g in custom {
            guard let id = g["id"] as? String, label(id, 80), !id.isEmpty, !id.hasPrefix("builtin-"), id.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil, ids.insert(id).inserted,
                  g["version"] as? Int == 1, g["units"] as? String == "Hz", g["origin"] as? String == "custom",
                  label(g["name"], 80), !(g["name"] as! String).trimmingCharacters(in: .whitespaces).isEmpty,
                  label(g["region"], 80), label(g["sourceURL"], 512), label(g["reviewed"], 32),
                  let bands = g["supportedBands"] as? [String], bands.count <= 32, bands.allSatisfy({ label($0, 16) }),
                  let ranges = g["ranges"] as? [[String: Any]], ranges.count <= 128,
                  let markers = g["markers"] as? [[String: Any]], markers.count <= 128 else { throw invalid() }
            for r in ranges {
                guard hz(r["startHz"]), hz(r["endHz"]), (r["startHz"] as! NSNumber).doubleValue < (r["endHz"] as! NSNumber).doubleValue,
                      let color = r["color"] as? String, color.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil,
                      label(r["label"], 64) else { throw invalid() }
            }
            for m in markers {
                guard hz(m["frequencyHz"]), label(m["label"], 64), label(m["category"], 32),
                      m["mode"] == nil || ["CW", "USB", "LSB", "FM", "AM"].contains(m["mode"] as? String ?? "") else { throw invalid() }
            }
        }
        for scope in ["desk", "detached"] {
            guard let selection = doc[scope] as? [String: Any], let id = selection["id"] as? String,
                  ["legacy", "builtin-r1-hf-2020", "builtin-r3-2024"].contains(id) || ids.contains(id),
                  selection["visible"] is Bool, selection["beacons"] is Bool else { throw invalid() }
        }
    }
}
