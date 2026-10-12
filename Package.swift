// swift-tools-version: 5.10

import PackageDescription
import Foundation

// Opt-in P1 source slice. Normal app products, dependencies and framework links
// stay on the original manifest branch. Never build the Mac app on other OSes.
let portableOnly = ProcessInfo.processInfo.environment["XLOG_PORTABLE_ONLY"] == "1"

#if os(macOS)
let portableDependencies: [Package.Dependency] = []
let portableCrypto: [Target.Dependency] = []
let sqlitePkgConfig: String? = nil
#else
let portableDependencies: [Package.Dependency] = [
    .package(url: "https://github.com/apple/swift-crypto.git", exact: "3.8.0"),
]
let portableCrypto: [Target.Dependency] = [.product(name: "Crypto", package: "swift-crypto")]
let sqlitePkgConfig: String? = "sqlite3"
#endif

let package = portableOnly ? Package(
    name: "OM0RXXLogPrototype",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "xlog-prototype-worker", targets: ["XLogPrototypeWorker"])],
    dependencies: portableDependencies,
    targets: [
        .systemLibrary(name: "CSQLitePrototype", pkgConfig: sqlitePkgConfig, providers: [.apt(["libsqlite3-dev"])]),
        .target(
            name: "XLogPortableCore",
            dependencies: portableCrypto,
            path: "Sources/XLogCore",
            exclude: [
                "Resources", "ActivationReferenceDirectory.swift", "AwardCatalog.swift",
                "AwardReferences.swift", "AwardRegistry.swift", "BackupManager.swift",
                "CTYResolver.swift", "ClusterSpotFeed.swift", "DXCCBoundaries.swift",
                "FlexSpotForwarder.swift", "Geo.swift", "LogbookDatabase.swift",
                "OperatingSupport.swift", "OperatorIntelligence.swift", "QRZClient.swift",
                "ReferenceDataUpdater.swift", "SecretStore.swift", "Settings.swift",
                "Solar.swift", "SyncEngine.swift", "TransmitPowerCapture.swift",
                "WeatherClient.swift", "XCatClient.swift",
            ],
            sources: ["ADIF.swift", "Models.swift", "QSOADIF.swift", "SemanticQSOIdentity.swift", "WavelogClient.swift"]
        ),
        .target(name: "XClusterIntegrationCore"),
        .target(name: "XStationIntegrationCore"),
        .target(name: "XLogPrototypeSupport", dependencies: ["XLogPortableCore", "CSQLitePrototype", "XClusterIntegrationCore", "XStationIntegrationCore"] + portableCrypto),
        .executableTarget(name: "XLogPrototypeWorker", dependencies: ["XLogPrototypeSupport"]),
        .testTarget(name: "XLogPrototypeTests", dependencies: ["XLogPrototypeSupport", "XLogPortableCore"], exclude: ["worker-process.test.mjs"]),
        .testTarget(name: "XClusterIntegrationTests", dependencies: ["XClusterIntegrationCore"]),
        .testTarget(name: "XStationIntegrationTests", dependencies: ["XStationIntegrationCore"]),
    ]
) : Package(
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
