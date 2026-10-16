// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import XCTest
@testable import XCatIntegrationCore

final class TCIProtocolTests: XCTestCase {
    private let address = TCIReceiverAddress(trx: 0, channel: 0)

    func testReducerAcceptanceDistinguishesRepeatedEvidenceFromRepeatedRejection() {
        var reducer = TCIStateReducer(limits: .init(maximumDiagnostics: 1))
        let valid = TCICommand(name: "VFO", arguments: ["0", "0", "14025000"])
        XCTAssertTrue(reducer.apply(valid))
        XCTAssertTrue(reducer.apply(valid))
        let invalid = TCICommand(name: "VFO", arguments: ["0", "0", "invalid"])
        XCTAssertFalse(reducer.apply(invalid))
        // The diagnostics ring is unchanged after this repeated rejection.
        XCTAssertFalse(reducer.apply(invalid))
        XCTAssertFalse(reducer.apply(TCICommand(name: "EXTENSION", arguments: ["x"])))
        XCTAssertTrue(reducer.apply(valid))
    }

    func testLimitsNormalizeInvalidInitializerValuesBeforeBecomingImmutable() {
        let limits = TCIProtocolLimits(
            maximumFrameBytes: 0,
            maximumAccumulatorBytes: -1,
            maximumCommandsPerFeed: 0,
            maximumCommandBytes: -1,
            maximumCommandNameBytes: 0,
            maximumArguments: -1,
            maximumArgumentBytes: 0,
            maximumDiagnostics: -1,
            maximumUnknownCommands: 0,
            maximumTRXCount: -1,
            maximumChannelCount: 0,
            maximumFrequencyHz: -1
        )

        XCTAssertEqual(limits.maximumFrameBytes, 1)
        XCTAssertEqual(limits.maximumAccumulatorBytes, 1)
        XCTAssertEqual(limits.maximumCommandsPerFeed, 1)
        XCTAssertEqual(limits.maximumCommandBytes, 1)
        XCTAssertEqual(limits.maximumCommandNameBytes, 1)
        XCTAssertEqual(limits.maximumArguments, 1)
        XCTAssertEqual(limits.maximumArgumentBytes, 1)
        XCTAssertEqual(limits.maximumDiagnostics, 1)
        XCTAssertEqual(limits.maximumUnknownCommands, 1)
        XCTAssertEqual(limits.maximumTRXCount, 1)
        XCTAssertEqual(limits.maximumChannelCount, 1)
        XCTAssertEqual(limits.maximumFrequencyHz, 1)
    }

    func testDecoderHandlesFragmentedAndCoalescedCaseInsensitiveCommands() {
        var decoder = TCITextDecoder()

        let first = decoder.feed("proToCol:ExpertSDR3,1.8;vfo:0,")
        XCTAssertEqual(first.commands, [TCICommand(name: "PROTOCOL", arguments: ["ExpertSDR3", "1.8"])])
        XCTAssertEqual(decoder.bufferedByteCount, 6)

        let second = decoder.feed("0,14100000;READY;split_enable:0,false;")
        XCTAssertEqual(second.commands, [
            TCICommand(name: "VFO", arguments: ["0", "0", "14100000"]),
            TCICommand(name: "READY", arguments: []),
            TCICommand(name: "SPLIT_ENABLE", arguments: ["0", "false"]),
        ])
        XCTAssertEqual(decoder.bufferedByteCount, 0)
    }

    func testDecoderPreservesEmptyArgumentsAndRejectsReservedColon() {
        var decoder = TCITextDecoder()
        let result = decoder.feed("extension:a,,c,;empty:;broken:a:b;")

        XCTAssertEqual(result.commands, [
            TCICommand(name: "EXTENSION", arguments: ["a", "", "c", ""]),
            TCICommand(name: "EMPTY", arguments: [""]),
        ])
        XCTAssertEqual(result.diagnostics, [TCIDiagnostic(kind: .invalidArguments, commandName: "BROKEN")])
    }

    func testOfficialStyleTranscriptProducesAuthoritativeConfiguredSnapshot() throws {
        let transcript = """
        protocol:ExpertSDR3,1.8;
        device:SunSDR2PRO;
        receive_only:false;
        trx_count:2;
        channels_count:2;
        vfo_limits:0.0,160000000.0;
        if_limits:-156250,156250;
        modulations_list:AM,LSB,USB,CW,NFM,WSPR,FT8,FT4,JT65,JT9,RTTY,BPSK,DIGL,DIGU,WFM,DRM;
        vfo:0,0,144666050;
        modulation:0,USB;
        rx_filter_band:0,10,3960;
        rx_enable:0,true;
        tx_enable:0,true;
        split_enable:0,false;
        trx:0,false;
        tune:0,false;
        start;
        ready;
        """
        var decoder = TCITextDecoder()
        var reducer = TCIStateReducer()
        reducer.apply(decoder.feed(transcript))

        let snapshot = try XCTUnwrap(reducer.authoritativeSnapshot(for: address))
        XCTAssertEqual(snapshot.device, "SunSDR2PRO")
        XCTAssertEqual(snapshot.protocolAnnouncement, TCIProtocolAnnouncement(program: "ExpertSDR3", version: "1.8"))
        XCTAssertEqual(snapshot.frequencyHz, 144_666_050)
        XCTAssertEqual(snapshot.transceiver.modulation, "USB")
        XCTAssertEqual(snapshot.transceiver.receiveFilter, TCIFilterBand(lowHz: 10, highHz: 3_960))
        XCTAssertEqual(snapshot.transceiver.receiveEnabled, true)
        XCTAssertEqual(snapshot.transceiver.transmitEnabled, true)
        XCTAssertEqual(snapshot.transceiver.splitEnabled, false)
        XCTAssertEqual(snapshot.transceiver.transmitting, false)
        XCTAssertEqual(snapshot.transceiver.tuning, false)
        XCTAssertEqual(snapshot.serverRunning, true)
    }

