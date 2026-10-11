import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            stationRail
            NavigationSplitView {
                sidebar
            } detail: {
                destination
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(XLogTheme.background)
            }
            .navigationSplitViewStyle(.balanced)
        }
        .background(XLogTheme.background)
        .foregroundStyle(XLogTheme.text)
        .overlay(alignment: .bottom) {
            if let banner = model.banner {
                HStack {
                    Image(systemName: banner.kind.symbol).foregroundStyle(banner.kind.color)
                    Text(banner.message)
                    Spacer()
                    Button { model.banner = nil } label: { Image(systemName: "xmark") }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Dismiss notification")
                }
                .padding(.horizontal, 14).frame(height: 38)
                .background(XLogTheme.raised)
                .overlay(alignment: .top) { Rectangle().fill(XLogTheme.rule).frame(height: 1) }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    private var stationRail: some View {
        HStack(spacing: 20) {
            Label("OM0RX-xLog", systemImage: "book.pages.fill")
                .font(.headline)
                .foregroundStyle(XLogTheme.teal)
            Rectangle().fill(XLogTheme.rule).frame(width: 1, height: 24)
            StatusChip(
                title: "RADIO",
                detail: model.radioSnapshot.map { "\($0.mode) · \(String(format: "%.6f", Double($0.frequencyHz) / 1_000_000)) MHz" } ?? model.radioStatus,
                color: model.radioSnapshot == nil ? XLogTheme.danger : XLogTheme.cyan,
                symbol: "antenna.radiowaves.left.and.right"
            )
            StatusChip(
                title: "CLUSTER",
                detail: model.clusterFeedUpdatedAt == nil ? "xCluster offline" : "\(model.clusterConnectedCount) live · \(model.clusterSpots.count) spots",
                color: model.clusterConnectedCount > 0 ? XLogTheme.teal : XLogTheme.secondary,
                symbol: "dot.radiowaves.left.and.right"
            )
            StatusChip(
                title: "WAVELOG",
                detail: model.syncStatus,
                color: model.syncStatus == "Up to date" ? XLogTheme.teal : XLogTheme.amber,
                symbol: "arrow.triangle.2.circlepath"
            )
            StatusChip(
                title: "LOOKUP",
                detail: model.lookupStatus,
                color: model.lookupStatus == "QRZ matched" ? XLogTheme.teal : XLogTheme.secondary,
                symbol: "person.text.rectangle"
            )
            Spacer()
            VStack(alignment: .trailing, spacing: 1) {
                Text("\(model.stats.qsoCount.formatted()) contacts").font(.caption.weight(.semibold))
                Text("LOCAL SQLITE · \(model.settings.automaticSync ? "AUTO SYNC" : "MANUAL SYNC")")
                    .font(.caption2).foregroundStyle(XLogTheme.secondary)
            }
            Button { Task { await model.synchronize() } } label: {
                Image(systemName: model.isWorking ? "hourglass" : "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .help("Synchronize with Wavelog now")
            .disabled(model.isWorking)
        }
        .padding(.horizontal, 16)
        .frame(height: 48)
        .background(XLogTheme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(XLogTheme.rule).frame(height: 1) }
    }

    private var sidebar: some View {
        List(selection: $model.destination) {
            Section("Station log") {
                ForEach([AppModel.Destination.desk, .log, .logbook, .map, .bandMaps, .insights]) { item in
                    Label(item.rawValue, systemImage: item.icon).tag(item)
                }
            }
            Section("Services") {
                ForEach([AppModel.Destination.sync, .settings]) { item in
                    Label(item.rawValue, systemImage: item.icon).tag(item)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(XLogTheme.surface)
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 175, ideal: 196, max: 230)
        .safeAreaInset(edge: .bottom) {
            VStack(alignment: .leading, spacing: 5) {
                Text(model.settings.stationCall.isEmpty ? "STATION NOT SET" : model.settings.stationCall)
                    .font(.caption.weight(.bold)).foregroundStyle(XLogTheme.teal)
                Text(model.settings.gridSquare.isEmpty ? "Configure station profile" : model.settings.gridSquare)
                    .font(.caption2).foregroundStyle(XLogTheme.secondary)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private var destination: some View {
        switch model.destination {
        case .desk: OperatorDeskView()
        case .log: LogQSOView()
        case .logbook: LogbookView()
        case .insights: InsightsView()
        case .map: WorldMapView()
        case .bandMaps: BandMapsView()
        case .sync: SyncView()
        case .settings: SettingsView()
        }
    }
}
