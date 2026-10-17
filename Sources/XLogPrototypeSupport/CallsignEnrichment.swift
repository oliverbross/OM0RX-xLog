#if os(macOS)
import Foundation
import XLogCore

/// Optional online enrichment must not erase a useful offline CTY result.
enum CallsignEnrichment {
    static func resolve(base: [String: Any], fetch: () async throws -> [String: Any]) async -> [String: Any] {
        var result = base
        do {
            let online = try await fetch()
            let requested = (base["call"] as? String ?? "").uppercased()
            guard (online["call"] as? String)?.uppercased() == requested else {
                result["lookup_warning"] = "Online lookup returned a different callsign; offline result retained."
                return result
            }
            for key in ["name", "gridSquare", "country", "cqZone", "ituZone", "state", "county", "qth", "email",
                        "nickname", "websiteURL", "imageURL", "qslManager", "iota", "licenseClass"] {
                if let value = online[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    result[key] = value
                }
            }
            if let dxcc = online["dxcc"] as? Int, dxcc > 0 { result["dxcc"] = dxcc }
            var location = base["latitude"] is Double && base["longitude"] is Double ? "CTY approximate" : "Unavailable"
            if let lat = online["latitude"] as? Double, let lon = online["longitude"] as? Double,
               lat.isFinite, lon.isFinite, (-90...90).contains(lat), (-180...180).contains(lon) {
                result["latitude"] = lat; result["longitude"] = lon; location = "QRZ coordinates"
            } else if let grid = online["gridSquare"] as? String, let point = MaidenheadLocator.coordinate(grid) {
                result["latitude"] = point.latitude; result["longitude"] = point.longitude; location = "QRZ grid centre"
            }
            result["location_source"] = location
            result["source"] = location == "Unavailable" ? "QRZ · location unavailable" : location.hasPrefix("CTY") ? "QRZ · CTY approximate location" : "QRZ"
            result["qrz_status"] = "matched"
        } catch {
            // Provider errors can contain URLs/session keys. Never echo them.
            result["qrz_status"] = "unavailable"
            if let error = error as? QRZClientError {
                result["lookup_warning"] = "\(error.localizedDescription) Offline CTY result retained."
            } else {
                result["lookup_warning"] = "QRZ lookup is unavailable. Offline CTY result retained."
            }
        }
        return result
    }
}
#endif