    func testSnapshotRequiresDiscoveryReadyAndConfiguredPairState() {
        var decoder = TCITextDecoder()
        var reducer = TCIStateReducer()
        let discovery = "protocol:ExpertSDR3,2.0;device:SunSDR2;receive_only:false;trx_count:1;channel_count:2;vfo_limits:0,60000000;if_limits:-24000,24000;modulations_list:CW,USB;vfo:0,0,14025000;modulation:0,CW;"
        reducer.apply(decoder.feed(discovery))
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))

        reducer.apply(decoder.feed("ready;"))
        XCTAssertNotNil(reducer.authoritativeSnapshot(for: address))
        XCTAssertNil(reducer.authoritativeSnapshot(for: TCIReceiverAddress(trx: 0, channel: 1)))
        XCTAssertNil(reducer.authoritativeSnapshot(for: TCIReceiverAddress(trx: 1, channel: 0)))
    }

    func testOutOfOrderAndDuplicateInitializationConverges() throws {
        var decoder = TCITextDecoder()
        var reducer = TCIStateReducer()
        reducer.apply(decoder.feed("vfo:0,0,7100000;modulation:0,cw;ready;"))
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))

        reducer.apply(decoder.feed("device:old;protocol:ExpertSDR3,1.8;receive_only:true;trx_count:2;channels_count:2;vfo_limits:0,60000000;if_limits:-12000,12000;modulations_list:USB,CW;device:SunSDR2DX;receive_only:false;"))
        let snapshot = try XCTUnwrap(reducer.authoritativeSnapshot(for: address))
        XCTAssertEqual(snapshot.device, "SunSDR2DX")
        XCTAssertEqual(snapshot.receiveOnly, false)
        XCTAssertEqual(snapshot.frequencyHz, 7_100_000)
        XCTAssertEqual(snapshot.transceiver.modulation, "CW")
    }

    func testAnnouncedBoundsRejectAndPruneOutOfRangeState() {
        var decoder = TCITextDecoder()
        var reducer = TCIStateReducer()
        reducer.apply(decoder.feed("vfo:3,3,7100000;modulation:3,CW;trx_count:1;channel_count:1;vfo_limits:1000000,30000000;if_limits:-12000,12000;modulations_list:CW;protocol:X,1;device:Y;receive_only:false;ready;"))

        XCTAssertNil(reducer.state.frequencies[TCIReceiverAddress(trx: 3, channel: 3)])
        XCTAssertNil(reducer.state.transceivers[3])
        XCTAssertNil(reducer.authoritativeSnapshot(for: TCIReceiverAddress(trx: 3, channel: 3)))

        reducer.apply(decoder.feed("vfo:0,0,50000000;rx_filter_band:0,-20000,20000;"))
        XCTAssertNil(reducer.state.frequencies[address])
        XCTAssertEqual(reducer.state.transceivers[0]?.receiveFilter, TCIFilterBand(lowHz: -20000, highHz: 20000))
        XCTAssertTrue(reducer.state.diagnostics.contains { $0.kind == .outOfBounds })
    }

    func testStrictNumericAndBooleanParsing() {
        XCTAssertEqual(TCIValueParser.integer64("-42"), -42)
        XCTAssertNil(TCIValueParser.integer64("1.0"))
        XCTAssertNil(TCIValueParser.integer64("1e3"))
        XCTAssertNil(TCIValueParser.integer64(String(repeating: "9", count: 100)))
        XCTAssertEqual(TCIValueParser.finiteDouble("-0.25"), -0.25)
        XCTAssertNil(TCIValueParser.finiteDouble("NaN"))
        XCTAssertNil(TCIValueParser.finiteDouble("inf"))
        XCTAssertNil(TCIValueParser.finiteDouble("1e3"))
        XCTAssertEqual(TCIValueParser.boolean("TRUE"), true)
        XCTAssertEqual(TCIValueParser.boolean("false"), false)
        XCTAssertNil(TCIValueParser.boolean("1"))
    }

    func testUnknownCommandsAndDiagnosticsRemainBounded() {
        let limits = TCIProtocolLimits(maximumDiagnostics: 3, maximumUnknownCommands: 2)
        var decoder = TCITextDecoder(limits: limits)
        var reducer = TCIStateReducer(limits: limits)
        reducer.apply(decoder.feed("vendor_a:1;vendor_b:2;vendor_c:3;vendor_d:4;"))

        XCTAssertEqual(reducer.state.unknownCommands.map(\.name), ["VENDOR_C", "VENDOR_D"])
        XCTAssertEqual(reducer.state.diagnostics.count, 3)
        XCTAssertTrue(reducer.state.diagnostics.allSatisfy { $0.kind == .unknownCommand })
    }

    func testFrameAccumulatorCommandAndArgumentLimitsResetSafely() {
        var oversizedFrame = TCITextDecoder(limits: TCIProtocolLimits(maximumFrameBytes: 8))
        XCTAssertEqual(oversizedFrame.feed("device:too-long;").diagnostics.map(\.kind), [.frameTooLarge])
        XCTAssertEqual(oversizedFrame.bufferedByteCount, 0)

        var oversizedAccumulator = TCITextDecoder(limits: TCIProtocolLimits(maximumAccumulatorBytes: 5))
        XCTAssertEqual(oversizedAccumulator.feed("abcdef").diagnostics.map(\.kind), [.accumulatorTooLarge])
        XCTAssertEqual(oversizedAccumulator.bufferedByteCount, 0)

        var tooManyCommands = TCITextDecoder(limits: TCIProtocolLimits(maximumCommandsPerFeed: 2))
        let commandResult = tooManyCommands.feed("ready;start;stop;")
        XCTAssertEqual(commandResult.commands.map(\.name), ["READY", "START"])
        XCTAssertEqual(commandResult.diagnostics.map(\.kind), [.tooManyCommands])
        XCTAssertEqual(tooManyCommands.bufferedByteCount, 0)

        var tooManyArguments = TCITextDecoder(limits: TCIProtocolLimits(maximumArguments: 2))
        XCTAssertEqual(tooManyArguments.feed("vfo:0,0,1;").diagnostics.map(\.kind), [.tooManyArguments])

        var oversizedArgument = TCITextDecoder(limits: TCIProtocolLimits(maximumArgumentBytes: 3))
        XCTAssertEqual(oversizedArgument.feed("device:abcd;").diagnostics.map(\.kind), [.argumentTooLarge])

        var malformedCommandLimit = TCITextDecoder(limits: TCIProtocolLimits(maximumCommandsPerFeed: 2))
        let malformedResult = malformedCommandLimit.feed("bad-name:a;also-bad:b;third-bad:c;")
        XCTAssertEqual(malformedResult.diagnostics.map(\.kind), [.invalidCommandName, .invalidCommandName, .tooManyCommands])
        XCTAssertEqual(malformedCommandLimit.bufferedByteCount, 0)
    }

    func testInvalidASCIIAndMalformedNamesAreRejectedWithoutPoisoningNextFeed() {
        var decoder = TCITextDecoder()
        XCTAssertEqual(decoder.feed("device:SunSDR🛰️;").diagnostics.map(\.kind), [.invalidASCII])
        XCTAssertEqual(decoder.bufferedByteCount, 0)
        XCTAssertEqual(decoder.feed("device:Sun\u{0000}SDR;").diagnostics.map(\.kind), [.invalidASCII])

        let next = decoder.feed("bad-name:x;ready;")
        XCTAssertEqual(next.commands, [TCICommand(name: "READY", arguments: [])])
        XCTAssertEqual(next.diagnostics.map(\.kind), [.invalidCommandName])
    }

    func testTRXSignalSourceIsRetainedAndLaterTwoArgumentStateClearsIt() {
        var decoder = TCITextDecoder()
        var reducer = TCIStateReducer()
        reducer.apply(decoder.feed("trx:0,true,tci;"))
        XCTAssertEqual(reducer.state.transceivers[0]?.transmitting, true)
        XCTAssertEqual(reducer.state.transceivers[0]?.transmitSignalSource, "tci")

        reducer.apply(decoder.feed("trx:0,false;"))
        XCTAssertEqual(reducer.state.transceivers[0]?.transmitting, false)
        XCTAssertNil(reducer.state.transceivers[0]?.transmitSignalSource)
    }

    func testIFLimitsDoNotInvalidateReceiveFilterOrIndependentPairs() {
        var decoder = TCITextDecoder()
        var reducer = TCIStateReducer()
        reducer.apply(decoder.feed("vfo:0,0,7100000;vfo:0,1,14000000;rx_filter_band:0,-3000,3000;if_limits:-2000,2000;"))

        XCTAssertEqual(reducer.state.frequencies[TCIReceiverAddress(trx: 0, channel: 0)], 7_100_000)
        XCTAssertEqual(reducer.state.frequencies[TCIReceiverAddress(trx: 0, channel: 1)], 14_000_000)
        XCTAssertEqual(reducer.state.transceivers[0]?.receiveFilter, TCIFilterBand(lowHz: -3000, highHz: 3000))
    }
}
