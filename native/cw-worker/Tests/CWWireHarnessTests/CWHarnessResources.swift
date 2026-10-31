// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
import XCTest
@testable import XCWCore

func cwHarnessResources(probe:Bool=false,badHash:Bool=false) throws -> CWComputeResources {
    var root=URL(fileURLWithPath:#filePath);for _ in 0..<5{root.deleteLastPathComponent()}
    let directory=URL(fileURLWithPath:ProcessInfo.processInfo.environment["XCW_TEST_NATIVE_DIRECTORY"] ?? root.appendingPathComponent(".build/cw-native").path,isDirectory:true)
    let binary=directory.appendingPathComponent(probe ? "cw-process-probe":"xlog-cw-worker")
    let runtime=URL(fileURLWithPath:ProcessInfo.processInfo.environment["XCW_TEST_RUNTIME"] ?? "/private/tmp/onnxruntime-osx-arm64-1.24.3/lib/libonnxruntime.1.24.3.dylib")
    guard FileManager.default.fileExists(atPath:binary.path),FileManager.default.fileExists(atPath:runtime.path) else{throw XCTSkip("Build native CW test executables and provide the pinned official runtime first.")}
    return CWComputeResources(executable:binary,model:root.appendingPathComponent("vendor/deepcw-engine/model.onnx"),runtime:runtime,
        executableSHA256:badHash ? String(repeating:"0",count:64):try CWComputeResources.digest(binary,maximumBytes:32*1024*1024),
        runtimeSHA256:"81b90223e770bfaea12783cb99370258387bae7ed70ff7e99f2717382800d217",runtimeVersion:"1.24.3")
}
#endif
