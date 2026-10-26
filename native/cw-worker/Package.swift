// swift-tools-version: 5.10
import PackageDescription
let package=Package(name:"CWNativeHarness",platforms:[.macOS(.v14)],dependencies:[.package(name:"xlog",path:"../..")],targets:[
    .testTarget(name:"CWWireHarnessTests",dependencies:[.product(name:"XCWCore",package:"xlog")])
])
