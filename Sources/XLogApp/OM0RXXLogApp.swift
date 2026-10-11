import AppKit
import SwiftUI

extension Notification.Name {
    static let xLogOpenURL = Notification.Name("OM0RXXLogOpenURL")
}

@MainActor
final class XLogAppDelegate: NSObject, NSApplicationDelegate {
    private var pendingURLs: [URL] = []

    func application(_ application: NSApplication, open urls: [URL]) {
        pendingURLs.append(contentsOf: urls)
        for url in urls {
            NotificationCenter.default.post(name: .xLogOpenURL, object: url)
        }
    }

    func consumePendingURLs() -> [URL] {
        defer { pendingURLs.removeAll() }
        return pendingURLs
    }
}

@main
struct OM0RXXLogApp: App {
    @NSApplicationDelegateAdaptor(XLogAppDelegate.self) private var appDelegate
    @StateObject private var model = AppModel()

    var body: some Scene {
        Window("OM0RX-xLog", id: "main") {
            ContentView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .frame(minWidth: 860, minHeight: 620)
                .onOpenURL { model.handleOpenURL($0) }
                .onReceive(NotificationCenter.default.publisher(for: .xLogOpenURL)) { notification in
                    if let url = notification.object as? URL { model.handleOpenURL(url) }
                }
                .task {
                    for url in appDelegate.consumePendingURLs() { model.handleOpenURL(url) }
                }
        }
        .defaultSize(width: 1_440, height: 860)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("Log QSO") { model.destination = .log }
                    .keyboardShortcut("l", modifiers: [.command])
            }
            CommandMenu("Logbook") {
                Button("Read Radio") { model.readRadio() }.keyboardShortcut("r", modifiers: [.command, .shift])
                Button("Synchronize Now") { Task { await model.synchronize() } }.keyboardShortcut("s", modifiers: [.command, .shift])
                Divider()
                Button("Import ADIF…") { model.importADIF() }
                Button("Export ADIF…") { model.exportADIF() }
            }
        }

        Window("OM0RX-xLog · World Map", id: "world-map") {
            WorldMapView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .frame(minWidth: 760, minHeight: 520)
        }
        .defaultSize(width: 1_100, height: 720)

        Window("OM0RX-xLog · Band Maps", id: "band-maps") {
            BandMapsView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .frame(minWidth: 720, minHeight: 560)
        }
        .defaultSize(width: 1_180, height: 760)
    }
}
