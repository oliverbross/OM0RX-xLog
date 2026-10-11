import SwiftUI
import XLogCore

struct LogbookView: View {
    @EnvironmentObject private var model: AppModel
    @State private var selection: Set<UUID> = []
    @State private var deleteCandidate: QSO?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Logbook").font(.title2.bold())
                    Text("The authoritative local record").font(.caption).foregroundStyle(XLogTheme.secondary)
                }
                Spacer()
                TextField("Callsign, name, country or note", text: $model.search)
                    .textFieldStyle(DarkTextFieldStyle())
                    .frame(width: 300)
                    .onSubmit { model.searchChanged() }
                Button { model.searchChanged() } label: { Image(systemName: "magnifyingglass") }
                    .accessibilityLabel("Search logbook")
                Button("Edit") {
                    if let id = selection.first, let qso = model.qsos.first(where: { $0.id == id }) { model.edit(qso) }
                }.disabled(selection.count != 1)
                Button("Delete", role: .destructive) {
                    if let id = selection.first { deleteCandidate = model.qsos.first(where: { $0.id == id }) }
                }.disabled(selection.count != 1)
                Button("Undo delete") { model.undoLastDelete() }.disabled(!model.canUndoDelete)
                Button("Import ADIF…") { model.importADIF() }
                Button("Export ADIF…") { model.exportADIF() }
            }
            .padding(16)
            .background(XLogTheme.surface)
            .overlay(alignment: .bottom) { Rectangle().fill(XLogTheme.rule).frame(height: 1) }

            if model.qsos.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "books.vertical").font(.system(size: 38)).foregroundStyle(XLogTheme.secondary)
                    Text("Your local logbook is ready").font(.title3.bold())
                    Text("Log a QSO or import an ADIF file. Contacts remain available when Wavelog is offline.")
                        .foregroundStyle(XLogTheme.secondary)
                    Button("Log the first QSO") { model.destination = .log }.buttonStyle(PrimaryActionStyle())
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                Table(model.qsos, selection: $selection) {
                    TableColumn("UTC") { qso in
                        Text(qso.start.formatted(date: .numeric, time: .shortened)).monospacedDigit()
                    }.width(min: 130, ideal: 145)
                    TableColumn("Callsign") { qso in
                        HStack(spacing: 5) {
                            Circle().fill(qso.isDirty ? XLogTheme.amber : XLogTheme.teal).frame(width: 6, height: 6)
                            Text(qso.call).fontWeight(.bold).foregroundStyle(XLogTheme.teal)
                        }
                        .help(qso.isDirty ? "Pending Wavelog sync" : "Synced with Wavelog")
                    }.width(min: 90, ideal: 115)
                    TableColumn("Band / Mode") { qso in
                        Text("\(qso.band) · \(qso.submode.isEmpty ? qso.mode : qso.submode)")
                            .fontWeight(.semibold).foregroundStyle(XLogTheme.cyan)
                    }.width(92)
                    TableColumn("Frequency") { qso in Text(qso.displayFrequency).monospacedDigit().foregroundStyle(XLogTheme.cyan) }.width(88)
                    TableColumn("RST") { qso in Text("\(qso.rstSent) / \(qso.rstReceived)").monospacedDigit() }.width(75)
                    TableColumn("Country") { qso in Text(qso.country.isEmpty ? "—" : qso.country) }.width(min: 110, ideal: 150)
                    TableColumn("QSL") { qso in
                        ConfirmationStatus(sent: qso.qslSent, received: qso.qslReceived, service: "QSL")
                    }.width(66)
                    TableColumn("LoTW") { qso in
                        ConfirmationStatus(sent: qso.lotwSent, received: qso.lotwReceived, service: "LoTW")
                    }.width(66)
                    TableColumn("Club Log") { qso in
                        ConfirmationStatus(
                            sent: qso.extraFields["CLUBLOG_QSO_UPLOAD_STATUS"] ?? "",
                            received: "",
                            service: "Club Log",
                            supportsReceived: false
                        )
                    }.width(72)
                    TableColumn("Comment") { qso in Text(qso.comment).lineLimit(1) }.width(min: 140, ideal: 240)
                }
                .scrollContentBackground(.hidden)
                .background(XLogTheme.background)
                .contextMenu(forSelectionType: UUID.self) { ids in
                    if let id = ids.first, let qso = model.qsos.first(where: { $0.id == id }) {
                        Button("Edit QSO") { model.edit(qso) }
                        Button("Delete QSO", role: .destructive) { deleteCandidate = qso }
                    }
                } primaryAction: { ids in
                    if let id = ids.first, let qso = model.qsos.first(where: { $0.id == id }) { model.edit(qso) }
                }
            }
        }
        .confirmationDialog(
            "Delete \(deleteCandidate?.call ?? "this QSO")?",
            isPresented: Binding(get: { deleteCandidate != nil }, set: { if !$0 { deleteCandidate = nil } }),
            titleVisibility: .visible
        ) {
            Button("Delete QSO", role: .destructive) {
                if let qso = deleteCandidate { model.delete(qso) }
                deleteCandidate = nil
            }
            Button("Cancel", role: .cancel) { deleteCandidate = nil }
        } message: {
            Text("The contact will be hidden locally and deleted from Wavelog at the next sync. You can undo before syncing.")
        }
    }
}

