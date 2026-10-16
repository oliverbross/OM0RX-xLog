// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import XCTest
@testable import XCatIntegrationCore

final class TCICommandEncoderTests: XCTestCase {
    private func encoder(limits: TCIProtocolLimits = .default) throws -> TCICommandEncoder {
        try TCICommandEncoder(
            trxCount: 2, channelCount: 3, frequencyRange: 10_000...160_000_000,
            supportedModulations: ["CW", "USB", "LSB"], limits: limits
        )
    }

    func testEveryTypedCommandHasDeterministicOfficialWireGrammar() throws {
        let encoder = try encoder()
        let b = TCIReceiverAddress(trx: 1, channel: 1)
        let cases: [(TCIOutboundCommand, String)] = [
            (.setVFO(address: b, frequencyHz: 14_025_000), "VFO:1,1,14025000;"),
            (.readVFO(address: b), "VFO:1,1;"),
            (.setModulation(trx: 0, mode: "cw"), "MODULATION:0,CW;"),
            (.readModulation(trx: 1), "MODULATION:1;"),
            (.setRXFilterBand(trx: 0, lowerHz: -2900, upperHz: -70), "RX_FILTER_BAND:0,-2900,-70;"),
            (.readRXFilterBand(trx: 0), "RX_FILTER_BAND:0;"),
            (.setSplitEnable(trx: 1, enabled: true), "SPLIT_ENABLE:1,true;"),
            (.setSplitEnable(trx: 1, enabled: false), "SPLIT_ENABLE:1,false;"),
            (.readSplitEnable(trx: 1), "SPLIT_ENABLE:1;"),
            (.setRXChannelEnable(address: b, enabled: true), "RX_CHANNEL_ENABLE:1,1,true;"),
            (.setRXChannelEnable(address: b, enabled: false), "RX_CHANNEL_ENABLE:1,1,false;"),
            (.readRXChannelEnable(address: b), "RX_CHANNEL_ENABLE:1,1;"),
            (.readRXChannelEnable(address: .init(trx: 0, channel: 0)), "RX_CHANNEL_ENABLE:0,0;"),
            (.setTRX(trx: 0, enabled: true), "TRX:0,true;"),
            (.setTRX(trx: 0, enabled: false), "TRX:0,false;"),
            (.readTRX(trx: 1), "TRX:1;"),
            (.setTune(trx: 0, enabled: true), "TUNE:0,true;"),
            (.setTune(trx: 0, enabled: false), "TUNE:0,false;"),
            (.readTune(trx: 1), "TUNE:1;"),
            (.spot(callsign: "RN6LHF", mode: "cw", frequencyHz: 7_100_000, colorARGB: 16_711_680, text: "ANY_TEXT"),
             "SPOT:RN6LHF,CW,7100000,16711680,ANY_TEXT;"),
            (.spot(callsign: "OM0RX/P", mode: "FT8", frequencyHz: 7_074_000, colorARGB: .max, text: ""),
             "SPOT:OM0RX/P,FT8,7074000,4294967295,;"),
            (.deleteSpot(callsign: "OM0RX/P"), "SPOT_DELETE:OM0RX/P;"),
            (.clearSpots, "SPOT_CLEAR;"),
        ]
        for (command, expected) in cases {
            let wire = try encoder.encode(command)
            XCTAssertEqual(wire, expected)
            XCTAssertEqual(try encoder.encode(command), wire)
            var decoder = TCITextDecoder()
            let decoded = decoder.feed(wire)
            XCTAssertTrue(decoded.diagnostics.isEmpty)
            XCTAssertEqual(decoded.commands.count, 1)
            XCTAssertEqual(decoder.bufferedByteCount, 0)
        }
    }

    func testReceiveTuneFrameCombinesOnlyBoundedTypedCommands() throws {
        let commandEncoder = try encoder()
        let address = TCIReceiverAddress(trx: 1, channel: 2)
        XCTAssertEqual(
            try commandEncoder.encodeFrame([
                .setVFO(address: address, frequencyHz: 14_025_000),
                .setModulation(trx: 1, mode: "USB"),
            ]),
            "VFO:1,2,14025000;MODULATION:1,USB;"
        )
        assertError(.invalidArgument) { try commandEncoder.encodeFrame([]) }
        let bounded = try encoder(limits: .init(maximumFrameBytes: 30))
        assertError(.frameTooLarge) {
            try bounded.encodeFrame([
                .setVFO(address: .init(trx: 0, channel: 0), frequencyHz: 14_025_000),
                .setModulation(trx: 0, mode: "USB"),
            ])
        }
    }

