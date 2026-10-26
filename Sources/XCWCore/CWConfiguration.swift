// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

/// Saved preferences never acquire a radio or start a decoder. Start is a
/// separate explicit action against this revision and the connected radio owner.
public struct CWSourceConfiguration: Codable, Equatable, Sendable {
    public let id: UUID
    public let radioID: String
    public let provider: CWProvider
    public let receiverID: String
    public let sampleRate: Int
    public init(id: UUID = UUID(), radioID: String, provider: CWProvider,
                receiverID: String, sampleRate: Int = 96_000) throws {
        self.id=id; self.radioID=radioID; self.provider=provider
        self.receiverID=receiverID; self.sampleRate=sampleRate
        try validate()
    }
    public func validate() throws {
        guard ["radio1","radio2"].contains(radioID),
              [.tciIQ,.flexDAXIQ].contains(provider),
              (1...64).contains(receiverID.utf8.count),
              receiverID.utf8.allSatisfy({(48...57).contains($0)||(65...90).contains($0)||(97...122).contains($0)||$0==45}),
              [48_000,96_000,192_000].contains(sampleRate) else {throw CWContractError.invalidConfiguration}
        if provider == .tciIQ {guard ["0","1"].contains(receiverID) else {throw CWContractError.invalidConfiguration}}
    }
}

public struct CWDecodeConfiguration: Codable, Equatable, Sendable {
    public let version: Int
    public let revision: UUID
    public let sources: [CWSourceConfiguration]
    public let listenerEnabled: Bool
    public let listenerPort: Int
    public let automaticSpots: Bool
    public init(revision: UUID = UUID(), sources: [CWSourceConfiguration] = [],
                listenerEnabled: Bool = false, listenerPort: Int = 7300,
                automaticSpots: Bool = false) throws {
        version=1;self.revision=revision;self.sources=sources
        self.listenerEnabled=listenerEnabled;self.listenerPort=listenerPort;self.automaticSpots=automaticSpots
        try validate()
    }
    public func validate() throws {
        guard version==1,sources.count<=2,Set(sources.map(\.id)).count==sources.count,
              Set(sources.map{"\($0.radioID)/\($0.provider.rawValue)/\($0.receiverID)"}).count==sources.count,
              (1024...65535).contains(listenerPort) else {throw CWContractError.invalidConfiguration}
        for source in sources {try source.validate()}
        // A TCI socket uses one shared IQ sample rate for all selected receivers.
        for radio in ["radio1","radio2"] {
            guard Set(sources.filter{$0.radioID==radio && $0.provider == .tciIQ}.map(\.sampleRate)).count<=1 else {
                throw CWContractError.invalidConfiguration
            }
        }
    }
    public static func decode(_ data: Data) throws -> Self {
        guard data.count<=16_384 else {throw CWContractError.invalidConfiguration}
        let value=try JSONDecoder().decode(Self.self,from:data)
        try value.validate();return value
    }
}