private struct ConfirmationStatus: View {
    let sent: String
    let received: String
    let service: String
    var supportsReceived = true

    var body: some View {
        HStack(spacing: 4) {
            statusGlyph("arrowtriangle.up.fill", value: sent, label: "sent")
            statusGlyph("arrowtriangle.down.fill", value: received, label: "received", available: supportsReceived)
        }
        .font(.system(size: 11, weight: .bold))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilitySummary)
        .help(accessibilitySummary)
    }

    private func statusGlyph(_ symbol: String, value: String, label: String, available: Bool = true) -> some View {
        Image(systemName: symbol)
            .foregroundStyle(available ? statusColor(value) : XLogTheme.secondary.opacity(0.24))
            .accessibilityHidden(true)
    }

    private func statusColor(_ value: String) -> Color {
        switch value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
        case "Y", "V": return XLogTheme.teal
        case "N": return XLogTheme.danger
        case "R", "Q", "I", "M": return XLogTheme.amber
        default: return XLogTheme.secondary.opacity(0.45)
        }
    }

    private var accessibilitySummary: String {
        let sentText = sent.isEmpty ? "not recorded" : sent
        guard supportsReceived else { return "\(service) upload \(sentText)" }
        let receivedText = received.isEmpty ? "not recorded" : received
        return "\(service) sent \(sentText), received \(receivedText)"
    }
}

struct InsightsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Station intelligence").font(.title2.bold())
                        Text("Local award estimates, operating patterns and live station conditions.")
                            .foregroundStyle(XLogTheme.secondary)
                    }
                    Spacer()
                    Text("LOCAL LOG · NOT AN AWARD APPLICATION")
                        .font(.caption2.weight(.semibold)).foregroundStyle(XLogTheme.secondary)
                }

                Panel(title: "Award progress", symbol: "medal.fill") {
                    HStack(spacing: 0) {
                        AwardProgressCell(code: "DXCC", title: "Entities", worked: model.awardProgress.dxccWorked, confirmed: model.awardProgress.dxccConfirmed, target: 100, color: XLogTheme.teal)
                        insightDivider
                        AwardProgressCell(code: "WAZ", title: "CQ zones", worked: model.awardProgress.cqZonesWorked, confirmed: model.awardProgress.cqZonesConfirmed, target: 40, color: XLogTheme.cyan)
                        insightDivider
                        AwardProgressCell(code: "WAS", title: "US states", worked: model.awardProgress.statesWorked, confirmed: model.awardProgress.statesConfirmed, target: 50, color: XLogTheme.amber)
                        insightDivider
                        AwardProgressCell(code: "GRID", title: "Four-character fields", worked: model.awardProgress.gridsWorked, confirmed: model.awardProgress.gridsConfirmed, target: nil, color: XLogTheme.pink)
                    }
                }

                HStack(alignment: .top, spacing: 12) {
                    Panel(title: "Operating mix", symbol: "chart.bar.fill") {
                        if model.awardProgress.qsoCount == 0 {
                            EmptyInsight(text: "Mode and band summaries appear after the first contact.")
                        } else {
                            VStack(alignment: .leading, spacing: 13) {
                                MixSection(title: "MODE", values: model.awardProgress.modeCounts, colors: [XLogTheme.cyan, XLogTheme.amber, XLogTheme.pink])
                                MixSection(title: "TOP BANDS", values: top(model.awardProgress.bandCounts, limit: 7), colors: [XLogTheme.teal])
                                MixSection(title: "CONTINENTS", values: top(model.awardProgress.continentCounts, limit: 7), colors: [XLogTheme.cyan])
                            }
                        }
                    }

                    Panel(title: "Achievements", symbol: "sparkles") {
                        VStack(spacing: 0) {
                            ForEach(model.awardProgress.achievements) { achievement in
                                AchievementRow(achievement: achievement)
                                if achievement.id != model.awardProgress.achievements.last?.id {
                                    Rectangle().fill(XLogTheme.rule).frame(height: 1)
                                }
                            }
                        }
                    }
                    .frame(width: 360)
                }

                ConditionsPanel()
            }
            .padding(20)
        }
    }

    private var insightDivider: some View {
        Rectangle().fill(XLogTheme.rule).frame(width: 1, height: 92).padding(.horizontal, 6)
    }

    private func top(_ values: [String: Int], limit: Int) -> [String: Int] {
        Dictionary(uniqueKeysWithValues: values.sorted { $0.value > $1.value }.prefix(limit).map { ($0.key, $0.value) })
    }
}

