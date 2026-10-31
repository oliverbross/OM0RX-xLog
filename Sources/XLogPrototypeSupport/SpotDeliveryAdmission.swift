import Foundation

/// Evidence for this new delivery attempt only. It says nothing about a prior
/// inventory entry or a different command that may already have crossed the wire.
struct ConfirmedSpotDeliveryNotAdmitted: Error, Sendable {
    let code: String
    let message: String
}

/// Admission for the native station_add_spot route. A different station method
/// must not reuse this whitelist: some of its codes also describe postwire errors.
enum SpotDeliveryAdmission {
    private static let directAgentPrewireCodes: Set<String> = [
        "invalid_params", "worker_stopping", "release_unconfirmed",
        "station_owner_conflict", "station_unavailable", "station_action_blocked",
    ]

    // LiveTCISession.station_add_spot validates payload/session before dispatch.
    // TCIWebSocketSession.addSpot validates target, freshness and commandInFlight
    // before send(text:). Send failures and post-send generation changes map to
    // station_unknown/station_superseded, never these prewire codes.
    private static let directTCIPrewireCodes: Set<String> = [
        "invalid_params", "station_unavailable", "station_busy",
    ]

    static func addSpot(provider: String, preferredRadioID: String? = nil,
                        attempt: @Sendable (String) async throws -> Bool) async throws -> String {
        let radioIDs = preferredRadioID.map { [$0] } ?? ["radio1", "radio2"]
        var lastPrewireFailure: WorkerFailure?
        for radioID in radioIDs {
            do {
                guard try await attempt(radioID) else {
                    throw WorkerFailure("station_rejected", "The selected radio did not confirm spot acceptance.")
                }
                return radioID
            } catch {
                // LiveStationSession wraps every client.addSpot failure as
                // station_rejected. Those failures can follow a submitted command.
                // Stop here: trying another radio would obscure the first effect.
                guard let failure = error as? WorkerFailure else { throw error }
                let prewireCodes: Set<String>
                switch provider {
                case "direct_agent": prewireCodes = directAgentPrewireCodes
                case "direct_tci": prewireCodes = directTCIPrewireCodes
                default: throw error
                }
                guard prewireCodes.contains(failure.code) else { throw error }
                lastPrewireFailure = failure
            }
        }
        // Every attempted radio was positively rejected before its transport send.
        // The selected radio list is always nonempty, including a preferred ID.
        let failure = lastPrewireFailure ?? WorkerFailure("invalid_params", "No radio was selected for spot forwarding.")
        throw ConfirmedSpotDeliveryNotAdmitted(code: failure.code, message: failure.message)
    }
}
