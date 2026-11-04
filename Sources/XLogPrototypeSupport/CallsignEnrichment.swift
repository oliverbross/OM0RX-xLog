#if os(macOS)
import Foundation
import XLogCore

/// Optional online enrichment must not erase a useful offline CTY result.
enum CallsignEnrichment {
    static func resolve(base: [String: Any], provider: CallsignLookupProvider = .qrz,
                        fetch: () async throws -> [String: Any]) async -> [String: Any] {
        var result = base
        let providerName = provider.displayName
        result["lookup_provider"] = providerName
        do {
            let online = try await fetch()
            let requested = (base["call"] as? String ?? "").uppercased()
            guard (online["call"] as? String)?.uppercased() == requested else {
                result["lookup_warning"] = "Online lookup returned a different callsign; offline result retained."
                return result
            }
            let providerCall = QRZClient.providerCallsign(for: requested)
            let baseDXCC = base["dxcc"] as? Int
            let onlineDXCC = online["dxcc"] as? Int
            let providerEntityMatches = providerCall == requested || baseDXCC == nil || onlineDXCC == baseDXCC
            // Even a same-entity /P profile describes the operator's home QTH,
            // not the portable transmitter. Keep it separately labelled.
            let portableProfile = requested.contains("/")
            let profileKeys = ["name", "email", "nickname", "websiteURL", "imageURL", "qslManager", "licenseClass"]
            let entityKeys = portableProfile ? [] : ["gridSquare", "country", "cqZone", "ituZone", "state", "county", "qth", "iota"]
            for key in profileKeys + (providerEntityMatches ? entityKeys : []) {
                if let value = online[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    result[key] = value
                }
            }
            if providerEntityMatches, !portableProfile, let dxcc = onlineDXCC, dxcc > 0 { result["dxcc"] = dxcc }
            if portableProfile {
                var home: [String: Any] = [:]
                for key in ["gridSquare", "latitude", "longitude", "qth", "state", "county", "country"] {
                    if let value = online[key] { home[key] = value }
                }
                result["home_profile_location"] = home
                result["home_profile_location_source"] = "\(providerName) home profile; operating position unverified"
            }
            var location = base["latitude"] is Double && base["longitude"] is Double ? "CTY approximate" : "Unavailable"
            if providerEntityMatches, !portableProfile,
               let lat = online["latitude"] as? Double, let lon = online["longitude"] as? Double,
               lat.isFinite, lon.isFinite, (-90...90).contains(lat), (-180...180).contains(lon) {
                result["latitude"] = lat; result["longitude"] = lon; location = "\(providerName) coordinates"
            } else if providerEntityMatches, !portableProfile,
                      let grid = online["gridSquare"] as? String, let point = MaidenheadLocator.coordinate(grid) {
                result["latitude"] = point.latitude; result["longitude"] = point.longitude; location = "\(providerName) grid centre"
            }
            if !providerEntityMatches {
                result["lookup_warning"] = "\(providerName) profile is for home callsign \(providerCall); operating-entity location retained."
            }
            result["location_source"] = location
            result["source"] = location == "Unavailable" ? "\(providerName) · location unavailable" : location.hasPrefix("CTY") ? "\(providerName) · CTY approximate location" : providerName
            result["lookup_status"] = "matched"
            if provider == .qrz { result["qrz_status"] = "matched" }
        } catch {
            // Provider errors can contain URLs/session keys. Never echo them.
            result["lookup_status"] = "unavailable"
            if provider == .qrz { result["qrz_status"] = "unavailable" }
            if let error = error as? QRZClientError {
                result["lookup_warning"] = "\(error.localizedDescription) Offline CTY result retained."
            } else if let error = error as? HamQTHClientError {
                result["lookup_warning"] = "\(error.localizedDescription) Offline CTY result retained."
            } else {
                result["lookup_warning"] = "\(providerName) lookup is unavailable. Offline CTY result retained."
            }
        }
        return result
    }
}
#endif
