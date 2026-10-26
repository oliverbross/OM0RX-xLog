// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation

public enum CWClusterClientAction: Equatable, Sendable {
    case send(Data)
    case authenticated(String)
    case history(Int)
    case close(String)
}

/// Streaming ASCII/Telnet framing only. This parser cannot execute radio, OS,
/// upstream cluster or arbitrary commands. Each instance belongs to one client.
public struct CWClusterClientProtocol: Sendable {
    private enum Telnet: Sendable {case data,iac,option(UInt8),sub(Int),subIAC(Int)}
    private var telnet:Telnet = .data
    private var line:[UInt8]=[]
    private var previousCR=false,errors=0,negotiations=0,closed=false
    public private(set) var clientName:String?
    public init(){}
    public static let greeting=Data("# OM0RX-xLog Local CW\r\nlogin: ".utf8)
    public mutating func feed(_ data:Data) -> [CWClusterClientAction] {
        guard !closed else {return []}
        guard data.count<=4096 else {closed=true;return [.close("input_limit")]}
        var actions:[CWClusterClientAction]=[]
        func send(_ text:String)->CWClusterClientAction{.send(Data(text.utf8))}
        for byte in data {
            if closed{break}
            switch telnet {
            case .iac:
                switch byte {
                case 251...254:telnet = .option(byte)
                case 250:telnet = .sub(0)
                case 255:
                    telnet = .data;errors+=1;line.removeAll()
                    actions.append(send("# ASCII input required\r\n"))
                    if errors>=3 {closed=true;actions.append(.close("protocol_limit"))}
                default:telnet = .data
                }
                continue
            case .option(let command):
                negotiations+=1;telnet = .data
                if negotiations>64 {closed=true;actions.append(.close("negotiation_limit"));continue}
                if command==251 {actions.append(.send(Data([255,254,byte])))}
                else if command==253 {actions.append(.send(Data([255,252,byte])))}
                continue
            case .sub(let count):
                if count>=256 {closed=true;actions.append(.close("negotiation_limit"));continue}
                telnet = byte==255 ? .subIAC(count+1):.sub(count+1);continue
            case .subIAC(let count):
                if byte==240 {telnet = .data}
                else if count>=256 {closed=true;actions.append(.close("negotiation_limit"))}
                else {telnet = .sub(count+1)}
                continue
            case .data:break
            }
            if byte==255 {telnet = .iac;continue}
            if byte==13 || byte==10 {
                if byte==10 && previousCR {previousCR=false;continue}
                previousCR=byte==13
                let command=String(decoding:line,as:UTF8.self).trimmingCharacters(in:.whitespaces)
                line.removeAll(keepingCapacity:true)
                guard !command.isEmpty else {continue}
                let lower=command.lowercased()
                if ["bye","quit"].contains(lower) {closed=true;actions.append(.close("client_quit"));continue}
                if ["?","help"].contains(lower) {
                    actions.append(send("# Local CW: help, sh/dx[/1-100], bye. History is sent only on request.\r\n"));continue
                }
                if clientName==nil {
                    if command.utf8.count<=32,command.utf8.allSatisfy({(48...57).contains($0)||(65...90).contains($0)||(97...122).contains($0)||[43,45,46,47,95].contains($0)}) {
                        clientName=command;actions.append(.authenticated(command))
                        actions.append(send("# Connected as \(command). Local CW spots only.\r\n"))
                    } else {errors+=1;actions.append(send("# Enter a callsign or client name (1-32 ASCII characters).\r\n"))}
                } else {
                    let count:Int?
                    if lower=="sh/dx" {count=100}
                    else if lower.hasPrefix("sh/dx/") {count=Self.historyCount(String(lower.dropFirst(6)))}
                    else if lower.hasPrefix("sh/dx ") {count=Self.historyCount(String(lower.dropFirst(6)))}
                    else {count=nil}
                    if let count {actions.append(.history(count))}
                    else {errors+=1;actions.append(send("# Unsupported command. Type help.\r\n"))}
                }
            } else if !(32...126).contains(byte) {
                errors+=1;line.removeAll();previousCR=false;actions.append(send("# ASCII input required\r\n"))
            } else {
                previousCR=false;line.append(byte)
                if line.count>512 {closed=true;actions.append(.close("command_limit"))}
            }
            if errors>=3 {closed=true;actions.append(.close("protocol_limit"))}
        }
        return actions
    }
    private static func historyCount(_ value:String)->Int? {
        guard (1...3).contains(value.utf8.count),value.utf8.allSatisfy({(48...57).contains($0)}),
              let count=Int(value),(1...100).contains(count) else {return nil}
        return count
    }
}
