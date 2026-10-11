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
                    Text("SFI \(propagation.solarFlux.map(String.init) ?? "—") · A \(propagation.aIndex.map(String.init) ?? "—") · K \(propagation.kIndex.map(String.init) ?? "—") · \(propagation.xRay)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(XLogTheme.text)
                        .monospacedDigit()
                        .lineLimit(1)
                }
                if let weather = model.localWeather {
                    Rectangle().fill(XLogTheme.rule).frame(width: 1, height: 15).padding(.horizontal, 2)
                    Image(systemName: weather.condition.symbolName).foregroundStyle(XLogTheme.cyan)
                    Text("\(weather.temperatureC, specifier: "%.0f")°")
                        .font(.system(size: 13, weight: .semibold)).monospacedDigit()
                }
            }
            .fixedSize(horizontal: true, vertical: false)
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
        .fixedSize(horizontal: true, vertical: false)
        .layoutPriority(2)
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
        let propagationText: String
        if let propagation = model.stationSnapshot?.propagation {
            let ratings = propagation.bands.map { "\($0.name): day \($0.day), night \($0.night)" }.joined(separator: " · ")
            propagationText = ratings.isEmpty ? propagation.status : ratings
        } else {
            propagationText = model.stationStatus
        }
        guard let weather = model.localWeather else { return propagationText }
        return "\(propagationText)\n\(weather.condition.description), \(weather.temperatureC.formatted(.number.precision(.fractionLength(1))))°C, wind \(weather.windSpeedKMH.formatted(.number.precision(.fractionLength(0)))) km/h. \(model.weatherStatus)"
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            sidebarSection("Station log", items: [.desk, .log, .logbook, .map, .bandMaps, .insights])
            sidebarRule
            sidebarSection("Services", items: [.sync, .settings])
            sidebarRule

            Text("STATION")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(XLogTheme.secondary)
                .padding(.horizontal, 14)
                .padding(.top, 9)
                .padding(.bottom, 6)

            focusedStationControls
                .padding(.horizontal, 8)

            Spacer(minLength: 6)

            VStack(alignment: .leading, spacing: 3) {
                Text(model.settings.stationCall.isEmpty ? "STATION NOT SET" : model.settings.stationCall)
                    .font(.caption.weight(.bold)).foregroundStyle(XLogTheme.teal)
                Text(model.settings.gridSquare.isEmpty ? "Configure station profile" : model.settings.gridSquare)
                    .font(.caption2).foregroundStyle(XLogTheme.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(XLogTheme.background.opacity(0.35))
            .overlay(alignment: .top) { Rectangle().fill(XLogTheme.rule).frame(height: 1) }
        }
        .background(XLogTheme.surface)
        .navigationSplitViewColumnWidth(min: 200, ideal: 225, max: 265)
        .clipped()
    }

    private func sidebarSection(_ title: String, items: [AppModel.Destination]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(XLogTheme.secondary)
                .padding(.horizontal, 14)
                .padding(.bottom, 4)

            ForEach(items) { item in
                Button {
                    model.destination = item
                } label: {
                    Label(item.rawValue, systemImage: item.icon)
                        .font(.system(size: 13, weight: model.destination == item ? .semibold : .regular))
                        .foregroundStyle(model.destination == item ? XLogTheme.text : XLogTheme.secondary)
                        .frame(maxWidth: .infinity, minHeight: 31, alignment: .leading)
                        .padding(.horizontal, 10)
                        .background(model.destination == item ? XLogTheme.cyan.opacity(0.16) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay {
                            if model.destination == item {
                                RoundedRectangle(cornerRadius: 6).stroke(XLogTheme.cyan.opacity(0.28))
                            }
                        }
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 6)
            }
        }
        .padding(.top, 10)
        .padding(.bottom, 8)
    }

    private var sidebarRule: some View {
        Rectangle().fill(XLogTheme.rule).frame(height: 1)
    }

    private var focusedStationControls: some View {
        let station = model.stationSnapshot?.station
        let amplifierAction = station?.kpaOperate == true ? "standby" : "operate"
        let kpaPrimary = station?.kpaDetailPrimary ?? ""
        let kpaSecondary = station?.kpaDetailSecondary ?? ""
        let katPrimary = station?.katDetailPrimary ?? ""
        let output = stationDetailValue("OUT", in: kpaPrimary) ?? "—"
        let kpaSWR = stationDetailValue("SWR", in: kpaPrimary)
            ?? station?.swr.map { String(format: "%.2f", $0) }
            ?? "—"
        let temperature = stationDetailValue("TEMP", in: kpaSecondary) ?? "—"
        let kpaBand = stationBand(in: kpaPrimary) ?? station?.band ?? "—"
        let katBand = stationBand(in: katPrimary) ?? station?.band ?? "—"
        let antenna = stationAntenna(in: katPrimary) ?? "—"

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) {
                Text(station?.kpaOperate == true ? "KPA500 · OPERATE" : "KPA500 · STANDBY")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(station == nil ? XLogTheme.secondary : XLogTheme.amber)
                Spacer()
                Circle().fill(station == nil ? XLogTheme.secondary : XLogTheme.teal).frame(width: 7, height: 7)
            }

            stationActionTile(
                station?.kpaOperate == true ? "SWITCH TO STANDBY" : "SWITCH TO OPERATE",
                action: amplifierAction,
                symbol: station?.kpaOperate == true ? "pause.fill" : "bolt.fill",
                tint: station?.kpaOperate == true ? XLogTheme.teal : XLogTheme.orange,
                enabled: station?.allowedActions.contains(amplifierAction) == true
            )

            HStack(spacing: 6) {
                sidebarStationValue("OUTPUT", output, tint: XLogTheme.orange)
                sidebarStationValue("SWR", kpaSWR, tint: XLogTheme.teal)
            }
            HStack(spacing: 6) {
                sidebarStationValue("KPA BAND", kpaBand, tint: XLogTheme.amber)
                sidebarStationValue("KPA TEMP", temperature, tint: XLogTheme.amber)
            }
            HStack(spacing: 6) {
                sidebarStationValue("KAT BAND", katBand, tint: XLogTheme.cyan)
                sidebarStationValue("ANTENNA", antenna, tint: XLogTheme.cyan)
            }
        }
        .help("\(kpaPrimary)\n\(kpaSecondary)\n\(katPrimary)")
    }

    private func sidebarStationValue(_ title: String, _ value: String, tint: Color) -> some View {
        VStack(spacing: 1) {
            Text(title).font(.system(size: 9.5, weight: .bold, design: .rounded))
            Text(value).font(.system(size: 16, weight: .bold, design: .rounded)).monospacedDigit()
        }
        .foregroundStyle(tint)
        .frame(maxWidth: .infinity, minHeight: 48)
        .background(XLogTheme.raised)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(tint.opacity(0.28)))
    }

    private func stationDetailValue(_ prefix: String, in detail: String) -> String? {
        let wanted = prefix.uppercased()
        for component in stationComponents(detail) {
            let upper = component.uppercased()
            guard upper.hasPrefix(wanted + " ") else { continue }
            let index = component.index(component.startIndex, offsetBy: prefix.count)
            return component[index...].trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return nil
    }

    private func stationBand(in detail: String) -> String? {
        stationComponents(detail).first { component in
            let normalized = component.lowercased()
            guard normalized.hasSuffix("m") else { return false }
            return Double(normalized.dropLast()) != nil
        }
    }

    private func stationAntenna(in detail: String) -> String? {
        stationComponents(detail).first { component in
            component.uppercased().hasPrefix("ANT")
        }
    }

    private func stationComponents(_ detail: String) -> [String] {
        detail.components(separatedBy: "|")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
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
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(enabled ? tint.opacity(0.13) : XLogTheme.raised.opacity(0.65))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke((enabled ? tint : XLogTheme.rule).opacity(0.42)))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .help(enabled ? "Send station \(title.lowercased()) through OM0RX-xCat" : "Blocked by the current station route or safety state")
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
