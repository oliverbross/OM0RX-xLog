// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
import Foundation
#if os(macOS)
import Darwin
#endif

public struct CWInboundEndpoint: Sendable {
    public let host:String
    public let port:Int
    public init(host:String,port:Int){self.host=host;self.port=port}
}
/// Shared within the native worker, with atomic listener/inbound admission.
/// DNS resolution happens outside the lock and only on explicit connection or
/// configuration changes, never on the IQ or decoder-result path.
public final class CWLocalEndpointGuard:@unchecked Sendable {
    public static let shared=CWLocalEndpointGuard()
    private let lock=NSLock()
    private var listeners:[UUID:(port:Int,instance:UUID)]=[:]
    private var inbound:[UUID:[CWInboundEndpoint]]=[:]
    private var inboundRevision:UInt64=0
    private let resolve:@Sendable(String)->Bool
    public init(resolve:@escaping @Sendable(String)->Bool={CWLocalEndpointGuard.resolvesLocally($0)}){self.resolve=resolve}
    public func setInbound(owner:UUID,endpoints:[CWInboundEndpoint]) throws {
        for _ in 0..<4 {
            lock.lock();let ports=Set(listeners.values.map(\.port));lock.unlock()
            // The default-off feature adds no DNS work to existing cluster use.
            let conflict=endpoints.contains{ports.contains($0.port) && resolve($0.host)}
            lock.lock()
            guard ports==Set(listeners.values.map(\.port)) else {lock.unlock();continue}
            guard !conflict else {lock.unlock();throw CWContractError.invalidConfiguration}
            inbound[owner]=endpoints;inboundRevision &+= 1;lock.unlock();return
        }
        throw CWContractError.invalidConfiguration
    }
    public func reserveListener(owner:UUID,port:Int,instance:UUID) throws {
        for _ in 0..<4 {
            lock.lock();let revision=inboundRevision,endpoints=inbound.values.flatMap{$0}.filter{$0.port==port};lock.unlock()
            let conflict=endpoints.contains{resolve($0.host)}
            lock.lock()
            guard revision==inboundRevision else {lock.unlock();continue}
            guard !conflict else {lock.unlock();throw CWContractError.invalidConfiguration}
            listeners[owner]=(port,instance);lock.unlock();return
        }
        throw CWContractError.invalidConfiguration
    }
    public func removeInbound(owner:UUID){lock.lock();inbound.removeValue(forKey:owner);inboundRevision &+= 1;lock.unlock()}
    public func releaseListener(owner:UUID){lock.lock();listeners.removeValue(forKey:owner);lock.unlock()}
    public func isOwnGreeting(_ line:String)->Bool {
        let prefix="# OM0RX-xLog Local CW instance="
        guard line.hasPrefix(prefix),let id=UUID(uuidString:String(line.dropFirst(prefix.count)).trimmingCharacters(in:.whitespacesAndNewlines)) else{return false}
        lock.lock();defer{lock.unlock()};return listeners.values.contains{$0.instance==id}
    }
    public static func resolvesLocally(_ host:String)->Bool {
        let name=host.trimmingCharacters(in:.whitespacesAndNewlines).lowercased()
        if ["localhost","localhost.","::1","[::1]"].contains(name){return true}
        if name.hasSuffix(".invalid"){return false}
        guard !name.isEmpty,name.utf8.count<=253,!name.contains("\0") else{return false}
        #if os(macOS)
        var result:UnsafeMutablePointer<addrinfo>?
        var hints=addrinfo();hints.ai_family=AF_UNSPEC;hints.ai_socktype=SOCK_STREAM
        let status=name.withCString{getaddrinfo($0,nil,&hints,&result)}
        guard status==0,let result else{return false}
        defer{freeaddrinfo(result)}
        // The generated endpoint is loopback-only. Also reject addresses on this
        // host, including hostname aliases, before a provider can rebind them.
        var local:Set<Data>=[]
        var interfaces:UnsafeMutablePointer<ifaddrs>?
        if getifaddrs(&interfaces)==0,let first=interfaces {
            defer{freeifaddrs(first)}
            var current:UnsafeMutablePointer<ifaddrs>?=first
            while let entry=current {
                if let address=entry.pointee.ifa_addr,let bytes=addressBytes(address){local.insert(bytes)}
                current=entry.pointee.ifa_next
            }
        }
        var current:UnsafeMutablePointer<addrinfo>?=result
        while let entry=current {
            if let address=entry.pointee.ai_addr,let bytes=addressBytes(address) {
                if local.contains(bytes){return true}
                if address.pointee.sa_family==sa_family_t(AF_INET),bytes.first==127{return true}
                if address.pointee.sa_family==sa_family_t(AF_INET6) {
                    if bytes==Data(Array(repeating:0,count:15)+[1]){return true}
                    if bytes.count==16,bytes.prefix(10).allSatisfy({$0==0}),bytes[10]==255,bytes[11]==255,bytes[12]==127{return true}
                }
            }
            current=entry.pointee.ai_next
        }
        return false
        #else
        return name.hasPrefix("127.") || name.hasPrefix("::ffff:127.")
        #endif
    }
    #if os(macOS)
    private static func addressBytes(_ address:UnsafePointer<sockaddr>)->Data? {
        switch Int32(address.pointee.sa_family) {
        case AF_INET:
            var value=UnsafeRawPointer(address).assumingMemoryBound(to:sockaddr_in.self).pointee.sin_addr
            return withUnsafeBytes(of:&value){Data($0)}
        case AF_INET6:
            var value=UnsafeRawPointer(address).assumingMemoryBound(to:sockaddr_in6.self).pointee.sin6_addr
            return withUnsafeBytes(of:&value){Data($0)}
        default:return nil
        }
    }
    #endif
}