private struct AwardProgressCell: View {
    let code: String
    let title: String
    let worked: Int
    let confirmed: Int
    let target: Int?
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(code).font(.caption.weight(.bold)).foregroundStyle(color)
                Spacer()
                if let target { Text("/ \(target)").font(.caption.monospacedDigit()).foregroundStyle(XLogTheme.secondary) }
            }
            Text(worked.formatted())
                .font(.system(size: 27, weight: .bold, design: .rounded)).monospacedDigit()
            Text("\(title) · \(confirmed.formatted()) confirmed")
                .font(.caption).foregroundStyle(XLogTheme.secondary)
            if let target {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(XLogTheme.raised)
                        Rectangle().fill(color).frame(width: max(3, proxy.size.width * min(1, Double(worked) / Double(max(1, target)))))
                    }
                }
                .frame(height: 5)
                .clipShape(Capsule())
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8)
        .accessibilityElement(children: .combine)
    }
}

private struct MixSection: View {
    let title: String
    let values: [String: Int]
    let colors: [Color]

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.caption2.weight(.bold)).foregroundStyle(XLogTheme.secondary)
            let maximum = values.values.max() ?? 1
            ForEach(Array(values.sorted { lhs, rhs in
                lhs.value == rhs.value ? lhs.key < rhs.key : lhs.value > rhs.value
            }.enumerated()), id: \.element.key) { index, item in
                HStack(spacing: 8) {
                    Text(item.key).font(.caption.weight(.semibold)).frame(width: 68, alignment: .leading).lineLimit(1)
                    GeometryReader { proxy in
                        Rectangle()
                            .fill(colors[index % max(1, colors.count)])
                            .frame(width: max(3, proxy.size.width * Double(item.value) / Double(maximum)))
                    }
                    .frame(height: 5)
                    .background(XLogTheme.raised)
                    .clipShape(Capsule())
                    Text(item.value.formatted()).font(.caption.monospacedDigit()).frame(width: 48, alignment: .trailing)
                }
            }
        }
    }
}

private struct AchievementRow: View {
    let achievement: AwardAchievement

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: achievement.symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(achievement.completed ? XLogTheme.teal : XLogTheme.cyan)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(achievement.code).font(.body.weight(.bold))
                    Text(achievement.title).font(.caption).foregroundStyle(XLogTheme.secondary)
                    Spacer()
                    Text("\(achievement.current.formatted()) / \(achievement.target.formatted())")
                        .font(.caption.monospacedDigit()).foregroundStyle(XLogTheme.secondary)
                }
                GeometryReader { proxy in
                    Rectangle().fill(achievement.completed ? XLogTheme.teal : XLogTheme.cyan)
                        .frame(width: max(3, proxy.size.width * achievement.fraction))
                }
                .frame(height: 4).background(XLogTheme.raised).clipShape(Capsule())
            }
        }
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
    }
}

