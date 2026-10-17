// swift-tools-version: 5.10

import PackageDescription
import Foundation

// Opt-in P1 source slice. Normal app products, dependencies and framework links
// stay on the original manifest branch. Never build the Mac app on other OSes.
let portableOnly = ProcessInfo.processInfo.environment["XLOG_PORTABLE_ONLY"] == "1"

#if os(macOS)
let portableDependencies: [Package.Dependency] = []
let portableCrypto: [Target.Dependency] = []
let nativeTransferTargets: [Target] = [
    .target(name: "CCurlBackup", linkerSettings: [.linkedLibrary("curl")]),
]
let sqlitePkgConfig: String? = nil
let liveCoreName = "XLogCore"
let liveIntegrationDependencies: [Target.Dependency] = ["XCatIntegrationCore"]
let prototypeCoreTargets: [Target] = [
    .target(name: "XLogCore", dependencies: ["CCurlBackup"], resources: [.process("Resources")], linkerSettings: [
        .linkedFramework("LocalAuthentication"), .linkedFramework("Network"), .linkedFramework("Security"), .linkedLibrary("sqlite3"), .linkedLibrary("z")
    ]),
    .target(name: "XCatIntegrationCore", linkerSettings: [
        .linkedFramework("LocalAuthentication"), .linkedFramework("Network"), .linkedFramework("Security")
    ])
]
#else
let portableDependencies: [Package.Dependency] = [
    .package(url: "https://github.com/apple/swift-crypto.git", exact: "3.8.0"),
]
let portableCrypto: [Target.Dependency] = [.product(name: "Crypto", package: "swift-crypto")]
let nativeTransferTargets: [Target] = []
let sqlitePkgConfig: String? = "sqlite3"
let liveCoreName = "XLogPortableCore"
let liveIntegrationDependencies: [Target.Dependency] = ["XCatIntegrationCore"]
let prototypeCoreTargets: [Target] = [
    // Public propagation reuses the native parser; radio/network owners remain
    // excluded until their separate portable implementation is accepted.
    .target(name: "XCatIntegrationCore", exclude: [
        "Models.swift", "DXSpot.swift", "SmartLinkRadioClient.swift", "CATCommandProcessor.swift", "SimulatedRadio.swift",
        "RemoteStationConfiguration.swift", "FlexRadioClient.swift", "Rotator.swift",
        "RigCtlCommandProcessor.swift", "RemoteAgentModels.swift", "RemoteAgentClient.swift",
        "TCPCommandServer.swift", "LegacyXCATClient.swift", "SmartLinkBroker.swift",
        "SmartLinkAuth.swift", "RemoteAgentAuth.swift"
    ], sources: ["XCatError.swift", "PropagationConditions.swift", "TCIProtocol.swift"]),
    .target(name: "XLogPortableCore", dependencies: portableCrypto + ["CSQLitePrototype"], path: "Sources/XLogCore",
        exclude: ["DXCCBoundaries.swift", "FlexSpotForwarder.swift",
                  "QRZClient.swift", "ReferenceDataUpdater.swift", "SecretStore.swift",
                  "Solar.swift", "TransmitPowerCapture.swift", "XCatClient.swift"],
        sources: ["ADIF.swift", "Models.swift", "QSOADIF.swift", "SemanticQSOIdentity.swift", "OnlineLogDelivery.swift", "WavelogClient.swift", "SyncEngine.swift",
                  "LogbookDatabase.swift", "SpotHistoryDatabase.swift", "OperatorDraft.swift", "OperatorDraftPower.swift", "SpotDraftActivation.swift", "LogbookContact.swift", "WorkspaceLayout.swift", "IntegrationWorkspace.swift", "Settings.swift", "CWProfile.swift",
                  "BackupManager.swift", "BackupEnvelope.swift", "RemoteBackupPlanning.swift", "FTPBackupConfiguration.swift", "SFTPBackupConfiguration.swift", "RemoteBackupRetentionReview.swift", "RemoteBackupAuthorization.swift", "RemoteBackupScheduler.swift", "RemoteBackupOwner.swift", "RemoteBackupHostDriver.swift", "RemoteBackupLocalAdapters.swift", "DropboxBackupTransport.swift", "DropboxBackupHTTPClient.swift", "GoogleDriveBackupTransport.swift", "GoogleDriveBackupHTTPClient.swift", "OneDriveBackupTransport.swift", "OneDriveBackupHTTPClient.swift", "LocalFilePermissions.swift", "LocalFilePath.swift", "CTYResolver.swift", "Geo.swift",
                  "OperatingSupport.swift", "OperatorIntelligence.swift", "AwardCatalog.swift",
                  "AwardRegistry.swift", "AwardReferences.swift", "ClusterSpotFeed.swift",
                  "ActivationReferenceDirectory.swift", "OpportunityFeeds.swift", "WeatherClient.swift"],
        resources: [.process("Resources")])
]
#endif

