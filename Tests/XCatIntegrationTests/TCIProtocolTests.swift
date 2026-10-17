// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import XCTest
@testable import XCatIntegrationCore

final class TCIProtocolTests: XCTestCase {
    private let address = TCIReceiverAddress(trx: 0, channel: 0)

    func testNoiseReductionEnableRetainsReceiverBooleanTokenAndCompletedReceiptOnly() {
        // Official TCI 2.0 b081213f p25 reply: RX_NR_ENABLE:receiver,bool; no channel.
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("rx_nr_enable:1,Tr"), receivedAt: first)
        XCTAssertTrue(reducer.state.receiverNoiseReductionEnables.isEmpty)
        reducer.apply(decoder.feed("Ue;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.receiverNoiseReductionEnables[1]?.isEnabled, true)
        XCTAssertEqual(reducer.state.receiverNoiseReductionEnables[1]?.rawEnabledToken, "TrUe")
        XCTAssertEqual(reducer.state.receiverNoiseReductionEnables[1]?.receivedAt, completed)
        XCTAssertNil(reducer.state.receiverNoiseReductionEnables[0])
        XCTAssertTrue(reducer.state.receiverBinauralEnables.isEmpty)
        XCTAssertTrue(reducer.state.receiverNoiseBlankerEnables.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.supportedModulations.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
    }

    func testNoiseReductionEnableRejectsQueriesChannelFormsInvalidAndOversizedValues() {
        var reducer = TCIStateReducer(limits: .init(maximumTRXCount: 2))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_NR_ENABLE", arguments: ["0", "false"]), receivedAt: receipt))
        let retained = reducer.state.receiverNoiseReductionEnables
        for arguments in [[], ["0"], ["0", "1", "true"], ["-1", "true"], ["2", "true"], ["0.0", "true"],
                          ["9223372036854775808", "true"], ["0", ""], ["0", "0"], ["0", "1"], ["0", "yes"], ["0", "trüe"], ["0", "false "]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_NR_ENABLE", arguments: arguments), receivedAt: receipt.addingTimeInterval(10)))
            XCTAssertEqual(reducer.state.receiverNoiseReductionEnables, retained)
        }
        var bounded = TCIStateReducer(limits: .init(maximumArgumentBytes: 3))
        XCTAssertFalse(bounded.apply(TCICommand(name: "RX_NR_ENABLE", arguments: ["0", "true"])))
        XCTAssertTrue(bounded.state.receiverNoiseReductionEnables.isEmpty)
    }

    func testNoiseReductionEnableReceiptsAreIndependentOfReceiversBINNBAndRadioStateAndReset() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("RX_NR_ENABLE:0,true;RX_BIN_ENABLE:0,false;RX_NB_ENABLE:0,false;AGC_MODE:0,off;RX_ENABLE:0,true;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let bin = reducer.state.receiverBinauralEnables, nb = reducer.state.receiverNoiseBlankerEnables
        let modes = reducer.state.receiverAGCModes, radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("RX_NR_ENABLE:1,false;MON_ENABLE:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverNoiseReductionEnables[0]?.receivedAt, first)
        reducer.apply(decoder.feed("RX_NR_ENABLE:0,true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverNoiseReductionEnables[0]?.receivedAt, second)
        reducer.apply(decoder.feed("RX_NR_ENABLE:0,FaLsE;"))
        XCTAssertEqual(reducer.state.receiverNoiseReductionEnables[0]?.isEnabled, false)
        XCTAssertEqual(reducer.state.receiverNoiseReductionEnables[0]?.rawEnabledToken, "FaLsE")
        XCTAssertNil(reducer.state.receiverNoiseReductionEnables[0]?.receivedAt)
        XCTAssertEqual(reducer.state.receiverNoiseReductionEnables[1]?.receivedAt, second)
        XCTAssertEqual(reducer.state.receiverBinauralEnables, bin)
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables, nb)
        XCTAssertEqual(reducer.state.receiverAGCModes, modes)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.receiverNoiseReductionEnables.isEmpty)
    }

    func testNoiseReductionEnableUsesDiscoveredReceiverBoundsWithoutChannelScope() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        reducer.apply(decoder.feed("RX_NR_ENABLE:0,true;RX_NR_ENABLE:1,false;"))
        XCTAssertEqual(reducer.state.receiverNoiseReductionEnables.count, 2)
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverNoiseReductionEnables.count, 2)
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverNoiseReductionEnables.count, 1)
        XCTAssertNotNil(reducer.state.receiverNoiseReductionEnables[0])
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_NR_ENABLE", arguments: ["1", "true"])))
    }

    func testTCI20BinauralEnableRetainsReceiverOnlyBooleanTokenAndCompletedNotificationReceipt() {
        // Official TCI 2.0 b081213f, p25: RX_BIN_ENABLE:receiver,bool; not the stale 1.9.5/p24 reference.
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("rx_bin_enable:1,Tr"), receivedAt: first)
        XCTAssertTrue(reducer.state.receiverBinauralEnables.isEmpty)
        reducer.apply(decoder.feed("Ue;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.receiverBinauralEnables[1]?.isEnabled, true)
        XCTAssertEqual(reducer.state.receiverBinauralEnables[1]?.rawEnabledToken, "TrUe")
        XCTAssertEqual(reducer.state.receiverBinauralEnables[1]?.receivedAt, completed)
        XCTAssertNil(reducer.state.receiverBinauralEnables[0])
        XCTAssertTrue(reducer.state.receiverNoiseBlankerEnables.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.supportedModulations.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
    }

    func testBinauralEnableRejectsQueryChannelIndexedInvalidAndOverPolicyValues() {
        var reducer = TCIStateReducer(limits: .init(maximumTRXCount: 2))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_BIN_ENABLE", arguments: ["0", "false"]), receivedAt: receipt))
        let retained = reducer.state.receiverBinauralEnables
        for arguments in [[], ["0"], ["0", "1", "true"], ["-1", "true"], ["2", "true"], ["0.0", "true"],
                          ["9223372036854775808", "true"], ["0", ""], ["0", "0"], ["0", "1"], ["0", "yes"], ["0", "trüe"], ["0", "false "]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_BIN_ENABLE", arguments: arguments), receivedAt: receipt.addingTimeInterval(10)))
            XCTAssertEqual(reducer.state.receiverBinauralEnables, retained)
        }
        var bounded = TCIStateReducer(limits: .init(maximumArgumentBytes: 3))
        XCTAssertFalse(bounded.apply(TCICommand(name: "RX_BIN_ENABLE", arguments: ["0", "true"])))
        XCTAssertTrue(bounded.state.receiverBinauralEnables.isEmpty)
    }

    func testBinauralEnableReceiptsAreIndependentOfReceiversNBAndRadioStateAndReset() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("RX_BIN_ENABLE:0,true;RX_NB_ENABLE:0,false;AGC_MODE:0,off;RX_ENABLE:0,true;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let nb = reducer.state.receiverNoiseBlankerEnables, modes = reducer.state.receiverAGCModes
        let radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("RX_BIN_ENABLE:1,false;MON_ENABLE:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverBinauralEnables[0]?.receivedAt, first)
        reducer.apply(decoder.feed("RX_BIN_ENABLE:0,true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverBinauralEnables[0]?.receivedAt, second)
        reducer.apply(decoder.feed("RX_BIN_ENABLE:0,FaLsE;"))
        XCTAssertEqual(reducer.state.receiverBinauralEnables[0]?.isEnabled, false)
        XCTAssertEqual(reducer.state.receiverBinauralEnables[0]?.rawEnabledToken, "FaLsE")
        XCTAssertNil(reducer.state.receiverBinauralEnables[0]?.receivedAt)
        XCTAssertEqual(reducer.state.receiverBinauralEnables[1]?.receivedAt, second)
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables, nb)
        XCTAssertEqual(reducer.state.receiverAGCModes, modes)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.receiverBinauralEnables.isEmpty)
    }

    func testBinauralEnableUsesDiscoveredReceiverBoundsWithoutInventingChannelScope() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        reducer.apply(decoder.feed("RX_BIN_ENABLE:0,true;RX_BIN_ENABLE:1,false;"))
        XCTAssertEqual(reducer.state.receiverBinauralEnables.count, 2)
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverBinauralEnables.count, 2)
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverBinauralEnables.count, 1)
        XCTAssertNotNil(reducer.state.receiverBinauralEnables[0])
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_BIN_ENABLE", arguments: ["1", "true"])))
    }

