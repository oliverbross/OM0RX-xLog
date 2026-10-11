// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "OM0RXXLog",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "XLogCore", targets: ["XLogCore"]),
        .executable(name: "om0rx-xlog", targets: ["XLogApp"]),
    ],
    targets: [
        .target(
            name: "XLogCore",
            resources: [.process("Resources")],
            linkerSettings: [
                .linkedFramework("Network"),
                .linkedFramework("Security"),
                .linkedLibrary("sqlite3"),
                .linkedLibrary("z"),
            ]
        ),
        .executableTarget(
            name: "XLogApp",
            dependencies: ["XLogCore"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("MapKit"),
                .linkedFramework("SwiftUI"),
            ]
        ),
        .testTarget(
            name: "XLogCoreTests",
            dependencies: ["XLogCore"],
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
    ]
)