    func testAllOfficialPTTSignalSourcesAndNoArbitrarySourceEscapeHatch() throws {
        let encoder = try encoder()
        let cases: [(TCITXSignalSource, String)] = [
            (.tci, "tci"), (.microphone1, "mic1"), (.microphone2, "mic2"),
            (.pcMicrophone, "micPC"), (.eCoder2, "ecoder2"),
        ]
        XCTAssertEqual(cases.count, TCITXSignalSource.allCases.count)
        for (source, token) in cases {
            XCTAssertEqual(try encoder.encode(.setTRX(trx: 1, enabled: true, source: source)), "TRX:1,true,\(token);")
        }
        XCTAssertNil(TCITXSignalSource(rawValue: "mic3"))
        XCTAssertNil(TCITXSignalSource(rawValue: "tci;TRX:0,true"))
    }

    func testAllReceiverCommandsRejectNegativeAndUndiscoveredReceivers() throws {
        let encoder = try encoder()
        for trx in [-1, 2, Int.max] {
            let address = TCIReceiverAddress(trx: trx, channel: 1)
            let commands: [TCIOutboundCommand] = [
                .setVFO(address: address, frequencyHz: 14_025_000), .readVFO(address: address),
                .setModulation(trx: trx, mode: "CW"), .readModulation(trx: trx),
                .setRXFilterBand(trx: trx, lowerHz: -500, upperHz: 500), .readRXFilterBand(trx: trx),
                .setSplitEnable(trx: trx, enabled: true), .readSplitEnable(trx: trx),
                .setRXChannelEnable(address: address, enabled: true), .readRXChannelEnable(address: address),
                .setTRX(trx: trx, enabled: true), .readTRX(trx: trx),
                .setTune(trx: trx, enabled: true), .readTune(trx: trx),
            ]
            for command in commands { assertError(.outOfBounds) { try encoder.encode(command) } }
        }
    }

    func testChannelBoundsAndOnlyChannelBCanBeControlled() throws {
        let encoder = try encoder()
        for channel in [-1, 3, Int.max] {
            let address = TCIReceiverAddress(trx: 0, channel: channel)
            assertError(.outOfBounds) { try encoder.encode(.readVFO(address: address)) }
            assertError(.outOfBounds) { try encoder.encode(.setVFO(address: address, frequencyHz: 14_025_000)) }
            assertError(.outOfBounds) { try encoder.encode(.readRXChannelEnable(address: address)) }
        }
        for channel in [0, 2] {
            assertError(.outOfBounds) {
                try encoder.encode(.setRXChannelEnable(address: .init(trx: 0, channel: channel), enabled: true))
            }
        }
        let singleChannel = try TCICommandEncoder(
            trxCount: 1, channelCount: 1, frequencyRange: 0...100,
            supportedModulations: ["CW"]
        )
        assertError(.outOfBounds) {
            try singleChannel.encode(.setRXChannelEnable(address: .init(trx: 0, channel: 1), enabled: true))
        }
    }

    func testFrequencyAndFilterBoundsIncludingIntegerExtremes() throws {
        let encoder = try encoder()
        let address = TCIReceiverAddress(trx: 0, channel: 0)
        for frequency in [Int64.min, -1, 0, 9999, 160_000_001, Int64.max] {
            assertError(.outOfBounds) { try encoder.encode(.setVFO(address: address, frequencyHz: frequency)) }
        }
        XCTAssertEqual(try encoder.encode(.setVFO(address: address, frequencyHz: 10_000)), "VFO:0,0,10000;")
        XCTAssertEqual(try encoder.encode(.setVFO(address: address, frequencyHz: 160_000_000)), "VFO:0,0,160000000;")
        for (lower, upper) in [(Int64.min, 1), (-1, Int64.max), (1, 1), (500, -500)] {
            assertError(.outOfBounds) { try encoder.encode(.setRXFilterBand(trx: 0, lowerHz: lower, upperHz: upper)) }
        }
        for frequency in [Int64.min, 0, 1_000_000_000_001, Int64.max] {
            assertError(.outOfBounds) {
                try encoder.encode(.spot(callsign: "OM0RX", mode: "CW", frequencyHz: frequency, colorARGB: 0, text: ""))
            }
        }
    }