let package: Package
if portableOnly {
    package = Package(
    name: "OM0RXXLogPrototype",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "XContestCore", targets: ["XContestCore"]),
        .library(name: "XContestStore", targets: ["XContestStore"]),
        .executable(name: "xlog-prototype-worker", targets: ["XLogPrototypeWorker"]),
    ],
    dependencies: portableDependencies,
    targets: nativeTransferTargets + prototypeCoreTargets + [
        .systemLibrary(name: "CSQLitePrototype", pkgConfig: sqlitePkgConfig, providers: [.apt(["libsqlite3-dev"])]),
        .target(name: "CClusterSocket", linkerSettings: [.linkedLibrary("ws2_32", .when(platforms: [.windows]))]),
        .target(name: "CPlatformVault", linkerSettings: [.linkedLibrary("Advapi32", .when(platforms: [.windows]))]),
        .target(name: "XClusterIntegrationCore", dependencies: ["CClusterSocket"]),
        .target(name: "XStationIntegrationCore"),
        .target(name: "XContestCore"),
        .target(name: "XContestStore", dependencies: ["XContestCore", "CSQLitePrototype"]),
        .target(name: "XLogPrototypeSupport", dependencies: [.byName(name: liveCoreName), "CSQLitePrototype", "CPlatformVault", "XClusterIntegrationCore", "XStationIntegrationCore", "XContestCore", "XContestStore"] + portableCrypto + liveIntegrationDependencies),
        .executableTarget(name: "XLogPrototypeWorker", dependencies: ["XLogPrototypeSupport"]),
        .testTarget(name: "XLogPrototypeTests", dependencies: ["XLogPrototypeSupport", "XClusterIntegrationCore", .byName(name: liveCoreName)], exclude: ["worker-process.test.mjs"]),
        .target(name: "CClusterSocketTestSupport", dependencies: ["CClusterSocket"], path: "Tests/CClusterSocketTestSupport"),
        .testTarget(name: "XClusterIntegrationTests", dependencies: ["XClusterIntegrationCore", "CClusterSocket", "CClusterSocketTestSupport"]),
        .testTarget(name: "XCatIntegrationTests", dependencies: ["XCatIntegrationCore"]),
        .testTarget(name: "XStationIntegrationTests", dependencies: ["XStationIntegrationCore"]),
        .testTarget(name: "XContestCoreTests", dependencies: ["XContestCore"], exclude: ["SourceFixtures"]),
        .testTarget(name: "XContestStoreTests", dependencies: ["XContestStore", "XContestCore", "CSQLitePrototype"]),
    ]
    )
} else {
    package = Package(
    name: "OM0RXXLog",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "XLogCore", targets: ["XLogCore"]),
        .library(name: "XContestCore", targets: ["XContestCore"]),
        .library(name: "XContestStore", targets: ["XContestStore"]),
        .executable(name: "om0rx-xlog", targets: ["XLogApp"]),
    ],
    targets: nativeTransferTargets + [
        .systemLibrary(name: "CSQLitePrototype", pkgConfig: sqlitePkgConfig, providers: [.apt(["libsqlite3-dev"])]),
        .target(
            name: "XLogCore",
            dependencies: ["CCurlBackup"],
            resources: [.process("Resources")],
            linkerSettings: [
                .linkedFramework("Network"),
                .linkedFramework("Security"),
                .linkedLibrary("sqlite3"),
                .linkedLibrary("z"),
            ]
        ),
        .target(name: "XContestCore"),
        .target(name: "XContestStore", dependencies: ["XContestCore", "CSQLitePrototype"]),
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
        .testTarget(name: "XContestCoreTests", dependencies: ["XContestCore"], exclude: ["SourceFixtures"]),
        .testTarget(name: "XContestStoreTests", dependencies: ["XContestStore", "XContestCore", "CSQLitePrototype"]),
    ]
    )
}
