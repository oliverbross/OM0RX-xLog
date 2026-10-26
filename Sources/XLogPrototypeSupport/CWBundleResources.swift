// Copyright © 2026 Oliver Bross OM0RX. SPDX-License-Identifier: GPL-3.0-only
#if os(macOS)
import Foundation
import XCWCore

struct CWBundleManifest: Codable, Sendable {
    let version: Int
    let sourceCommit: String
    let runtimeVersion: String
    let executableSHA256: String
    let runtimeSHA256: String
    let modelSHA256: String
}
enum CWBundleResources {
    static func locate(executable: URL? = Bundle.main.executableURL) throws -> CWComputeResources {
        guard let executable,executable.deletingLastPathComponent().lastPathComponent=="MacOS",
              executable.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent=="Contents" else {
            throw CWComputeError.resourceValidation
        }
        let contents=executable.deletingLastPathComponent().deletingLastPathComponent()
        let directory=contents.appendingPathComponent("Resources/CWDecode",isDirectory:true)
        let manifestURL=directory.appendingPathComponent("manifest.json")
        let attributes=try manifestURL.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey,.fileSizeKey])
        guard attributes.isRegularFile==true,attributes.isSymbolicLink != true,(attributes.fileSize ?? Int.max)<=4096 else {
            throw CWComputeError.resourceValidation
        }
        let manifest=try JSONDecoder().decode(CWBundleManifest.self,from:Data(contentsOf:manifestURL))
        func hex(_ text:String,_ count:Int)->Bool {
            text.utf8.count==count && text.utf8.allSatisfy{(48...57).contains($0)||(97...102).contains($0)}
        }
        guard manifest.version==1,hex(manifest.sourceCommit,40),hex(manifest.executableSHA256,64),hex(manifest.runtimeSHA256,64),
              manifest.modelSHA256==CWSpotPolicy.modelSHA256,
              (1...32).contains(manifest.runtimeVersion.utf8.count),
              manifest.runtimeVersion.utf8.allSatisfy({(48...57).contains($0)||$0==46}) else {throw CWComputeError.resourceValidation}
        let resources=CWComputeResources(executable:contents.appendingPathComponent("MacOS/xlog-cw-worker"),
            model:directory.appendingPathComponent("model.onnx"),runtime:contents.appendingPathComponent("Frameworks/libonnxruntime.dylib"),
            executableSHA256:manifest.executableSHA256,runtimeSHA256:manifest.runtimeSHA256,runtimeVersion:manifest.runtimeVersion)
        guard FileManager.default.isExecutableFile(atPath:resources.executable.path) else {throw CWComputeError.resourceValidation}
        for (file,maximum) in [(resources.executable,32*1024*1024),(resources.model,16*1024*1024),(resources.runtime,128*1024*1024),
                               (directory.appendingPathComponent("model.onnx.json"),16384)] {
            let values=try file.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey,.fileSizeKey])
            guard values.isRegularFile==true,values.isSymbolicLink != true,
                  let size=values.fileSize,size>0,size<=maximum else {throw CWComputeError.resourceValidation}
        }
        return resources
    }
}
#endif
