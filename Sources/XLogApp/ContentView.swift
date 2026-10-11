import SwiftUI
import XLogCore

struct ContentView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow

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
        .confirmationDialog(
            "Review this QSO before logging",
            isPresented: $model.pendingLogConfirmation,
            titleVisibility: .visible
        ) {
            Button("Log anyway") { model.logQSO(force: true) }
            Button("Keep editing", role: .cancel) {}
        } message: {
            Text(model.validationIssues.map(\.message).joined(separator: "\n"))
        }
    }

    private var stationRail: some View {
        HStack(spacing: 24) {
            Label("OM0RX-xLog", systemImage: "book.pages.fill")
                .font(.title3.bold())
                .foregroundStyle(XLogTheme.teal)
            Rectangle().fill(XLogTheme.rule).frame(width: 1, height: 38)
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
            propagationRail
            StatusChip(
                title: "STATION",
                detail: model.stationSnapshot.map { "\($0.station.routeAlignment.uppercased()) · \($0.station.interlockState)" } ?? model.stationStatus,
                color: model.stationSnapshot?.station.available == true ? XLogTheme.teal : XLogTheme.secondary,
                symbol: "waveform.path.ecg"
            )
            Spacer()
            Button { openWindow(id: "world-map") } label: { Image(systemName: "map") }
                .font(.system(size: 16)).buttonStyle(.borderless).help("Open World Map in a separate window")
            Button { openWindow(id: "band-maps") } label: { Image(systemName: "slider.vertical.3") }
                .font(.system(size: 16)).buttonStyle(.borderless).help("Open Band Maps in a separate window")
            VStack(alignment: .trailing, spacing: 1) {
                Text("\(model.stats.qsoCount.formatted()) contacts").font(.system(size: 15, weight: .semibold))
                Text("LOCAL SQLITE · \(model.settings.automaticSync ? "AUTO SYNC" : "MANUAL SYNC")")
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(XLogTheme.secondary)
            }
            .font(.system(size: 16))
            Button { Task { await model.synchronize() } } label: {
                Image(systemName: model.isWorking ? "hourglass" : "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .help("Synchronize with Wavelog now")
            .disabled(model.isWorking)
        }
        .padding(.horizontal, 20)
        .frame(minHeight: 88)
        .background(XLogTheme.surface)
        .overlay(alignment: .bottom) { Rectangle().fill(XLogTheme.rule).frame(height: 1) }
    }

    private var propagationRail: some View {
        let propagation = model.stationSnapshot?.propagation
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Image(systemName: "sun.max.fill")
                    .font(.system(size: 15)).foregroundStyle(propagation == nil ? XLogTheme.secondary : XLogTheme.amber)
                Text("HF PROP")
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(XLogTheme.secondary)
                if let propagation {
                    Text("SFI \(propagation.solarFlux.map(String.init) ?? "—")  A \(propagation.aIndex.map(String.init) ?? "—")  K \(propagation.kIndex.map(String.init) ?? "—")  X \(propagation.xRay)")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(XLogTheme.text)
                        .monospacedDigit()
                }
            }
            if let propagation, !propagation.bands.isEmpty {
                HStack(spacing: 4) {
                    ForEach(propagation.bands, id: \.name) { band in propagationBand(band) }
                }
                .fixedSize(horizontal: true, vertical: false)
            } else if propagation == nil {
                Text("Waiting for xCat")
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(XLogTheme.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .help(propagationHelp)
    }

    private func propagationBand(_ band: XCatStationSnapshot.Propagation.Band) -> some View {
        HStack(spacing: 3) {
            Text(band.name).foregroundStyle(XLogTheme.secondary)
            Text("D").foregroundStyle(XLogTheme.secondary.opacity(0.8))
            Text(band.day.uppercased()).foregroundStyle(propagationColor(band.day))
            Text("N").foregroundStyle(XLogTheme.secondary.opacity(0.8))
            Text(band.night.uppercased()).foregroundStyle(propagationColor(band.night))
        }
        .font(.system(size: 11, weight: .bold, design: .rounded))
        .padding(.horizontal, 7).padding(.vertical, 5)
        .background(XLogTheme.raised)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(XLogTheme.rule))
        .accessibilityLabel("\(band.name), day \(band.day), night \(band.night)")
    }

    private func propagationColor(_ value: String) -> Color {
        switch value.lowercased() {
        case "excellent", "good": return XLogTheme.teal
        case "fair": return XLogTheme.amber
        case "poor": return XLogTheme.danger
        default: return XLogTheme.pink
        }
    }

    private var propagationHelp: String {
        guard let propagation = model.stationSnapshot?.propagation else { return model.stationStatus }
        let ratings = propagation.bands.map { "\($0.name): day \($0.day), night \($0.night)" }.joined(separator: " · ")
        return ratings.isEmpty ? propagation.status : ratings
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
            Section("Station") {
                stationControls
                    .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 10, trailing: 8))
                    .listRowBackground(Color.clear)
            }
        }
        .scrollContentBackground(.hidden)
        .background(XLogTheme.surface)
        .listStyle(.sidebar)
        .navigationSplitViewColumnWidth(min: 200, ideal: 225, max: 265)
        .safeAreaInset(edge: .bottom) {
            VStack(alignment: .leading, spacing: 3) {
                Text(model.settings.stationCall.isEmpty ? "STATION NOT SET" : model.settings.stationCall)
                    .font(.caption.weight(.bold)).foregroundStyle(XLogTheme.teal)
                Text(model.settings.gridSquare.isEmpty ? "Configure station profile" : model.settings.gridSquare)
                    .font(.caption2).foregroundStyle(XLogTheme.secondary)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var stationControls: some View {
        let station = model.stationSnapshot?.station
        return VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 5) {
                Text("STATION CONTROL")
                    .font(.caption2.weight(.bold)).foregroundStyle(XLogTheme.secondary)
                Spacer()
                Circle().fill(station == nil ? XLogTheme.secondary : XLogTheme.teal).frame(width: 6, height: 6)
            }

            VStack(spacing: 5) {
                let amplifierAction = station?.kpaOperate == true ? "standby" : "operate"
                stationActionTile(
                    station?.kpaOperate == true ? "STANDBY" : "OPERATE",
                    action: amplifierAction,
                    symbol: station?.kpaOperate == true ? "pause.fill" : "bolt.fill",
                    tint: XLogTheme.orange,
                    enabled: station?.allowedActions.contains(amplifierAction) == true
                )
                stationActionTile(
                    "TUNE",
                    action: "tune",
                    symbol: "wave.3.right",
                    tint: XLogTheme.amber,
                    enabled: station?.allowedActions.contains("tune") == true
                )
                stationActionTile(
                    "CANCEL",
                    action: "cancel",
                    symbol: "xmark.circle.fill",
                    tint: XLogTheme.danger,
                    enabled: station?.allowedActions.contains("cancel") == true
                )
            }

            stationMetric(
                "TX POWER",
                station?.txPowerWatts.map { String(format: "%.0f W", $0) } ?? "—",
                tint: XLogTheme.orange,
                background: Color(red: 0.25, green: 0.12, blue: 0.055)
            )
            stationMetric(
                "SWR",
                station?.swr.map { String(format: "%.2f %@", $0, station?.swrIsLive == true ? "LIVE" : "LAST") } ?? "—",
                tint: XLogTheme.teal,
                background: Color(red: 0.045, green: 0.20, blue: 0.18)
            )
            stationMetric(
                "RF DRIVE",
                station?.rfDriveWatts.map { "\($0) W" } ?? "—",
                tint: XLogTheme.pink,
                background: Color(red: 0.16, green: 0.10, blue: 0.28)
            )

            stationDevice(
                station?.kpaDetailPrimary ?? "KPA500 unavailable",
                detail: station?.kpaDetailSecondary ?? model.stationStatus,
                color: station?.kpaOperate == true ? XLogTheme.teal : XLogTheme.amber
            )
            stationDevice(
                station?.katDetailPrimary ?? "KAT500 unavailable",
                detail: station?.katDetailSecondary ?? model.stationStatus,
                color: XLogTheme.cyan
            )
        }
    }

    private func stationActionTile(
        _ title: String,
        action: String,
        symbol: String,
        tint: Color,
        enabled: Bool
    ) -> some View {
        Button { model.performStationAction(action) } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .bold))
                    .frame(width: 18)
                Text(title)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                Spacer()
                Text(enabled ? "READY" : "BLOCKED")
                    .font(.system(size: 8, weight: .bold, design: .rounded))
            }
            .foregroundStyle(enabled ? tint : XLogTheme.secondary)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(enabled ? tint.opacity(0.13) : XLogTheme.raised.opacity(0.65))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke((enabled ? tint : XLogTheme.rule).opacity(0.42)))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .help(enabled ? "Send station \(title.lowercased()) through OM0RX-xCat" : "Blocked by the current station route or safety state")
    }

    private func stationMetric(_ title: String, _ value: String, tint: Color, background: Color) -> some View {
        VStack(spacing: 2) {
            Text(title).font(.system(size: 9, weight: .bold, design: .rounded))
            Text(value).font(.system(size: 16, weight: .bold, design: .rounded)).monospacedDigit()
        }
        .foregroundStyle(tint)
        .frame(maxWidth: .infinity, minHeight: 45)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(tint.opacity(0.16)))
    }

    private func stationDevice(_ title: String, detail: String, color: Color) -> some View {
        let values = (title + " | " + detail)
            .components(separatedBy: "|")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return VStack(alignment: .leading, spacing: 6) {
            if let heading = values.first {
                Text(heading)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(color)
            }
            LazyVGrid(
                columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)],
                alignment: .leading,
                spacing: 5
            ) {
                ForEach(Array(values.dropFirst().enumerated()), id: \.offset) { _, value in
                    Text(value)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(XLogTheme.text)
                        .lineLimit(2)
                        .minimumScaleFactor(0.86)
                }
            }
        }
        .padding(7)
        .background(XLogTheme.raised)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(color.opacity(0.25)))
        .help("\(title)\n\(detail)")
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