private struct ConditionsPanel: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Panel(title: "Propagation & station weather", symbol: "sun.max.fill") {
            HStack(alignment: .top, spacing: 22) {
                propagation
                Rectangle().fill(XLogTheme.rule).frame(width: 1, height: 104)
                weather
            }
        }
    }

    private var propagation: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("HF PROPAGATION").font(.caption2.weight(.bold)).foregroundStyle(XLogTheme.secondary)
            if let value = model.stationSnapshot?.propagation {
                HStack(spacing: 18) {
                    ConditionReading(label: "SFI", value: value.solarFlux.map(String.init) ?? "—", color: XLogTheme.amber)
                    ConditionReading(label: "A", value: value.aIndex.map(String.init) ?? "—", color: XLogTheme.cyan)
                    ConditionReading(label: "K", value: value.kIndex.map(String.init) ?? "—", color: XLogTheme.teal)
                    ConditionReading(label: "X-RAY", value: value.xRay, color: XLogTheme.pink)
                }
                HStack(spacing: 6) {
                    ForEach(value.bands, id: \.name) { band in
                        VStack(spacing: 2) {
                            Text(band.name).font(.caption2.weight(.bold)).foregroundStyle(XLogTheme.secondary)
                            Text("D \(band.day.uppercased()) · N \(band.night.uppercased())")
                                .font(.caption2.weight(.semibold)).foregroundStyle(XLogTheme.text)
                        }
                        .padding(.horizontal, 7).padding(.vertical, 5)
                        .background(XLogTheme.raised).clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                }
            } else {
                EmptyInsight(text: "Waiting for propagation telemetry from xCat.")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var weather: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("LOCAL WEATHER · \(model.settings.gridSquare.isEmpty ? "GRID REQUIRED" : model.settings.gridSquare.uppercased())")
                .font(.caption2.weight(.bold)).foregroundStyle(XLogTheme.secondary)
            if let weather = model.localWeather {
                HStack(spacing: 12) {
                    Image(systemName: weather.condition.symbolName).font(.system(size: 27)).foregroundStyle(XLogTheme.cyan)
                    Text("\(weather.temperatureC, specifier: "%.1f")°C")
                        .font(.system(size: 25, weight: .bold, design: .rounded)).monospacedDigit()
                    VStack(alignment: .leading, spacing: 2) {
                        Text(weather.condition.description).fontWeight(.semibold)
                        Text("Feels \(weather.apparentTemperatureC, specifier: "%.1f")° · Wind \(weather.windSpeedKMH, specifier: "%.0f") km/h @ \(weather.windDirectionDegrees, specifier: "%.0f")°")
                            .font(.caption).foregroundStyle(XLogTheme.secondary)
                    }
                }
                Text("Pressure \(weather.pressureHPa, specifier: "%.0f") hPa · Cloud \(weather.cloudCoverPercent, specifier: "%.0f")% · Rain \(weather.precipitationMM, specifier: "%.1f") mm · \(model.weatherStatus)")
                    .font(.caption).foregroundStyle(XLogTheme.secondary)
            } else {
                EmptyInsight(text: model.weatherStatus)
                Button("Refresh weather") { Task { await model.refreshWeather() } }.controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ConditionReading: View {
    let label: String
    let value: String
    let color: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2.weight(.bold)).foregroundStyle(XLogTheme.secondary)
            Text(value).font(.system(size: 19, weight: .bold, design: .rounded)).foregroundStyle(color).monospacedDigit()
        }
    }
}

private struct EmptyInsight: View {
    let text: String
    var body: some View { Text(text).font(.callout).foregroundStyle(XLogTheme.secondary) }
}