    func testTextFieldsRejectInjectionNonASCIIControlsAndEmptyTokens() throws {
        let encoder = try encoder()
        let invalidTokens = ["", "CW;TRX", "A:B", "A,B", "A B", "A\nB", "A\rB", "A\tB", "A\0B", "A\u{7f}B", "é", "ß"]
        for token in invalidTokens {
            assertError(.invalidArgument) { try encoder.encode(.setModulation(trx: 0, mode: token)) }
            assertError(.invalidArgument) { try encoder.encode(.deleteSpot(callsign: token)) }
            assertError(.invalidArgument) {
                try encoder.encode(.spot(callsign: token, mode: "CW", frequencyHz: 10_000, colorARGB: 0, text: ""))
            }
            assertError(.invalidArgument) {
                try encoder.encode(.spot(callsign: "OM0RX", mode: token, frequencyHz: 10_000, colorARGB: 0, text: ""))
            }
        }
        for text in [";TRX:0,true;", "a,b", "a:b", "\r", "\n", "\t", "\0", "\u{7f}", "🙂"] {
            assertError(.invalidArgument) {
                try encoder.encode(.spot(callsign: "OM0RX", mode: "CW", frequencyHz: 10_000, colorARGB: 0, text: text))
            }
        }
        XCTAssertEqual(try encoder.encode(.spot(callsign: "OM0RX", mode: "CW", frequencyHz: 10_000, colorARGB: 0, text: "CQ DX !")),
                       "SPOT:OM0RX,CW,10000,0,CQ DX !;")
        assertError(.unsupportedModulation) { try encoder.encode(.setModulation(trx: 0, mode: "UNSUPPORTED")) }
    }

    func testConfiguredWireBoundsAreEnforcedAtTheirExactBoundaries() throws {
        let argumentEncoder = try encoder(limits: .init(maximumArgumentBytes: 5))
        assertError(.argumentTooLarge) { try argumentEncoder.encode(.deleteSpot(callsign: "OM0RXX")) }
        XCTAssertEqual(try argumentEncoder.encode(.deleteSpot(callsign: "OM0RX")), "SPOT_DELETE:OM0RX;")

        let commandEncoder = try encoder(limits: .init(maximumCommandBytes: 10))
        XCTAssertEqual(try commandEncoder.encode(.clearSpots), "SPOT_CLEAR;")
        assertError(.commandTooLarge) { try commandEncoder.encode(.readModulation(trx: 0)) }
        let frameEncoder = try encoder(limits: .init(maximumFrameBytes: 11))
        XCTAssertEqual(try frameEncoder.encode(.clearSpots), "SPOT_CLEAR;")
        assertError(.frameTooLarge) { try frameEncoder.encode(.readModulation(trx: 0)) }

        let accumulatorEncoder = try encoder(limits: .init(maximumAccumulatorBytes: 10))
        assertError(.frameTooLarge) { try accumulatorEncoder.encode(.clearSpots) }
        let nameEncoder = try encoder(limits: .init(maximumCommandNameBytes: 3))
        assertError(.commandTooLarge) { try nameEncoder.encode(.clearSpots) }
        let countEncoder = try TCICommandEncoder(
            trxCount: 1, channelCount: 1, frequencyRange: 0...100,
            supportedModulations: ["CW"], limits: .init(maximumArguments: 1)
        )
        assertError(.tooManyArguments) { try countEncoder.encode(.setTune(trx: 0, enabled: true)) }
    }

    func testInvalidDiscoveryConfigurationCannotConstructEncoder() {
        for (trx, channel, range) in [
            (0, 2, Int64(0)...100), (-1, 2, 0...100), (17, 2, 0...100),
            (2, 0, 0...100), (2, 17, 0...100), (2, 2, -1...100),
            (2, 2, 0...1_000_000_000_001),
        ] {
            assertError(.invalidConfiguration) {
                try TCICommandEncoder(trxCount: trx, channelCount: channel, frequencyRange: range, supportedModulations: ["CW"])
            }
        }
        assertError(.invalidConfiguration) {
            try TCICommandEncoder(trxCount: 1, channelCount: 1, frequencyRange: 0...100, supportedModulations: [])
        }
        assertError(.invalidArgument) {
            try TCICommandEncoder(trxCount: 1, channelCount: 1, frequencyRange: 0...100, supportedModulations: ["CW;TRX"])
        }
    }

    private func assertError<T>(
        _ expected: TCICommandEncodingError, file: StaticString = #filePath, line: UInt = #line,
        _ body: () throws -> T
    ) {
        XCTAssertThrowsError(try body(), file: file, line: line) { error in
            XCTAssertEqual(error as? TCICommandEncodingError, expected, file: file, line: line)
        }
    }
}