    func testNoiseBlankerEnableRetainsExactReceiverBooleanTokenAndCompletedNotificationReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("rx_nb_enable:1,Tr"), receivedAt: first)
        XCTAssertTrue(reducer.state.receiverNoiseBlankerEnables.isEmpty)
        reducer.apply(decoder.feed("Ue;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables[1]?.isEnabled, true)
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables[1]?.rawEnabledToken, "TrUe")
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables[1]?.receivedAt, completed)
        XCTAssertNil(reducer.state.receiverNoiseBlankerEnables[0])
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
    }

    func testNoiseBlankerEnableRejectsQueryChannelIndexedInvalidAndOverPolicyValues() {
        var reducer = TCIStateReducer(limits: .init(maximumTRXCount: 2))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_NB_ENABLE", arguments: ["0", "false"]), receivedAt: receipt))
        let retained = reducer.state.receiverNoiseBlankerEnables
        for arguments in [[], ["0"], ["0", "1", "true"], ["-1", "true"], ["2", "true"], ["0.0", "true"],
                          ["9223372036854775808", "true"], ["0", ""], ["0", "0"], ["0", "1"], ["0", "yes"], ["0", "trüe"], ["0", "false "]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_NB_ENABLE", arguments: arguments), receivedAt: receipt.addingTimeInterval(10)))
            XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables, retained)
        }
        var bounded = TCIStateReducer(limits: .init(maximumArgumentBytes: 3))
        XCTAssertFalse(bounded.apply(TCICommand(name: "RX_NB_ENABLE", arguments: ["0", "true"])))
        XCTAssertTrue(bounded.state.receiverNoiseBlankerEnables.isEmpty)
    }

    func testNoiseBlankerEnableReceiptsAreIndependentOfOtherReceiversAGCAndRadioStateAndReset() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("RX_NB_ENABLE:0,true;AGC_MODE:0,off;AGC_GAIN:0,87;RX_ENABLE:0,true;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let modes = reducer.state.receiverAGCModes, gains = reducer.state.receiverAGCGains
        let radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("RX_NB_ENABLE:1,false;MON_ENABLE:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables[0]?.receivedAt, first)
        reducer.apply(decoder.feed("RX_NB_ENABLE:0,true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables[0]?.receivedAt, second)
        reducer.apply(decoder.feed("RX_NB_ENABLE:0,FaLsE;"))
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables[0]?.isEnabled, false)
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables[0]?.rawEnabledToken, "FaLsE")
        XCTAssertNil(reducer.state.receiverNoiseBlankerEnables[0]?.receivedAt)
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables[1]?.receivedAt, second)
        XCTAssertEqual(reducer.state.receiverAGCModes, modes)
        XCTAssertEqual(reducer.state.receiverAGCGains, gains)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.receiverNoiseBlankerEnables.isEmpty)
    }

    func testNoiseBlankerEnableUsesDiscoveredReceiverBoundsWithoutInventingChannelScope() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        reducer.apply(decoder.feed("RX_NB_ENABLE:0,true;RX_NB_ENABLE:1,false;"))
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables.count, 2)
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables.count, 2)
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverNoiseBlankerEnables.count, 1)
        XCTAssertNotNil(reducer.state.receiverNoiseBlankerEnables[0])
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_NB_ENABLE", arguments: ["1", "true"])))
    }

    func testAGCGainRetainsExactReceiverRawDBAndCompletedNotificationReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("agc_gain:1,+00087."), receivedAt: first)
        XCTAssertTrue(reducer.state.receiverAGCGains.isEmpty)
        reducer.apply(decoder.feed("500;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.receiverAGCGains[1]?.rawDB, "+00087.500")
        XCTAssertEqual(reducer.state.receiverAGCGains[1]?.receivedAt, completed)
        XCTAssertNil(reducer.state.receiverAGCGains[0])
        XCTAssertTrue(reducer.state.receiverAGCModes.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
    }

    func testAGCGainRejectsQueryChannelIndexedMalformedAndExactOutOfRangeDecimalValues() {
        var reducer = TCIStateReducer(limits: .init(maximumArgumentBytes: 32, maximumTRXCount: 2))
        XCTAssertTrue(reducer.apply(TCICommand(name: "AGC_GAIN", arguments: ["0", "87"])))
        let retained = reducer.state.receiverAGCGains
        for arguments in [[], ["0"], ["0", "1", "87"], ["-1", "87"], ["2", "87"], ["0.0", "87"],
                          ["0", ""], ["0", "NaN"], ["0", "Infinity"], ["0", "1e2"], ["0", ".5"], ["0", "87."],
                          ["0", "−12"], ["0", "１２"], ["0", "-21"], ["0", "121"],
                          ["0", "-20.00000000000000000000001"], ["0", "+120.00000000000000000000001"],
                          ["0", String(repeating: "0", count: 33)]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "AGC_GAIN", arguments: arguments)), "\(arguments)")
            XCTAssertEqual(reducer.state.receiverAGCGains, retained)
        }
        for token in ["-020.000", "+00120.000", "-19.999999999999999999", "+119.999999999999999999", "-0.000", "+000.000", "87.50"] {
            XCTAssertTrue(reducer.apply(TCICommand(name: "AGC_GAIN", arguments: ["0", token])), token)
            XCTAssertEqual(reducer.state.receiverAGCGains[0]?.rawDB, token)
        }
    }

    func testAGCGainReceiptsAreIndependentOfReceiversAGCModeAndRadioStateAndReset() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("AGC_GAIN:0,87;AGC_MODE:0,off;MODULATION:0,CW;RX_ENABLE:0,true;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let modes = reducer.state.receiverAGCModes, radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("AGC_GAIN:1,-20;MON_ENABLE:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverAGCGains[0]?.receivedAt, first)
        reducer.apply(decoder.feed("AGC_GAIN:0,87;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverAGCGains[0]?.receivedAt, second)
        reducer.apply(decoder.feed("AGC_GAIN:0,+120;"))
        XCTAssertEqual(reducer.state.receiverAGCGains[0]?.rawDB, "+120")
        XCTAssertNil(reducer.state.receiverAGCGains[0]?.receivedAt)
        XCTAssertEqual(reducer.state.receiverAGCGains[1]?.receivedAt, second)
        XCTAssertEqual(reducer.state.receiverAGCModes, modes)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.receiverAGCGains.isEmpty)
    }

    func testAGCGainUsesDiscoveredReceiverBoundsWithoutInventingChannelScope() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        reducer.apply(decoder.feed("AGC_GAIN:0,87;AGC_GAIN:1,-20;"))
        XCTAssertEqual(reducer.state.receiverAGCGains.count, 2)
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverAGCGains.count, 2)
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverAGCGains.count, 1)
        XCTAssertNotNil(reducer.state.receiverAGCGains[0])
        XCTAssertFalse(reducer.apply(TCICommand(name: "AGC_GAIN", arguments: ["1", "87"])))
    }

    func testAGCModeRetainsExactReceiverOfficialModeRawTokenAndCompletedNotificationReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("agc_mode:1,Fa"), receivedAt: first)
        XCTAssertTrue(reducer.state.receiverAGCModes.isEmpty)
        reducer.apply(decoder.feed("St;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.receiverAGCModes[1]?.mode, .fast)
        XCTAssertEqual(reducer.state.receiverAGCModes[1]?.rawModeToken, "FaSt")
        XCTAssertEqual(reducer.state.receiverAGCModes[1]?.receivedAt, completed)
        XCTAssertNil(reducer.state.receiverAGCModes[0])
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
    }

    func testAGCModeRejectsQueryChannelIndexedUnknownAndOverPolicyModeTokens() {
        var reducer = TCIStateReducer(limits: .init(maximumTRXCount: 2))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "AGC_MODE", arguments: ["0", "normal"]), receivedAt: receipt))
        let retained = reducer.state.receiverAGCModes
        for arguments in [[], ["0"], ["0", "1", "fast"], ["-1", "fast"], ["2", "fast"], ["0.0", "fast"],
                          ["9223372036854775808", "fast"], ["0", ""], ["0", "slow"], ["0", "medium"],
                          ["0", "false"], ["0", "0"], ["0", "fäst"], ["0", "normal "]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "AGC_MODE", arguments: arguments), receivedAt: receipt.addingTimeInterval(10)))
            XCTAssertEqual(reducer.state.receiverAGCModes, retained)
        }
        var bounded = TCIStateReducer(limits: .init(maximumArgumentBytes: 5))
        XCTAssertFalse(bounded.apply(TCICommand(name: "AGC_MODE", arguments: ["0", "normal"])))
        XCTAssertTrue(bounded.state.receiverAGCModes.isEmpty)
    }

    func testAGCModeReceiptsAreIndependentOfOtherReceiversMonitorAndRadioStateAndReset() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("AGC_MODE:0,normal;MODULATION:0,CW;RX_ENABLE:0,true;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("AGC_MODE:1,off;MON_ENABLE:true;MON_VOLUME:-12;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverAGCModes[0]?.receivedAt, first)
        XCTAssertEqual(reducer.state.receiverAGCModes[1]?.mode, .off)
        let monitor = reducer.state.serverMonitorEnable, volume = reducer.state.serverMonitorVolume
        reducer.apply(decoder.feed("AGC_MODE:0,normal;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverAGCModes[0]?.receivedAt, second)
        reducer.apply(decoder.feed("AGC_MODE:0,OfF;"))
        XCTAssertEqual(reducer.state.receiverAGCModes[0]?.mode, .off)
        XCTAssertEqual(reducer.state.receiverAGCModes[0]?.rawModeToken, "OfF")
        XCTAssertNil(reducer.state.receiverAGCModes[0]?.receivedAt)
        XCTAssertEqual(reducer.state.receiverAGCModes[1]?.receivedAt, second)
        XCTAssertEqual(reducer.state.serverMonitorEnable, monitor)
        XCTAssertEqual(reducer.state.serverMonitorVolume, volume)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.receiverAGCModes.isEmpty)
    }

    func testAGCModeUsesDiscoveredReceiverBoundsWithoutInventingChannelScope() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        reducer.apply(decoder.feed("AGC_MODE:0,normal;AGC_MODE:1,fast;"))
        XCTAssertEqual(reducer.state.receiverAGCModes.count, 2)
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverAGCModes.count, 2)
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverAGCModes.count, 1)
        XCTAssertNotNil(reducer.state.receiverAGCModes[0])
        XCTAssertFalse(reducer.apply(TCICommand(name: "AGC_MODE", arguments: ["1", "fast"])))
    }

    func testMonitorEnableRetainsGlobalBooleanExactTokenAndCompletedNotificationReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("mon_ena"), receivedAt: first)
        XCTAssertNil(reducer.state.serverMonitorEnable)
        reducer.apply(decoder.feed("ble:TrUe;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.serverMonitorEnable?.isEnabled, true)
        XCTAssertEqual(reducer.state.serverMonitorEnable?.rawEnabledToken, "TrUe")
        XCTAssertEqual(reducer.state.serverMonitorEnable?.receivedAt, completed)
        XCTAssertNil(reducer.state.serverMonitorVolume)
        XCTAssertNil(reducer.state.serverMainMute)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
    }

    func testMonitorEnableRejectsQueryIndexedMalformedAndOverPolicyTokensWithoutReplacingReceipt() {
        var reducer = TCIStateReducer()
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "MON_ENABLE", arguments: ["false"]), receivedAt: receipt))
        let retained = reducer.state.serverMonitorEnable
        for arguments in [[], [""], ["0"], ["1"], ["yes"], ["NaN"], ["0", "true"], ["0", "1", "false"], ["trüe"], ["true "]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "MON_ENABLE", arguments: arguments), receivedAt: receipt.addingTimeInterval(10)))
            XCTAssertEqual(reducer.state.serverMonitorEnable, retained)
        }
        var bounded = TCIStateReducer(limits: .init(maximumArgumentBytes: 3))
        XCTAssertFalse(bounded.apply(TCICommand(name: "MON_ENABLE", arguments: ["true"])))
        XCTAssertNil(bounded.state.serverMonitorEnable)
    }

    func testMonitorEnableReceiptIsIndependentOfDiscoveryMonitorVolumeMuteAndRadioStateAndResets() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("MON_ENABLE:true;MON_VOLUME:-12;VOLUME:-6;MUTE:false;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let monitor = reducer.state.serverMonitorVolume, global = reducer.state.serverMainVolume, mute = reducer.state.serverMainMute
        let radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("TRX_COUNT:1;CHANNEL_COUNT:1;APP_FOCUS:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverMonitorEnable?.receivedAt, first)
        reducer.apply(decoder.feed("MON_ENABLE:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverMonitorEnable?.receivedAt, second)
        reducer.apply(decoder.feed("MON_ENABLE:FaLsE;"))
        XCTAssertEqual(reducer.state.serverMonitorEnable?.isEnabled, false)
        XCTAssertEqual(reducer.state.serverMonitorEnable?.rawEnabledToken, "FaLsE")
        XCTAssertNil(reducer.state.serverMonitorEnable?.receivedAt)
        XCTAssertEqual(reducer.state.serverMonitorVolume, monitor)
        XCTAssertEqual(reducer.state.serverMainVolume, global)
        XCTAssertEqual(reducer.state.serverMainMute, mute)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertNil(reducer.state.serverMonitorEnable)
    }

    func testMonitorVolumeRetainsGlobalRawDBAndCompletedNotificationReceiptWithoutRadioIdentity() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("mon_volume:-00012."), receivedAt: first)
        XCTAssertNil(reducer.state.serverMonitorVolume)
        reducer.apply(decoder.feed("500;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.serverMonitorVolume?.rawDB, "-00012.500")
        XCTAssertEqual(reducer.state.serverMonitorVolume?.receivedAt, completed)
        XCTAssertNil(reducer.state.serverMainVolume)
        XCTAssertNil(reducer.state.serverMainMute)
        XCTAssertTrue(reducer.state.receiverChannelVolumes.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
    }

    func testMonitorVolumeRejectsQueryIndexedMalformedAndExactOutOfRangeDecimalForms() {
        var reducer = TCIStateReducer(limits: .init(maximumArgumentBytes: 32))
        XCTAssertTrue(reducer.apply(TCICommand(name: "MON_VOLUME", arguments: ["-12"])))
        let retained = reducer.state.serverMonitorVolume
        for arguments in [[], ["0", "-12"], ["-12", "extra"], [""], ["true"], ["NaN"], ["Infinity"],
                          ["-1e1"], ["-.5"], ["-12."], ["−12"], ["-１２"], ["-1.2.3"], ["-1 2"], ["-61"], ["1"],
                          ["-60.00000000000000000000001"], ["+0.00000000000000000000001"], [String(repeating: "0", count: 33)]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "MON_VOLUME", arguments: arguments)), "\(arguments)")
            XCTAssertEqual(reducer.state.serverMonitorVolume, retained)
        }
        for token in ["-060.000", "-59.999999999999999999", "-0.000", "+000.000", "0", "-12.50"] {
            XCTAssertTrue(reducer.apply(TCICommand(name: "MON_VOLUME", arguments: [token])), token)
            XCTAssertEqual(reducer.state.serverMonitorVolume?.rawDB, token)
        }
    }

    func testMonitorVolumeReceiptIsIndependentOfDiscoveryOtherVolumesMutesAndRadioAndResets() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("MON_VOLUME:-60;VOLUME:-6;RX_VOLUME:0,0,-12;MUTE:false;RX_MUTE:0,false;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let global = reducer.state.serverMainVolume, volumes = reducer.state.receiverChannelVolumes
        let mute = reducer.state.serverMainMute, receiverMute = reducer.state.receiverMutes
        let radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("TRX_COUNT:1;CHANNEL_COUNT:1;APP_FOCUS:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverMonitorVolume?.receivedAt, first)
        reducer.apply(decoder.feed("MON_VOLUME:-60;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverMonitorVolume?.receivedAt, second)
        reducer.apply(decoder.feed("MON_VOLUME:0;"))
        XCTAssertEqual(reducer.state.serverMonitorVolume?.rawDB, "0")
        XCTAssertNil(reducer.state.serverMonitorVolume?.receivedAt)
        XCTAssertEqual(reducer.state.serverMainVolume, global)
        XCTAssertEqual(reducer.state.receiverChannelVolumes, volumes)
        XCTAssertEqual(reducer.state.serverMainMute, mute)
        XCTAssertEqual(reducer.state.receiverMutes, receiverMute)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertNil(reducer.state.serverMonitorVolume)
    }

    func testReceiverChannelBalanceRetainsExactAddressRawDBAndCompletedNotificationReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        let other = TCIReceiverAddress(trx: 1, channel: 1)
        reducer.apply(decoder.feed("rx_balance:1,1,+00012."), receivedAt: first)
        XCTAssertTrue(reducer.state.receiverChannelBalances.isEmpty)
        reducer.apply(decoder.feed("500;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.receiverChannelBalances[other]?.rawDB, "+00012.500")
        XCTAssertEqual(reducer.state.receiverChannelBalances[other]?.receivedAt, completed)
        XCTAssertNil(reducer.state.receiverChannelBalances[address])
        XCTAssertTrue(reducer.state.receiverChannelVolumes.isEmpty)
        XCTAssertNil(reducer.state.serverMainVolume)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: other))
    }

    func testReceiverChannelBalanceRejectsQueryMalformedAndExactOutOfRangeDecimalTokens() {
        var reducer = TCIStateReducer(limits: .init(maximumArgumentBytes: 32, maximumTRXCount: 2, maximumChannelCount: 3))
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_BALANCE", arguments: ["0", "0", "-6"])))
        let retained = reducer.state.receiverChannelBalances
        for arguments in [[], ["0", "0"], ["0", "0", "-6", "extra"], ["-1", "0", "-6"],
                          ["2", "0", "-6"], ["0", "-1", "-6"], ["0", "3", "-6"], ["0.0", "0", "-6"],
                          ["0", "1e0", "-6"], ["0", "0", "NaN"], ["0", "0", "Infinity"], ["0", "0", "1e1"],
                          ["0", "0", ".5"], ["0", "0", "12."], ["0", "0", "−12"], ["0", "0", "41"], ["0", "0", "-41"],
                          ["0", "0", "-40.00000000000000000000001"], ["0", "0", "+40.00000000000000000000001"],
                          ["0", "0", String(repeating: "0", count: 33)]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_BALANCE", arguments: arguments)), "\(arguments)")
            XCTAssertEqual(reducer.state.receiverChannelBalances, retained)
        }
        for token in ["-40.000", "+040.000", "-039.999999999999999999", "+39.999999999999999999", "-0.000", "+000.000", "+6.25"] {
            XCTAssertTrue(reducer.apply(TCICommand(name: "RX_BALANCE", arguments: ["0", "0", token])), token)
            XCTAssertEqual(reducer.state.receiverChannelBalances[address]?.rawDB, token)
        }
    }

    func testReceiverChannelBalanceUsesDiscoveredCountsIncludingCAndPrunesBothDimensions() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        reducer.apply(decoder.feed("TRX_COUNT:2;CHANNEL_COUNT:3;RX_BALANCE:0,0,-40;RX_BALANCE:0,1,0;RX_BALANCE:0,2,+40;RX_BALANCE:1,2,-6;"))
        XCTAssertEqual(reducer.state.receiverChannelBalances.count, 4)
        XCTAssertEqual(reducer.state.receiverChannelBalances[TCIReceiverAddress(trx: 0, channel: 2)]?.rawDB, "+40")
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_BALANCE", arguments: ["0", "3", "-6"])))
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverChannelBalances.count, 3)
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_BALANCE", arguments: ["1", "0", "-6"])))
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverChannelBalances.count, 1)
        XCTAssertNotNil(reducer.state.receiverChannelBalances[address])
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_BALANCE", arguments: ["0", "1", "-6"])))
    }

    func testReceiverChannelBalanceReceiptsStayIndependentOfChannelsVolumeMuteAndRadioState() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        let other = TCIReceiverAddress(trx: 0, channel: 1)
        reducer.apply(decoder.feed("RX_BALANCE:0,0,-40;RX_VOLUME:0,0,-12;VOLUME:0;MUTE:false;RX_MUTE:0,false;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let global = reducer.state.serverMainVolume, volumes = reducer.state.receiverChannelVolumes
        let mute = reducer.state.serverMainMute, receiverMute = reducer.state.receiverMutes
        let radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("RX_BALANCE:0,1,0;APP_FOCUS:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverChannelBalances[address]?.receivedAt, first)
        reducer.apply(decoder.feed("RX_BALANCE:0,0,-40;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverChannelBalances[address]?.receivedAt, second)
        reducer.apply(decoder.feed("RX_BALANCE:0,0,+40;"))
        XCTAssertEqual(reducer.state.receiverChannelBalances[address]?.rawDB, "+40")
        XCTAssertNil(reducer.state.receiverChannelBalances[address]?.receivedAt)
        XCTAssertEqual(reducer.state.receiverChannelBalances[other]?.receivedAt, second)
        XCTAssertEqual(reducer.state.serverMainVolume, global)
        XCTAssertEqual(reducer.state.receiverChannelVolumes, volumes)
        XCTAssertEqual(reducer.state.serverMainMute, mute)
        XCTAssertEqual(reducer.state.receiverMutes, receiverMute)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.receiverChannelBalances.isEmpty)
    }

    func testReceiverChannelVolumeRetainsExactAddressRawDBAndCompletedNotificationReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        let other = TCIReceiverAddress(trx: 1, channel: 1)
        reducer.apply(decoder.feed("rx_volume:1,1,-00012."), receivedAt: first)
        XCTAssertTrue(reducer.state.receiverChannelVolumes.isEmpty)
        reducer.apply(decoder.feed("500;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.receiverChannelVolumes[other]?.rawDB, "-00012.500")
        XCTAssertEqual(reducer.state.receiverChannelVolumes[other]?.receivedAt, completed)
        XCTAssertNil(reducer.state.receiverChannelVolumes[address])
        XCTAssertNil(reducer.state.serverMainVolume)
        XCTAssertNil(reducer.state.serverMainMute)
        XCTAssertTrue(reducer.state.receiverMutes.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: other))
    }

    func testReceiverChannelVolumeRejectsQueryMalformedIndexedAndInexactOutOfRangeTokens() {
        var reducer = TCIStateReducer(limits: .init(maximumArgumentBytes: 32, maximumTRXCount: 2, maximumChannelCount: 3))
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_VOLUME", arguments: ["0", "0", "-12"])))
        let retained = reducer.state.receiverChannelVolumes
        for arguments in [[], ["0", "0"], ["0", "0", "-12", "extra"], ["-1", "0", "-12"],
                          ["2", "0", "-12"], ["0", "-1", "-12"], ["0", "3", "-12"], ["0.0", "0", "-12"],
                          ["0", "1e0", "-12"], ["0", "0", "NaN"], ["0", "0", "Infinity"], ["0", "0", "-1e1"],
                          ["0", "0", "-.5"], ["0", "0", "-12."], ["0", "0", "−12"], ["0", "0", "-61"],
                          ["0", "0", "-60.00000000000000000000001"], ["0", "0", "0.00000000000000000000001"],
                          ["0", "0", "-" + String(repeating: "0", count: 33)]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_VOLUME", arguments: arguments)), "\(arguments)")
            XCTAssertEqual(reducer.state.receiverChannelVolumes, retained)
        }
    }

    func testReceiverChannelVolumeUsesDiscoveredCountsIncludingChannelCAndPrunesBothDimensions() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        reducer.apply(decoder.feed("TRX_COUNT:2;CHANNEL_COUNT:3;RX_VOLUME:0,0,0;RX_VOLUME:0,1,-60;RX_VOLUME:0,2,-6;RX_VOLUME:1,2,-12;"))
        XCTAssertEqual(reducer.state.receiverChannelVolumes.count, 4)
        XCTAssertEqual(reducer.state.receiverChannelVolumes[TCIReceiverAddress(trx: 0, channel: 2)]?.rawDB, "-6")
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_VOLUME", arguments: ["0", "3", "-12"])))
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverChannelVolumes.count, 3)
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_VOLUME", arguments: ["1", "0", "-12"])))
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverChannelVolumes.count, 1)
        XCTAssertNotNil(reducer.state.receiverChannelVolumes[address])
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_VOLUME", arguments: ["0", "1", "-12"])))
    }

    func testReceiverChannelVolumeReceiptsAreIndependentOfOtherChannelsGlobalVolumeMuteAndRadioState() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        let other = TCIReceiverAddress(trx: 0, channel: 1)
        reducer.apply(decoder.feed("RX_VOLUME:0,0,-60;VOLUME:0;MUTE:false;RX_MUTE:0,false;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let global = reducer.state.serverMainVolume, mute = reducer.state.serverMainMute, receiverMute = reducer.state.receiverMutes
        let radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("RX_VOLUME:0,1,+000.000;APP_FOCUS:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverChannelVolumes[address]?.receivedAt, first)
        XCTAssertEqual(reducer.state.receiverChannelVolumes[other]?.rawDB, "+000.000")
        reducer.apply(decoder.feed("RX_VOLUME:0,0,-60;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverChannelVolumes[address]?.receivedAt, second)
        reducer.apply(decoder.feed("RX_VOLUME:0,0,-059.999999999999999999;"))
        XCTAssertEqual(reducer.state.receiverChannelVolumes[address]?.rawDB, "-059.999999999999999999")
        XCTAssertNil(reducer.state.receiverChannelVolumes[address]?.receivedAt)
        XCTAssertEqual(reducer.state.receiverChannelVolumes[other]?.receivedAt, second)
        XCTAssertEqual(reducer.state.serverMainVolume, global)
        XCTAssertEqual(reducer.state.serverMainMute, mute)
        XCTAssertEqual(reducer.state.receiverMutes, receiverMute)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.receiverChannelVolumes.isEmpty)
    }

    func testMainVolumeRetainsGlobalRawDBTokenAndCompletedNotificationReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("volume:-00012."), receivedAt: first)
        XCTAssertNil(reducer.state.serverMainVolume)
        reducer.apply(decoder.feed("500;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.serverMainVolume?.rawDB, "-00012.500")
        XCTAssertEqual(reducer.state.serverMainVolume?.receivedAt, completed)
        XCTAssertNil(reducer.state.serverMainMute)
        XCTAssertTrue(reducer.state.receiverMutes.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
    }

    func testMainVolumeRejectsQueryIndexedMalformedAndOversizedDecimalForms() {
        var reducer = TCIStateReducer(limits: .init(maximumArgumentBytes: 12))
        XCTAssertTrue(reducer.apply(TCICommand(name: "VOLUME", arguments: ["-12"])))
        let retained = reducer.state.serverMainVolume
        for arguments in [[], ["0", "-12"], ["-12", "extra"], [""], ["true"], ["NaN"], ["Infinity"],
                          ["-1e1"], ["-.5"], ["-12."], ["−12"], ["-１２"], ["-1.2.3"], ["-1 2"], ["-000000000012"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "VOLUME", arguments: arguments)), "\(arguments)")
            XCTAssertEqual(reducer.state.serverMainVolume, retained)
        }
    }

    func testMainVolumeEnforcesExactOfficialDecimalEndpointsWithoutDoubleRounding() {
        var reducer = TCIStateReducer()
        for token in ["-60", "-060.000", "-59.999999999999999999999", "-0.000", "+000.000", "0", "-12.50"] {
            XCTAssertTrue(reducer.apply(TCICommand(name: "VOLUME", arguments: [token])), token)
            XCTAssertEqual(reducer.state.serverMainVolume?.rawDB, token)
        }
        let retained = reducer.state.serverMainVolume
        for token in ["-61", "-60.0000000000000000000000001", "+0.00000000000000000000001", "1",
                      "+0." + String(repeating: "0", count: 500) + "1", "-" + String(repeating: "9", count: 512)] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "VOLUME", arguments: [token])), token)
            XCTAssertEqual(reducer.state.serverMainVolume, retained)
        }
    }

    func testMainVolumeReceiptIsIndependentOfDiscoveryMuteAndRadioStateAndResets() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("VOLUME:-60;MUTE:false;RX_MUTE:0,false;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let globalMute = reducer.state.serverMainMute, receiverMutes = reducer.state.receiverMutes
        let radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("TRX_COUNT:1;CHANNEL_COUNT:1;APP_FOCUS:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverMainVolume?.receivedAt, first)
        reducer.apply(decoder.feed("VOLUME:-60;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverMainVolume?.receivedAt, second)
        reducer.apply(decoder.feed("VOLUME:0;"))
        XCTAssertEqual(reducer.state.serverMainVolume?.rawDB, "0")
        XCTAssertNil(reducer.state.serverMainVolume?.receivedAt)
        XCTAssertEqual(reducer.state.serverMainMute, globalMute)
        XCTAssertEqual(reducer.state.receiverMutes, receiverMutes)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertNil(reducer.state.serverMainVolume)
    }

    func testReceiverMuteRetainsExactReceiverBooleanAndCompletedNotificationReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("rx_mu"), receivedAt: first)
        XCTAssertTrue(reducer.state.receiverMutes.isEmpty)
        reducer.apply(decoder.feed("te:1,TrUe;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.receiverMutes[1]?.isMuted, true)
        XCTAssertEqual(reducer.state.receiverMutes[1]?.receivedAt, completed)
        XCTAssertNil(reducer.state.receiverMutes[0])
        XCTAssertNil(reducer.state.serverMainMute)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
    }

    func testReceiverMuteRejectsQueriesChannelIndexedAndInvalidReceiverBooleanForms() {
        var reducer = TCIStateReducer(limits: .init(maximumTRXCount: 2))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_MUTE", arguments: ["0", "true"]), receivedAt: receipt))
        let retained = reducer.state.receiverMutes
        for arguments in [[], ["0"], ["true"], ["0", "0", "true"], ["-1", "true"], ["2", "true"],
                          ["0.0", "true"], ["9223372036854775808", "true"], ["0", ""], ["0", "0"], ["0", "1"], ["0", "yes"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_MUTE", arguments: arguments), receivedAt: receipt.addingTimeInterval(10)))
            XCTAssertEqual(reducer.state.receiverMutes, retained)
        }
    }

    func testReceiverMuteReceiptsRemainIndependentOfOtherReceiversGlobalMuteAndRadioState() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("RX_MUTE:0,true;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("MUTE:false;RX_MUTE:1,false;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverMutes[0]?.receivedAt, first)
        XCTAssertEqual(reducer.state.receiverMutes[1]?.isMuted, false)
        let global = reducer.state.serverMainMute
        reducer.apply(decoder.feed("RX_MUTE:0,true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiverMutes[0]?.receivedAt, second)
        reducer.apply(decoder.feed("RX_MUTE:0,false;"))
        XCTAssertEqual(reducer.state.receiverMutes[0]?.isMuted, false)
        XCTAssertNil(reducer.state.receiverMutes[0]?.receivedAt)
        XCTAssertEqual(reducer.state.receiverMutes[1]?.receivedAt, second)
        XCTAssertEqual(reducer.state.serverMainMute, global)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.receiverMutes.isEmpty)
    }

    func testReceiverMuteUsesDiscoveredTRXBoundsAndDoesNotInventChannelScope() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        reducer.apply(decoder.feed("RX_MUTE:0,true;RX_MUTE:1,false;"))
        XCTAssertEqual(reducer.state.receiverMutes.count, 2)
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverMutes.count, 2)
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiverMutes.count, 1)
        XCTAssertNotNil(reducer.state.receiverMutes[0])
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_MUTE", arguments: ["1", "true"])))
    }

    func testMainMuteRetainsGlobalBooleanAndCompletedNotificationReceiptWithoutRadioIdentity() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("mu"), receivedAt: first)
        XCTAssertNil(reducer.state.serverMainMute)
        reducer.apply(decoder.feed("te:TrUe;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.serverMainMute?.isMuted, true)
        XCTAssertEqual(reducer.state.serverMainMute?.receivedAt, completed)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
        XCTAssertNil(reducer.state.serverTransmitFrequency)
    }

    func testMainMuteRejectsQueryIndexedAndMalformedFormsWithoutReplacingReceipt() {
        var reducer = TCIStateReducer()
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "MUTE", arguments: ["false"]), receivedAt: receipt))
        let retained = reducer.state.serverMainMute
        for arguments in [[], [""], ["0"], ["1"], ["yes"], ["NaN"], ["0", "true"], ["0", "1", "false"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "MUTE", arguments: arguments), receivedAt: receipt.addingTimeInterval(10)))
            XCTAssertEqual(reducer.state.serverMainMute, retained)
        }
    }

    func testMainMuteRefreshesOnlyItsOwnReceiptAndDoesNotInferTRXOrTuneStateAndResets() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("MUTE:true;TRX:0,false;TUNE:0,false;VFO:0,0,14025000;"), receivedAt: first)
        let radios = reducer.state.transceivers, frequencies = reducer.state.frequencies
        reducer.apply(decoder.feed("APP_FOCUS:true;TX_FREQUENCY:7140000;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverMainMute?.receivedAt, first)
        reducer.apply(decoder.feed("MUTE:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverMainMute?.receivedAt, second)
        reducer.apply(decoder.feed("MUTE:false;"))
        XCTAssertEqual(reducer.state.serverMainMute?.isMuted, false)
        XCTAssertNil(reducer.state.serverMainMute?.receivedAt)
        XCTAssertEqual(reducer.state.transceivers, radios)
        XCTAssertEqual(reducer.state.frequencies, frequencies)
        reducer = TCIStateReducer()
        XCTAssertNil(reducer.state.serverMainMute)
    }

    func testTXSensorsRetainExactTRXAndFourRawTokensWithCompletedNotificationReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("tx_sensors:1,-00027.200,+047.40,067."), receivedAt: first)
        XCTAssertTrue(reducer.state.transmitSensors.isEmpty)
        reducer.apply(decoder.feed("50,01.700;"), receivedAt: completed)
        let report = reducer.state.transmitSensors[1]
        XCTAssertEqual(report?.rawMicrophoneDBm, "-00027.200")
        XCTAssertEqual(report?.rawRMSWatts, "+047.40")
        XCTAssertEqual(report?.rawPeakWatts, "067.50")
        XCTAssertEqual(report?.rawSWR, "01.700")
        XCTAssertEqual(report?.receivedAt, completed)
        XCTAssertNil(reducer.state.transmitSensors[0])
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
        XCTAssertNil(reducer.state.serverTransmitFrequency)
    }

    func testTXSensorsRejectMalformedPrintedExampleAndAnyInvalidFieldWithoutReplacingEvidence() {
        var decoder = TCITextDecoder()
        var reducer = TCIStateReducer(limits: .init(maximumArgumentBytes: 12, maximumTRXCount: 2))
        let receipt = Date(timeIntervalSince1970: 100)
        let valid = ["0", "-27.2", "47.4", "67.5", "1.7"]
        XCTAssertTrue(reducer.apply(TCICommand(name: "TX_SENSORS", arguments: valid), receivedAt: receipt))
        let retained = reducer.state.transmitSensors
        // The PDF's example lacks the comma between RMS and peak values. Never repair it.
        reducer.apply(decoder.feed("TX_SENSORS:0,-27.2,47.4.67.5,1.7;"), receivedAt: receipt.addingTimeInterval(10))
        XCTAssertEqual(reducer.state.transmitSensors, retained)
        let tail = Array(valid.dropFirst())
        let malformedArguments: [[String]] = [
            [], ["0"], Array(valid.dropLast()), valid + ["extra"],
            ["-1"] + tail, ["2"] + tail, ["0.0"] + tail, ["0", "1"] + tail,
        ]
        for arguments in malformedArguments {
            XCTAssertFalse(reducer.apply(TCICommand(name: "TX_SENSORS", arguments: arguments)))
            XCTAssertEqual(reducer.state.transmitSensors, retained)
        }
        for field in 1...4 {
            for token in ["", "NaN", "Infinity", "1e2", ".5", "1.", "−1.5", "１２", "1.2.3", "1 2", "1;2", "1234567890123"] {
                var arguments = valid
                arguments[field] = token
                XCTAssertFalse(reducer.apply(TCICommand(name: "TX_SENSORS", arguments: arguments)), "\(field):\(token)")
                XCTAssertEqual(reducer.state.transmitSensors, retained)
            }
        }
    }

    func testTXSensorsHaveIndependentTRXReceiptsWithoutPhysicalRangeDoubleConversionOrTXInference() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        let huge = String(repeating: "9", count: 512)
        let report = TCICommand(name: "TX_SENSORS", arguments: ["0", huge, "-1", "+000.00", "-2"])
        XCTAssertTrue(reducer.apply(report, receivedAt: first))
        XCTAssertEqual(reducer.state.transmitSensors[0]?.rawMicrophoneDBm, huge)
        XCTAssertEqual(reducer.state.transmitSensors[0]?.rawRMSWatts, "-1")
        XCTAssertEqual(reducer.state.transmitSensors[0]?.rawSWR, "-2")
        reducer.apply(decoder.feed("TRX:0,false;TX_SENSORS:1,-27.2,47.4,67.5,1.7;RX_SENSORS:0,-71.5;RX_CHANNEL_SENSORS:0,0,-112.7;"), receivedAt: second)
        XCTAssertEqual(reducer.state.transmitSensors[0]?.receivedAt, first)
        let rx = reducer.state.receiveChannelSensors, legacyRX = reducer.state.legacyReceiveSensors
        XCTAssertTrue(reducer.apply(report, receivedAt: second))
        XCTAssertEqual(reducer.state.transmitSensors[0]?.receivedAt, second)
        XCTAssertTrue(reducer.apply(report))
        XCTAssertNil(reducer.state.transmitSensors[0]?.receivedAt)
        XCTAssertEqual(reducer.state.transmitSensors[1]?.receivedAt, second)
        XCTAssertEqual(reducer.state.transceivers[0]?.transmitting, false)
        XCTAssertEqual(reducer.state.receiveChannelSensors, rx)
        XCTAssertEqual(reducer.state.legacyReceiveSensors, legacyRX)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.transmitSensors.isEmpty)
    }

    func testTXSensorsPruneOnlyDiscoveredTRXBoundsWithoutChannelAttribution() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        reducer.apply(decoder.feed("TX_SENSORS:0,-27.2,47.4,67.5,1.7;TX_SENSORS:1,-25,50,75,2;"))
        XCTAssertEqual(reducer.state.transmitSensors.count, 2)
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.transmitSensors.count, 2)
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.transmitSensors.count, 1)
        XCTAssertNotNil(reducer.state.transmitSensors[0])
        XCTAssertFalse(reducer.apply(TCICommand(name: "TX_SENSORS", arguments: ["1", "-25", "50", "75", "2"])))
    }

    func testLegacyRXSensorsRetainReceiverOnlyExactTokenAndCompletedNotificationReceipt() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("rx_sensors:1,-00071."), receivedAt: first)
        XCTAssertTrue(reducer.state.legacyReceiveSensors.isEmpty)
        reducer.apply(decoder.feed("500;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.legacyReceiveSensors[1]?.rawDBm, "-00071.500")
        XCTAssertEqual(reducer.state.legacyReceiveSensors[1]?.receivedAt, completed)
        XCTAssertNil(reducer.state.legacyReceiveSensors[0])
        XCTAssertTrue(reducer.state.receiveChannelSensors.isEmpty)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
    }

    func testLegacyRXSensorsRejectMalformedIndexedInvalidTRXAndNonDecimalOversizedValues() {
        var reducer = TCIStateReducer(limits: .init(maximumArgumentBytes: 12, maximumTRXCount: 2))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_SENSORS", arguments: ["0", "-71.5"]), receivedAt: receipt))
        let retained = reducer.state.legacyReceiveSensors
        for arguments in [[], ["0"], ["0", "0", "-71.5"], ["-1", "-71.5"], ["2", "-71.5"],
                          ["0.0", "-71.5"], ["9223372036854775808", "-71.5"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_SENSORS", arguments: arguments)))
            XCTAssertEqual(reducer.state.legacyReceiveSensors, retained)
        }
        for token in ["", "+", ".5", "71.", "1e2", "NaN", "Infinity", "−71.5", "７１.５", "1.2.3", "1 2", "1;2", "1234567890123"] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_SENSORS", arguments: ["0", token]),
                                         receivedAt: receipt.addingTimeInterval(10)), token)
            XCTAssertEqual(reducer.state.legacyReceiveSensors, retained)
        }
    }

    func testLegacyRXSensorsDoNotMergeWithChannelEvidenceOrInferPhysicalRangeAndHaveOwnReceipts() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        let huge = String(repeating: "9", count: 512)
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_SENSORS", arguments: ["0", huge]), receivedAt: first))
        XCTAssertEqual(reducer.state.legacyReceiveSensors[0]?.rawDBm, huge)
        reducer.apply(decoder.feed("RX_SENSORS:1,+000.00;RX_CHANNEL_SENSORS:0,0,-71.5;VFO:0,0,14025000;"), receivedAt: second)
        XCTAssertEqual(reducer.state.legacyReceiveSensors[0]?.receivedAt, first)
        XCTAssertEqual(reducer.state.legacyReceiveSensors[1]?.rawDBm, "+000.00")
        let channelEvidence = reducer.state.receiveChannelSensors
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_SENSORS", arguments: ["0", huge]), receivedAt: second))
        XCTAssertEqual(reducer.state.legacyReceiveSensors[0]?.receivedAt, second)
        reducer.apply(decoder.feed("RX_SENSORS:0,+35.000;"))
        XCTAssertEqual(reducer.state.legacyReceiveSensors[0]?.rawDBm, "+35.000")
        XCTAssertNil(reducer.state.legacyReceiveSensors[0]?.receivedAt)
        XCTAssertEqual(reducer.state.legacyReceiveSensors[1]?.receivedAt, second)
        XCTAssertEqual(reducer.state.receiveChannelSensors, channelEvidence)
        XCTAssertEqual(reducer.state.frequencies[address], 14_025_000)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.legacyReceiveSensors.isEmpty)
    }

    func testLegacyRXSensorsPruneForDiscoveredTRXBoundsWithoutInventingChannelScope() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        reducer.apply(decoder.feed("RX_SENSORS:0,-71.5;RX_SENSORS:1,-112.7;"))
        XCTAssertEqual(reducer.state.legacyReceiveSensors.count, 2)
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.legacyReceiveSensors.count, 2)
        XCTAssertTrue(reducer.state.receiveChannelSensors.isEmpty)
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.legacyReceiveSensors.count, 1)
        XCTAssertNotNil(reducer.state.legacyReceiveSensors[0])
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_SENSORS", arguments: ["1", "-112.7"])))
    }

    func testRXChannelSensorsRetainExactDecimalTokenAddressAndCompletionReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        let other = TCIReceiverAddress(trx: 1, channel: 1)
        reducer.apply(decoder.feed("rx_channel_sensors:1,1,-00071."), receivedAt: first)
        XCTAssertTrue(reducer.state.receiveChannelSensors.isEmpty)
        reducer.apply(decoder.feed("500;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.receiveChannelSensors[other]?.rawDBm, "-00071.500")
        XCTAssertEqual(reducer.state.receiveChannelSensors[other]?.receivedAt, completed)
        XCTAssertNil(reducer.state.receiveChannelSensors[address])
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: other))
    }

    func testRXChannelSensorsRejectMalformedNonDecimalAndOversizedTokensWithoutReplacingEvidence() {
        var reducer = TCIStateReducer(limits: .init(maximumArgumentBytes: 12))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_CHANNEL_SENSORS", arguments: ["0", "0", "-71.5"]), receivedAt: receipt))
        let retained = reducer.state.receiveChannelSensors
        for token in ["", "+", "-", ".", "-.5", ".5", "71.", "1e2", "-1E-2", "NaN", "Infinity",
                      "-Infinity", "1.2.3", "1 2", " 12", "12 ", "1,2", "1;2", "1:2", "７１.５", "−71.5", "1234567890123"] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_CHANNEL_SENSORS", arguments: ["0", "0", token]),
                                         receivedAt: receipt.addingTimeInterval(10)), token)
            XCTAssertEqual(reducer.state.receiveChannelSensors, retained)
        }
        for arguments in [[], ["0", "0"], ["0", "0", "-71.5", "extra"], ["0", "-71.5"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_CHANNEL_SENSORS", arguments: arguments)))
            XCTAssertEqual(reducer.state.receiveChannelSensors, retained)
        }
        var decoder = TCITextDecoder(limits: reducer.limits)
        reducer.apply(decoder.feed("RX_CHANNEL_SENSORS:0,0,1234567890123;"))
        XCTAssertEqual(reducer.state.receiveChannelSensors, retained)
        XCTAssertEqual(reducer.state.diagnostics.last?.kind, .argumentTooLarge)
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_CHANNEL_SENSORS", arguments: ["0", "0", "000000000001"])))
        XCTAssertEqual(reducer.state.receiveChannelSensors[address]?.rawDBm, "000000000001")
    }

    func testRXChannelSensorsHaveNoPhysicalRangeOrDoubleConversionAndIndependentReceipts() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        let other = TCIReceiverAddress(trx: 0, channel: 1), huge = String(repeating: "9", count: 512)
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_CHANNEL_SENSORS", arguments: ["0", "0", huge]), receivedAt: first))
        XCTAssertEqual(reducer.state.receiveChannelSensors[address]?.rawDBm, huge)
        reducer.apply(decoder.feed("RX_CHANNEL_SENSORS:0,1,+000.00;VFO:0,0,14025000;"), receivedAt: second)
        XCTAssertEqual(reducer.state.receiveChannelSensors[other]?.rawDBm, "+000.00")
        XCTAssertEqual(reducer.state.receiveChannelSensors[address]?.receivedAt, first)
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_CHANNEL_SENSORS", arguments: ["0", "0", huge]), receivedAt: second))
        XCTAssertEqual(reducer.state.receiveChannelSensors[address]?.receivedAt, second)
        reducer.apply(decoder.feed("RX_CHANNEL_SENSORS:0,0,+35.000;"))
        XCTAssertEqual(reducer.state.receiveChannelSensors[address]?.rawDBm, "+35.000")
        XCTAssertNil(reducer.state.receiveChannelSensors[address]?.receivedAt)
        XCTAssertEqual(reducer.state.receiveChannelSensors[other]?.receivedAt, second)
        XCTAssertEqual(reducer.state.frequencies[address], 14_025_000)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.receiveChannelSensors.isEmpty)
    }

    func testRXChannelSensorsUseOnlyABChannelsAndApplicationDiscoveredBoundsAndPrune() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer(limits: .init(maximumTRXCount: 2, maximumChannelCount: 2))
        reducer.apply(decoder.feed("RX_CHANNEL_SENSORS:0,0,-71.5;RX_CHANNEL_SENSORS:0,1,-72;RX_CHANNEL_SENSORS:1,0,-73;RX_CHANNEL_SENSORS:1,1,-74;"))
        XCTAssertEqual(reducer.state.receiveChannelSensors.count, 4)
        for indices in [["-1", "0"], ["2", "0"], ["0", "2"], ["0", "-1"], ["0.0", "0"], ["0", "1e0"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_CHANNEL_SENSORS", arguments: indices + ["-71.5"])))
            XCTAssertEqual(reducer.state.receiveChannelSensors.count, 4)
        }
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiveChannelSensors.count, 2)
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_CHANNEL_SENSORS", arguments: ["1", "0", "-71.5"])))
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.receiveChannelSensors.count, 1)
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_CHANNEL_SENSORS", arguments: ["0", "1", "-71.5"])))
        var defaults = TCIStateReducer()
        XCTAssertFalse(defaults.apply(TCICommand(name: "RX_CHANNEL_SENSORS", arguments: ["0", "2", "-71.5"])))
    }

    func testVFOLockRetainsExactAddressBooleanAndCompletedNotificationReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        let other = TCIReceiverAddress(trx: 1, channel: 1)
        reducer.apply(decoder.feed("vfo_lo"), receivedAt: first)
        XCTAssertTrue(reducer.state.vfoLocks.isEmpty)
        reducer.apply(decoder.feed("ck:1,1,TrUe;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.vfoLocks[other]?.isLocked, true)
        XCTAssertEqual(reducer.state.vfoLocks[other]?.receivedAt, completed)
        XCTAssertNil(reducer.state.vfoLocks[address])
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: other))
    }

    func testVFOLockRejectsMalformedReadAndInvalidIndexBooleanFormsWithoutReplacingEvidence() {
        var reducer = TCIStateReducer(limits: .init(maximumTRXCount: 2, maximumChannelCount: 2))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "VFO_LOCK", arguments: ["0", "0", "true"]), receivedAt: receipt))
        let retained = reducer.state.vfoLocks
        for arguments in [[], ["0", "0"], ["0", "0", "true", "extra"], ["0", "0", ""],
                          ["0", "0", "1"], ["0", "0", "yes"], ["-1", "0", "true"],
                          ["2", "0", "true"], ["0", "2", "true"], ["0", "-1", "true"],
                          ["0.0", "0", "true"], ["0", "1e0", "true"], ["9223372036854775808", "0", "true"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "VFO_LOCK", arguments: arguments),
                                         receivedAt: receipt.addingTimeInterval(10)), "\(arguments)")
            XCTAssertEqual(reducer.state.vfoLocks, retained)
        }
        var defaults = TCIStateReducer()
        XCTAssertFalse(defaults.apply(TCICommand(name: "VFO_LOCK", arguments: ["0", "2", "true"])))
    }

    func testVFOLockUsesDiscoveredBoundsAndPrunesImpossibleRetainedAddresses() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        reducer.apply(decoder.feed("VFO_LOCK:0,0,true;VFO_LOCK:0,1,true;VFO_LOCK:1,0,false;VFO_LOCK:1,1,true;"))
        XCTAssertEqual(reducer.state.vfoLocks.count, 4)
        reducer.apply(decoder.feed("TRX_COUNT:1;"))
        XCTAssertEqual(reducer.state.vfoLocks.count, 2)
        XCTAssertFalse(reducer.apply(TCICommand(name: "VFO_LOCK", arguments: ["1", "0", "true"])))
        reducer.apply(decoder.feed("CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.vfoLocks.count, 1)
        XCTAssertNotNil(reducer.state.vfoLocks[address])
        XCTAssertFalse(reducer.apply(TCICommand(name: "VFO_LOCK", arguments: ["0", "1", "true"])))
    }

    func testVFOLockHasIndependentPerAddressReceiptsAndNoVFOInferenceAndResets() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        let other = TCIReceiverAddress(trx: 0, channel: 1)
        reducer.apply(decoder.feed("VFO_LOCK:0,0,true;"), receivedAt: first)
        reducer.apply(decoder.feed("VFO_LOCK:0,1,false;VFO:0,0,14025000;"), receivedAt: second)
        XCTAssertEqual(reducer.state.vfoLocks[address]?.receivedAt, first)
        XCTAssertEqual(reducer.state.vfoLocks[other]?.receivedAt, second)
        XCTAssertEqual(reducer.state.vfoLocks[other]?.isLocked, false)
        reducer.apply(decoder.feed("VFO_LOCK:0,0,true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.vfoLocks[address]?.receivedAt, second)
        reducer.apply(decoder.feed("VFO_LOCK:0,0,false;"))
        XCTAssertEqual(reducer.state.vfoLocks[address]?.isLocked, false)
        XCTAssertNil(reducer.state.vfoLocks[address]?.receivedAt)
        XCTAssertEqual(reducer.state.vfoLocks[other]?.receivedAt, second)
        XCTAssertEqual(reducer.state.frequencies[address], 14_025_000)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        reducer = TCIStateReducer()
        XCTAssertTrue(reducer.state.vfoLocks.isEmpty)
    }

    func testCallsignSendRetainsExactServerCallsignAndCompletionReceiptWithoutReceiverIdentity() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("callsign_se"), receivedAt: first)
        XCTAssertNil(reducer.state.lastCallsignSend)
        reducer.apply(decoder.feed("nd:ra6lh/P;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.lastCallsignSend?.callsign, "ra6lh/P")
        XCTAssertEqual(reducer.state.lastCallsignSend?.receivedAt, completed)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
        XCTAssertNil(reducer.state.lastCWMacrosEmpty)
    }

    func testCallsignSendRejectsMalformedIndexedAndOversizedFormsWithoutReplacingReceipt() {
        var reducer = TCIStateReducer(limits: .init(maximumArgumentBytes: 12))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "CALLSIGN_SEND", arguments: ["RA6LH"]), receivedAt: receipt))
        let retained = reducer.state.lastCallsignSend
        for arguments in [[], [""], ["RA6 LH"], ["RA6LH;X"], ["RA6LH:X"], ["RA6LH,X"],
                          ["TOO_LONG_CALLSIGN"], ["RA6LĤ"], ["0", "RA6LH"], ["0", "1", "RA6LH"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "CALLSIGN_SEND", arguments: arguments),
                                         receivedAt: receipt.addingTimeInterval(10)), "\(arguments)")
            XCTAssertEqual(reducer.state.lastCallsignSend, retained)
        }
    }

    func testCallsignSendRetainsOneIndependentReportWithoutInferringCWOrTRXCompletion() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("TRX:0,true;CALLSIGN_SEND:RA6LH;"), receivedAt: first)
        reducer.apply(decoder.feed("CW_MACROS_EMPTY;CLICKED_ON_SPOT:OM0RX,14025000;"), receivedAt: second)
        XCTAssertEqual(reducer.state.lastCallsignSend?.callsign, "RA6LH")
        XCTAssertEqual(reducer.state.lastCallsignSend?.receivedAt, first)
        let cwEvent = reducer.state.lastCWMacrosEmpty
        reducer.apply(decoder.feed("CALLSIGN_SEND:RA6LH;"), receivedAt: second)
        XCTAssertEqual(reducer.state.lastCallsignSend?.receivedAt, second)
        reducer.apply(decoder.feed("CALLSIGN_SEND:OM0RX;"))
        XCTAssertEqual(reducer.state.lastCallsignSend?.callsign, "OM0RX")
        XCTAssertNil(reducer.state.lastCallsignSend?.receivedAt)
        XCTAssertEqual(reducer.state.lastCWMacrosEmpty, cwEvent)
        XCTAssertEqual(reducer.state.transceivers[0]?.transmitting, true)
        reducer = TCIStateReducer()
        XCTAssertNil(reducer.state.lastCallsignSend)
    }

    func testCWMacrosEmptyRetainsOnlyCompletedNotificationReceiptWithoutInventingTRXState() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("cw_macros_emp"), receivedAt: first)
        XCTAssertNil(reducer.state.lastCWMacrosEmpty)
        reducer.apply(decoder.feed("ty;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.lastCWMacrosEmpty?.receivedAt, completed)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
        XCTAssertNil(reducer.state.serverTransmitFrequency)
    }

    func testCWMacrosEmptyRejectsAllArgumentFormsWithoutReplacingReceipt() {
        var reducer = TCIStateReducer()
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "CW_MACROS_EMPTY", arguments: []), receivedAt: receipt))
        let retained = reducer.state.lastCWMacrosEmpty
        for arguments in [[""], ["0"], ["true"], ["0", "true"], ["RN6LHF"], ["0", "1"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "CW_MACROS_EMPTY", arguments: arguments),
                                         receivedAt: receipt.addingTimeInterval(10)))
            XCTAssertEqual(reducer.state.lastCWMacrosEmpty, retained)
        }
    }

    func testCWMacrosEmptyReceiptRefreshRequiresItsOwnEventAndResetsWithReducer() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("TRX:0,true;CW_MACROS_EMPTY;"), receivedAt: first)
        XCTAssertEqual(reducer.state.transceivers[0]?.transmitting, true)
        reducer.apply(decoder.feed("APP_FOCUS:true;TX_FREQUENCY:7140000;"), receivedAt: second)
        XCTAssertEqual(reducer.state.lastCWMacrosEmpty?.receivedAt, first)
        XCTAssertTrue(reducer.apply(TCICommand(name: "CW_MACROS_EMPTY", arguments: []), receivedAt: second))
        XCTAssertEqual(reducer.state.lastCWMacrosEmpty?.receivedAt, second)
        XCTAssertEqual(reducer.state.transceivers[0]?.transmitting, true)
        reducer.apply(decoder.feed("CW_MACROS_EMPTY;"))
        XCTAssertNotNil(reducer.state.lastCWMacrosEmpty)
        XCTAssertNil(reducer.state.lastCWMacrosEmpty?.receivedAt)
        reducer = TCIStateReducer()
        XCTAssertNil(reducer.state.lastCWMacrosEmpty)
    }

    func testLegacySpotClickHasOnlyCallsignFrequencyAndProducerReceipt() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("clicked_on_spot:rn6"), receivedAt: first)
        XCTAssertNil(reducer.state.lastLegacySpotClick)
        reducer.apply(decoder.feed("lhf/P,7147500;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.lastLegacySpotClick?.callsign, "rn6lhf/P")
        XCTAssertEqual(reducer.state.lastLegacySpotClick?.frequencyHz, 7_147_500)
        XCTAssertEqual(reducer.state.lastLegacySpotClick?.receivedAt, completed)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
        XCTAssertNil(reducer.state.lastRXSpotClick)
    }

    func testLegacySpotClickRejectsMalformedIndexedAndOutOfBoundsFormsWithoutReplacingEvent() {
        var reducer = TCIStateReducer(limits: .init(maximumArgumentBytes: 12, maximumFrequencyHz: 30_000_000))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "CLICKED_ON_SPOT", arguments: ["RN6LHF", "7147500"]), receivedAt: receipt))
        let retained = reducer.state.lastLegacySpotClick
        for arguments in [[], ["RN6LHF"], ["0", "1", "RN6LHF", "7147500"],
                          ["RN6LHF", "7147500", "CW"], ["", "7147500"], ["RN6 LHF", "7147500"],
                          ["RN6LHF;X", "7147500"], ["TOO_LONG_CALLSIGN", "7147500"],
                          ["RN6LHF", "-1"], ["RN6LHF", "30000001"], ["RN6LHF", "7.14"],
                          ["RN6LHF", "1e6"], ["RN6LHF", "NaN"], ["RN6LHF", "9223372036854775808"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "CLICKED_ON_SPOT", arguments: arguments),
                                         receivedAt: receipt.addingTimeInterval(10)), "\(arguments)")
            XCTAssertEqual(reducer.state.lastLegacySpotClick, retained)
        }
    }

    func testLegacySpotClickRemainsIndependentOfAddressedClicksVFOBoundsAndOtherReceipts() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("VFO_LIMITS:0,1000000;CLICKED_ON_SPOT:RN6LHF,7147500;"), receivedAt: first)
        XCTAssertEqual(reducer.state.lastLegacySpotClick?.frequencyHz, 7_147_500)
        reducer.apply(decoder.feed("RX_CLICKED_ON_SPOT:0,1,OM0RX,14025000;APP_FOCUS:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.lastLegacySpotClick?.callsign, "RN6LHF")
        XCTAssertEqual(reducer.state.lastLegacySpotClick?.receivedAt, first)
        let addressed = reducer.state.lastRXSpotClick
        reducer.apply(decoder.feed("CLICKED_ON_SPOT:RN6LHF,7147500;"), receivedAt: second)
        XCTAssertEqual(reducer.state.lastLegacySpotClick?.receivedAt, second)
        reducer.apply(decoder.feed("CLICKED_ON_SPOT:OM0RX,0;"))
        XCTAssertEqual(reducer.state.lastLegacySpotClick?.callsign, "OM0RX")
        XCTAssertEqual(reducer.state.lastLegacySpotClick?.frequencyHz, 0)
        XCTAssertNil(reducer.state.lastLegacySpotClick?.receivedAt)
        XCTAssertEqual(reducer.state.lastRXSpotClick, addressed)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        reducer = TCIStateReducer()
        XCTAssertNil(reducer.state.lastLegacySpotClick)
    }

    func testAppFocusIsServerGlobalWindowStateWithCompletionReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = first.addingTimeInterval(5)
        reducer.apply(decoder.feed("app_fo"), receivedAt: first)
        XCTAssertNil(reducer.state.serverAppFocus)
        reducer.apply(decoder.feed("cus:TrUe;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.serverAppFocus?.isFocused, true)
        XCTAssertEqual(reducer.state.serverAppFocus?.receivedAt, completed)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
        XCTAssertNil(reducer.state.serverTransmitFrequency)
        XCTAssertNil(reducer.state.lastRXSpotClick)
    }

    func testAppFocusRejectsMalformedAndIndexedFormsWithoutReplacingReceipt() {
        var reducer = TCIStateReducer()
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "APP_FOCUS", arguments: ["false"]), receivedAt: receipt))
        let retained = reducer.state.serverAppFocus
        for arguments in [[], [""], ["0"], ["1"], ["yes"], ["NaN"], ["0", "true"], ["0", "1", "false"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "APP_FOCUS", arguments: arguments),
                                         receivedAt: receipt.addingTimeInterval(10)))
            XCTAssertEqual(reducer.state.serverAppFocus, retained)
        }
    }

    func testAppFocusRefreshesOnlyItsOwnReceiptAndResetsWithConnectionState() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("APP_FOCUS:true;"), receivedAt: first)
        reducer.apply(decoder.feed("READY;VFO:0,0,14025000;TX_FREQUENCY:7140000;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverAppFocus?.receivedAt, first)
        reducer.apply(decoder.feed("APP_FOCUS:true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverAppFocus?.receivedAt, second)
        reducer.apply(decoder.feed("APP_FOCUS:false;"))
        XCTAssertEqual(reducer.state.serverAppFocus?.isFocused, false)
        XCTAssertNil(reducer.state.serverAppFocus?.receivedAt)
        reducer = TCIStateReducer()
        XCTAssertNil(reducer.state.serverAppFocus)
    }

    func testRXSpotClickRetainsExactAddressCallsignFrequencyAndCompletionReceiptOnly() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), completed = Date(timeIntervalSince1970: 105)
        reducer.apply(decoder.feed("rx_clicked_on_spot:0,1,rn6"), receivedAt: first)
        XCTAssertNil(reducer.state.lastRXSpotClick)
        reducer.apply(decoder.feed("lhf/P,7147500;"), receivedAt: completed)
        XCTAssertEqual(reducer.state.lastRXSpotClick?.address, TCIReceiverAddress(trx: 0, channel: 1))
        XCTAssertEqual(reducer.state.lastRXSpotClick?.callsign, "rn6lhf/P")
        XCTAssertEqual(reducer.state.lastRXSpotClick?.frequencyHz, 7_147_500)
        XCTAssertEqual(reducer.state.lastRXSpotClick?.receivedAt, completed)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
        XCTAssertNil(reducer.state.serverTransmitFrequency)
        XCTAssertFalse(reducer.state.ready)
    }

    func testRXSpotClickRejectsMalformedAndOutOfBoundsReportsWithoutReplacingEvent() {
        var reducer = TCIStateReducer(limits: .init(maximumArgumentBytes: 12, maximumFrequencyHz: 30_000_000))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "TRX_COUNT", arguments: ["2"])))
        XCTAssertTrue(reducer.apply(TCICommand(name: "CHANNEL_COUNT", arguments: ["2"])))
        XCTAssertTrue(reducer.apply(TCICommand(name: "RX_CLICKED_ON_SPOT", arguments: ["1", "1", "RN6LHF", "7147500"]), receivedAt: receipt))
        let retained = reducer.state.lastRXSpotClick
        for arguments in [[], ["RN6LHF", "7147500"], ["0", "1", "RN6LHF"],
                          ["0", "1", "RN6LHF", "7147500", "CW"],
                          ["-1", "1", "RN6LHF", "7147500"], ["2", "1", "RN6LHF", "7147500"],
                          ["0", "2", "RN6LHF", "7147500"], ["0", "-1", "RN6LHF", "7147500"],
                          ["0", "1", "", "7147500"], ["0", "1", "RN6 LHF", "7147500"],
                          ["0", "1", "RN6LHF;X", "7147500"], ["0", "1", "TOO_LONG_CALLSIGN", "7147500"],
                          ["0", "1", "RN6LHF", "-1"], ["0", "1", "RN6LHF", "30000001"],
                          ["0", "1", "RN6LHF", "7.14"], ["0", "1", "RN6LHF", "1e6"],
                          ["0", "1", "RN6LHF", "9223372036854775808"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "RX_CLICKED_ON_SPOT", arguments: arguments),
                                         receivedAt: receipt.addingTimeInterval(10)), "\(arguments)")
            XCTAssertEqual(reducer.state.lastRXSpotClick, retained)
        }
        var undiscovered = TCIStateReducer()
        XCTAssertFalse(undiscovered.apply(TCICommand(name: "RX_CLICKED_ON_SPOT", arguments: ["0", "2", "RN6LHF", "7147500"])))
        reducer.apply(TCICommand(name: "CHANNEL_COUNT", arguments: ["1"]))
        XCTAssertFalse(reducer.apply(TCICommand(name: "RX_CLICKED_ON_SPOT", arguments: ["0", "1", "RN6LHF", "7147500"])))
    }

    func testRXSpotClickIsOneEventWithIndependentReceiptAndNoReceiveFrequencyInference() {
        var decoder = TCITextDecoder(), reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100), second = first.addingTimeInterval(10)
        reducer.apply(decoder.feed("VFO_LIMITS:0,1000000;RX_CLICKED_ON_SPOT:0,1,RN6LHF,7147500;"), receivedAt: first)
        XCTAssertEqual(reducer.state.lastRXSpotClick?.frequencyHz, 7_147_500)
        reducer.apply(decoder.feed("VFO:0,0,100000;MODULATION:0,CW;TX_FREQUENCY:100000;"), receivedAt: second)
        XCTAssertEqual(reducer.state.lastRXSpotClick?.receivedAt, first)
        reducer.apply(decoder.feed("RX_CLICKED_ON_SPOT:0,1,RN6LHF,7147500;"), receivedAt: second)
        XCTAssertEqual(reducer.state.lastRXSpotClick?.receivedAt, second)
        reducer.apply(decoder.feed("RX_CLICKED_ON_SPOT:0,0,OM0RX,0;"))
        XCTAssertEqual(reducer.state.lastRXSpotClick?.callsign, "OM0RX")
        XCTAssertEqual(reducer.state.lastRXSpotClick?.frequencyHz, 0)
        XCTAssertNil(reducer.state.lastRXSpotClick?.receivedAt)
        XCTAssertEqual(reducer.state.frequencies[address], 100_000)
        XCTAssertEqual(reducer.state.transceivers[0]?.modulation, "CW")
        reducer = TCIStateReducer()
        XCTAssertNil(reducer.state.lastRXSpotClick)
    }

    func testTXFrequencyIsGlobalPassiveNotificationWithExplicitReceiptTime() {
        var decoder = TCITextDecoder()
        var reducer = TCIStateReducer()
        let receipt = Date(timeIntervalSince1970: 100)
        reducer.apply(decoder.feed("tx_freque"), receivedAt: receipt)
        XCTAssertNil(reducer.state.serverTransmitFrequency)
        reducer.apply(decoder.feed("ncy:7140000;"), receivedAt: receipt)
        XCTAssertEqual(reducer.state.serverTransmitFrequency?.frequencyHz, 7_140_000)
        XCTAssertEqual(reducer.state.serverTransmitFrequency?.receivedAt, receipt)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        XCTAssertFalse(reducer.state.ready)
        XCTAssertNil(reducer.authoritativeSnapshot(for: address))
        XCTAssertTrue(reducer.state.unknownCommands.isEmpty)
    }

    func testTXFrequencyRejectsMalformedAndIndexedFormsWithoutRefreshingReceipt() {
        var reducer = TCIStateReducer(limits: .init(maximumFrequencyHz: 30_000_000))
        let receipt = Date(timeIntervalSince1970: 100)
        XCTAssertTrue(reducer.apply(TCICommand(name: "TX_FREQUENCY", arguments: ["7140000"]), receivedAt: receipt))
        let retained = reducer.state.serverTransmitFrequency
        for arguments in [[], [""], ["0", "7140000"], ["0", "1", "7140000"],
                          ["-1"], ["30000001"], ["7.14"], ["1e6"], ["NaN"],
                          ["9223372036854775808"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "TX_FREQUENCY", arguments: arguments),
                                         receivedAt: receipt.addingTimeInterval(10)))
            XCTAssertEqual(reducer.state.serverTransmitFrequency, retained)
        }
    }

    func testTXFrequencyReceiptRefreshRequiresItsOwnAcceptedReportAndResetsWithReducer() {
        var decoder = TCITextDecoder()
        var reducer = TCIStateReducer()
        let first = Date(timeIntervalSince1970: 100)
        let second = first.addingTimeInterval(1)
        reducer.apply(decoder.feed("TX_FREQUENCY:7140000;"), receivedAt: first)
        reducer.apply(decoder.feed("READY;VFO:0,1,14025000;SPLIT_ENABLE:0,true;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverTransmitFrequency?.receivedAt, first)
        reducer.apply(decoder.feed("TX_FREQUENCY:7140000;"), receivedAt: second)
        XCTAssertEqual(reducer.state.serverTransmitFrequency?.receivedAt, second)
        reducer.apply(decoder.feed("TX_FREQUENCY:7140000;"))
        XCTAssertNil(reducer.state.serverTransmitFrequency?.receivedAt)
        reducer = TCIStateReducer()
        XCTAssertNil(reducer.state.serverTransmitFrequency)
    }

    func testTXFrequencyUsesOnlyApplicationEnvelopeAndDoesNotAcquireReceiverIdentity() {
        var decoder = TCITextDecoder()
        var reducer = TCIStateReducer(limits: .init(maximumFrequencyHz: 30_000_000))
        reducer.apply(decoder.feed("TX_FREQUENCY:30000000;VFO_LIMITS:0,1000000;TRX_COUNT:1;CHANNEL_COUNT:1;"))
        XCTAssertEqual(reducer.state.serverTransmitFrequency?.frequencyHz, 30_000_000)
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
        XCTAssertTrue(reducer.state.transceivers.isEmpty)
        // The specification supplies no minimum; zero remains raw telemetry.
        reducer.apply(decoder.feed("TX_FREQUENCY:0;"))
        XCTAssertEqual(reducer.state.serverTransmitFrequency?.frequencyHz, 0)
    }

    func testSplitIsTRXWideAndDoesNotInventTXVFOEvidence() {
        var reducer = TCIStateReducer()
        XCTAssertTrue(reducer.apply(TCICommand(name: "SPLIT_ENABLE", arguments: ["0", "true"])))
        XCTAssertEqual(reducer.state.transceivers[0]?.splitEnabled, true)
        XCTAssertNil(reducer.state.transceivers[1]?.splitEnabled)
        for arguments in [["0"], ["0", "1"], ["0", "false", "1"], ["-1", "true"]] {
            XCTAssertFalse(reducer.apply(TCICommand(name: "SPLIT_ENABLE", arguments: arguments)))
            XCTAssertEqual(reducer.state.transceivers[0]?.splitEnabled, true)
        }
        XCTAssertFalse(reducer.apply(TCICommand(name: "TX_VFO", arguments: ["0", "1"])))
        XCTAssertTrue(reducer.state.frequencies.isEmpty)
    }

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