struct SyncView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Synchronization").font(.title2.bold())
                Panel(title: "Wavelog", symbol: "arrow.triangle.2.circlepath") {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.syncStatus).font(.headline)
                            Text(model.settings.wavelogURL).font(.caption).foregroundStyle(XLogTheme.secondary)
                        }
                        Spacer()
                        Button("Synchronize now") { Task { await model.synchronize() } }
                            .buttonStyle(PrimaryActionStyle()).disabled(model.isWorking)
                    }
                    if let report = model.lastSyncReport {
                        HStack(spacing: 22) {
                            Label("\(report.pushed) pushed", systemImage: "arrow.up")
                            Label("\(report.pulled) read", systemImage: "arrow.down")
                            Label("\(report.deleted) deleted", systemImage: "trash")
                            if report.conflicts > 0 { Label("\(report.conflicts) conflicts", systemImage: "exclamationmark.triangle.fill").foregroundStyle(XLogTheme.amber) }
                            if report.failed > 0 { Label("\(report.failed) queued for retry", systemImage: "arrow.clockwise.circle.fill").foregroundStyle(XLogTheme.danger) }
                        }.font(.caption).foregroundStyle(XLogTheme.secondary)
                    }
                }
                Panel(title: "Wavelog outbox", symbol: "tray.full") {
                    if model.outbox.isEmpty {
                        Label("Everything has been acknowledged by Wavelog.", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(XLogTheme.teal)
                    } else {
                        Text("Local contacts remain safe while failed items wait for their next retry.")
                            .font(.caption).foregroundStyle(XLogTheme.secondary)
                        if model.outbox.count > 100 {
                            Text("Showing the first 100 of \(model.outbox.count) queued contacts.")
                                .font(.caption).foregroundStyle(XLogTheme.secondary)
                        }
                        ForEach(Array(model.outbox.prefix(100))) { entry in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(entry.qso.call) · \(entry.qso.band) \(entry.qso.mode)")
                                        .font(.body.weight(.semibold))
                                    if let error = entry.lastError {
                                        Text(error).font(.caption).foregroundStyle(XLogTheme.danger).lineLimit(2)
                                    } else {
                                        Text("Waiting for first upload").font(.caption).foregroundStyle(XLogTheme.secondary)
                                    }
                                    if let next = entry.nextAttemptAt {
                                        Text("Attempt \(entry.attemptCount) · next retry \(next.formatted(date: .omitted, time: .shortened))")
                                            .font(.caption2).foregroundStyle(XLogTheme.secondary)
                                    }
                                }
                                Spacer()
                                Button("Retry now") { model.retrySync(entry) }
                                    .disabled(model.isWorking)
                            }
                            .padding(9).background(XLogTheme.raised).clipShape(RoundedRectangle(cornerRadius: 7))
                        }
                    }
                }
                if !model.conflicts.isEmpty {
                    Panel(title: "Sync conflicts", symbol: "exclamationmark.triangle.fill") {
                        Text("Both xLog and Wavelog changed these contacts. Review each version; nothing is overwritten until you choose.")
                            .foregroundStyle(XLogTheme.secondary)
                        ForEach(model.conflicts) { conflict in ConflictMergeCard(conflict: conflict) }
                    }
                }
                Panel(title: "Operator activity", symbol: "waveform.path.ecg.rectangle") {
                    if model.activityEvents.isEmpty {
                        Text("Tune, station, validation and sync timings will appear here.")
                            .foregroundStyle(XLogTheme.secondary)
                    } else {
                        ForEach(model.activityEvents.prefix(20)) { event in
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: event.kind.symbol)
                                    .foregroundStyle(event.succeeded ? XLogTheme.cyan : XLogTheme.danger)
                                    .frame(width: 18)
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 8) {
                                        Text(event.title).fontWeight(.semibold)
                                        if let duration = event.durationMilliseconds {
                                            Text("\(duration) ms").font(.system(.caption, design: .monospaced)).foregroundStyle(duration > 1_000 ? XLogTheme.amber : XLogTheme.teal)
                                        }
                                    }
                                    if !event.detail.isEmpty { Text(event.detail).font(.caption).foregroundStyle(XLogTheme.secondary) }
                                }
                                Spacer()
                                Text(event.date.formatted(date: .omitted, time: .standard)).font(.caption2).foregroundStyle(XLogTheme.secondary)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                }
                Panel(title: "Reference data", symbol: "externaldrive.badge.icloud") {
                    Text("Club Log CTY classification and LoTW user activity are downloaded atomically. A failed update leaves the last known good files active.")
                        .foregroundStyle(XLogTheme.secondary)
                    HStack {
                        VStack(alignment: .leading) {
                            Text("Club Log CTY").fontWeight(.semibold)
                            Text(updateText(model.referenceState.clubLogUpdatedAt, bytes: model.referenceState.clubLogBytes)).font(.caption).foregroundStyle(XLogTheme.secondary)
                        }
                        Spacer()
                        VStack(alignment: .leading) {
                            Text("LoTW activity").fontWeight(.semibold)
                            Text(updateText(model.referenceState.lotwUpdatedAt, bytes: model.referenceState.lotwBytes)).font(.caption).foregroundStyle(XLogTheme.secondary)
                        }
                        Spacer()
                        VStack(alignment: .leading) {
                            Text("Wavelog catalog").fontWeight(.semibold)
                            Text(updateText(model.referenceState.wavelogCatalogUpdatedAt, bytes: model.referenceState.wavelogCatalogBytes)).font(.caption).foregroundStyle(XLogTheme.secondary)
                        }
                        Spacer()
                        Button("Update now") { Task { await model.refreshReferenceData() } }.disabled(model.isWorking)
                    }
                }
                Panel(title: "Local-first safety", symbol: "externaldrive.fill.badge.checkmark") {
                    Text("Logging never waits for Wavelog. Every change is committed to SQLite first and marked pending until the API confirms it.")
                        .foregroundStyle(XLogTheme.secondary)
                    Label("\(model.qsos.filter(\.isDirty).count) changes pending", systemImage: "clock")
                        .foregroundStyle(model.qsos.contains(where: \.isDirty) ? XLogTheme.amber : XLogTheme.teal)
                }
            }.padding(20).frame(maxWidth: 850, alignment: .leading)
        }
    }

    private func updateText(_ date: Date?, bytes: Int) -> String {
        guard let date else { return "Not downloaded yet" }
        return "\(date.formatted(date: .abbreviated, time: .shortened)) · \(ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file))"
    }
}

