// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

/// Bounded operator diagnostics. Provider errors never serialize arbitrary
/// error text, endpoints, commands or credentials into receive snapshots.
public enum CWIQSourceFailure:String,Error,Sendable,CaseIterable {
    case unavailable="iq_unavailable",unsupportedProtocol="iq_unsupported_protocol",occupied="iq_resource_occupied"
    case ownershipUnknown="iq_ownership_unknown",resourceMissing="iq_resource_missing",handoffRequired="iq_handoff_required"
    case rateConflict="iq_rate_conflict",discoveryUnavailable="iq_discovery_unavailable",receiveUnverified="iq_receive_unverified"
    case captureChanged="iq_capture_changed",invalidSamples="iq_invalid_samples",overflow="iq_overflow"
    case noData="iq_no_data",stalled="iq_stalled",continuityLost="iq_continuity_lost",stopped="iq_stopped"

    public var requiresOperatorAction:Bool {
        switch self {
        case .unsupportedProtocol,.occupied,.ownershipUnknown,.resourceMissing,.handoffRequired,.rateConflict,.discoveryUnavailable,.invalidSamples:return true
        default:return false
        }
    }
    public var operatorMessage:String {
        switch self {
        case .unavailable:return "The IQ provider is not ready. Check its direct connection and selected receiver in Radio Settings."
        case .unsupportedProtocol:return "The negotiated TCI version is unsupported. Use a supported ExpertSDR3/TCI contract."
        case .occupied:return "The selected IQ resource is occupied. Release its other consumer or choose an available resource."
        case .ownershipUnknown:return "Ownership of the selected IQ resource is unknown. Verify the Station and released resource."
        case .resourceMissing:return "The selected panadapter, DAX IQ channel or receiver is unavailable. Reload resources and select it explicitly."
        case .handoffRequired:return "The Flex IQ handoff is missing, expired or changed. Release the selected resource and grant a fresh handoff."
        case .rateConflict:return "The actual or shared IQ rate conflicts with the requested rate. Check the selected resource and rate."
        case .discoveryUnavailable:return "Verified Flex manufacturer discovery did not arrive on UDP 4992. Check the LAN/VPN discovery path to this Mac."
        case .receiveUnverified:return "Receive state is not verified. Wait for fresh, known receive state before acquiring IQ."
        case .captureChanged:return "The provider connection, receiver or RF capture changed. Previous copy was invalidated."
        case .invalidSamples:return "The IQ samples, binary format or RF coverage are invalid or unsupported. Check the provider diagnostics."
        case .overflow:return "The bounded IQ queue overflowed. Previous continuity was invalidated. Check decoder load."
        case .noData:return "No fresh IQ samples arrived. A successful stream request alone does not establish reception."
        case .stalled:return "IQ delivery stalled. Check the provider and native UDP/TCP transport."
        case .continuityLost:return "IQ samples were missing, duplicated, out of order or late. Previous continuity was invalidated."
        case .stopped:return "The provider ended this IQ subscription."
        }
    }
    public static func classify(_ error:Error)->Self {
        if let reason=error as? Self{return reason}
        if let contract=error as? CWContractError {
            switch contract {
            case .staleEpoch:return .captureChanged
            case .discontinuity:return .continuityLost
            case .sizeLimit:return .overflow
            default:return .invalidSamples
            }
        }
        if let compute=error as? CWComputeError {
            switch compute {
            case .inputOverflow:return .overflow
            case .invalidFrame:return .invalidSamples
            case .staleInput:return .continuityLost
            case .stopped:return .stopped
            default:break
            }
        }
        return .unavailable
    }
}
