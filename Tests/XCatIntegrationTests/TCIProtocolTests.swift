// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import XCTest
@testable import XCatIntegrationCore

final class TCIProtocolTests: XCTestCase {
    private let address = TCIReceiverAddress(trx: 0, channel: 0)

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