private struct ConflictMergeCard: View {
    @EnvironmentObject private var model: AppModel
    let conflict: SyncConflict
    @State private var remoteFields: Set<String> = []

    private var fields: [QSOConflictField] { QSOConflictMerge.differingFields(in: conflict) }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(conflict.localQSO.call).font(.headline).foregroundStyle(XLogTheme.amber)
                    Text("Choose the source for each changed field.").font(.caption).foregroundStyle(XLogTheme.secondary)
                }
                Spacer()
                Button("All local") { remoteFields.removeAll() }
                Button("All Wavelog") { remoteFields = Set(fields.map(\.key)) }
            }
            ForEach(fields) { field in
                HStack(alignment: .top, spacing: 8) {
                    Text(field.label).font(.caption.weight(.semibold)).frame(width: 110, alignment: .leading)
                    Button {
                        remoteFields.remove(field.key)
                    } label: {
                        conflictValue(field.localValue, source: "LOCAL", selected: !remoteFields.contains(field.key))
                    }.buttonStyle(.plain)
                    Button {
                        remoteFields.insert(field.key)
                    } label: {
                        conflictValue(field.remoteValue, source: "WAVELOG", selected: remoteFields.contains(field.key))
                    }.buttonStyle(.plain)
                }
            }
            HStack {
                Button("Keep complete local record") { model.resolve(conflict, useRemote: false) }
                Button("Use complete Wavelog record") { model.resolve(conflict, useRemote: true) }
                Spacer()
                Button("Save merged record") { model.resolve(conflict, remoteFields: remoteFields) }
                    .buttonStyle(PrimaryActionStyle())
            }
        }
        .padding(10).background(XLogTheme.raised).clipShape(RoundedRectangle(cornerRadius: 7))
    }

    private func conflictValue(_ value: String, source: String, selected: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(source).font(.caption2.weight(.bold)).foregroundStyle(selected ? XLogTheme.cyan : XLogTheme.secondary)
            Text(value).font(.caption).foregroundStyle(XLogTheme.text).lineLimit(3).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? XLogTheme.cyan.opacity(0.12) : XLogTheme.surface)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(selected ? XLogTheme.cyan : XLogTheme.rule))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}
