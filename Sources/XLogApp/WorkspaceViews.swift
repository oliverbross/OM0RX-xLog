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
                        Text(qso.call).fontWeight(.bold).foregroundStyle(XLogTheme.teal)
                    }.width(min: 90, ideal: 115)
                    TableColumn("Band") { qso in Text(qso.band).fontWeight(.semibold).foregroundStyle(XLogTheme.cyan) }.width(55)
                    TableColumn("Mode") { qso in Text(qso.submode.isEmpty ? qso.mode : qso.submode) }.width(60)
                    TableColumn("Frequency") { qso in Text(qso.displayFrequency).monospacedDigit().foregroundStyle(XLogTheme.cyan) }.width(88)
                    TableColumn("RST") { qso in Text("\(qso.rstSent) / \(qso.rstReceived)").monospacedDigit() }.width(75)
                    TableColumn("Country") { qso in Text(qso.country.isEmpty ? "—" : qso.country) }.width(min: 110, ideal: 150)
                    TableColumn("QSL") { qso in
                        Label(qso.isConfirmed ? "Confirmed" : qso.qslReceived.isEmpty ? "—" : qso.qslReceived, systemImage: qso.isConfirmed ? "checkmark.circle.fill" : "minus")
                            .foregroundStyle(qso.isConfirmed ? XLogTheme.teal : XLogTheme.secondary)
                    }.width(90)
                    TableColumn("Sync") { qso in
                        Text(qso.isDirty ? "Pending" : "Synced")
                            .foregroundStyle(qso.isDirty ? XLogTheme.amber : XLogTheme.teal)
                    }.width(64)
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

struct InsightsView: View {
    @EnvironmentObject private var model: AppModel
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Station insights").font(.title2.bold())
                    Text("A fast local summary; detailed award accounting remains in Wavelog.")
                        .foregroundStyle(XLogTheme.secondary)
                }
                HStack(spacing: 0) {
                    Metric(title: "Contacts", value: model.stats.qsoCount.formatted(), symbol: "waveform.path.ecg", color: XLogTheme.cyan)
                    Divider().overlay(XLogTheme.rule)
                    Metric(title: "DXCC entities", value: model.stats.dxccCount.formatted(), symbol: "globe", color: XLogTheme.teal)
                    Divider().overlay(XLogTheme.rule)
                    Metric(title: "Confirmed", value: model.stats.confirmedCount.formatted(), symbol: "checkmark.seal.fill", color: XLogTheme.teal)
                    Divider().overlay(XLogTheme.rule)
                    Metric(title: "This year", value: model.stats.thisYearCount.formatted(), symbol: "calendar", color: XLogTheme.amber)
                }
                .padding(.vertical, 10)
                .background(XLogTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(XLogTheme.rule))
                Panel(title: "Operating mix", symbol: "chart.bar.fill") {
                    if model.qsos.isEmpty {
                        Text("Mode and band summaries will appear after the first contact.")
                            .foregroundStyle(XLogTheme.secondary)
                    } else {
                        let grouped = Dictionary(grouping: model.qsos, by: { $0.band })
                        VStack(spacing: 10) {
                            ForEach(grouped.keys.sorted(), id: \.self) { band in
                                HStack {
                                    Text(band).fontWeight(.semibold).frame(width: 45, alignment: .leading)
                                    GeometryReader { proxy in
                                        let fraction = Double(grouped[band]?.count ?? 0) / Double(max(1, model.qsos.count))
                                        ZStack(alignment: .leading) {
                                            Capsule().fill(XLogTheme.raised)
                                            Capsule().fill(XLogTheme.cyan).frame(width: max(3, proxy.size.width * fraction))
                                        }
                                    }.frame(height: 8)
                                    Text((grouped[band]?.count ?? 0).formatted()).monospacedDigit().frame(width: 50, alignment: .trailing)
                                }
                            }
                        }
                    }
                }
            }.padding(20)
        }
    }
}

private struct Metric: View {
    let title: String
    let value: String
    let symbol: String
    let color: Color
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).foregroundStyle(color).font(.title3)
            VStack(alignment: .leading, spacing: 2) {
                Text(value).font(.system(size: 22, weight: .bold, design: .rounded)).monospacedDigit()
                Text(title).font(.caption).foregroundStyle(XLogTheme.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .accessibilityElement(children: .combine)
    }
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
                        }.font(.caption).foregroundStyle(XLogTheme.secondary)
                    }
                }
                if !model.conflicts.isEmpty {
                    Panel(title: "Sync conflicts", symbol: "exclamationmark.triangle.fill") {
                        Text("Both xLog and Wavelog changed these contacts. Review each version; nothing is overwritten until you choose.")
                            .foregroundStyle(XLogTheme.secondary)
                        ForEach(model.conflicts) { conflict in
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(conflict.localQSO.call).font(.headline).foregroundStyle(XLogTheme.amber)
                                    Text("Local: \(conflict.localQSO.start.formatted(date: .abbreviated, time: .shortened)) · \(conflict.localQSO.band) \(conflict.localQSO.mode)")
                                    Text("Wavelog: \(conflict.remoteQSO.start.formatted(date: .abbreviated, time: .shortened)) · \(conflict.remoteQSO.band) \(conflict.remoteQSO.mode)")
                                }.font(.caption)
                                Spacer()
                                Button("Keep local") { model.resolve(conflict, useRemote: false) }
                                Button("Use Wavelog") { model.resolve(conflict, useRemote: true) }
                            }
                            .padding(10).background(XLogTheme.raised).clipShape(RoundedRectangle(cornerRadius: 7))
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
