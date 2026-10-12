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
    @State private var selectedAwardID = "jarl.ajd"
    @State private var awardSearch = ""
    @State private var awardDeliveryFilter: AwardDeliveryFilter = .all
    @State private var awardGroupFilter: AwardGroupFilter = .all
    @State private var awardModeFilter: AwardModeFilter = .all
    @State private var awardRoleFilter: AwardRoleFilter = .all

    private var filteredAwardProgrammes: [AwardProgramme] {
        model.awardCatalog.programmes.filter { programme in
            let matchesDelivery = awardDeliveryFilter.matches(programme.deliveryState)
            let matchesGroup = awardGroupFilter.matches(programme.record.catalogueGroup)
            let matchesMode = awardModeFilter.matches(programme.record)
            let matchesRole = awardRoleFilter.matches(programme.record)
            let needle = awardSearch.trimmingCharacters(in: .whitespacesAndNewlines)
            let matchesSearch = needle.isEmpty || [
                programme.record.name,
                programme.record.sponsor,
                programme.record.id,
                programme.record.scopeOrCountingFocus,
            ].contains { $0.localizedCaseInsensitiveContains(needle) }
            return matchesDelivery && matchesGroup && matchesMode && matchesRole && matchesSearch
        }
    }

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

                Panel(title: "Awards library", symbol: "rosette") {
                    if model.awardCatalog.programmes.isEmpty {
                        EmptyInsight(text: "Award progress appears after the local log and bundled reference data are available.")
                    } else {
                        VStack(alignment: .leading, spacing: 14) {
                            AwardLibrarySummary(programmes: model.awardCatalog.programmes)

                            HStack(spacing: 10) {
                                TextField("Search programme, sponsor or rule focus", text: $awardSearch)
                                    .textFieldStyle(.roundedBorder)
                                    .frame(maxWidth: .infinity)
                                Picker("State", selection: $awardDeliveryFilter) {
                                    ForEach(AwardDeliveryFilter.allCases) { filter in
                                        Text(filter.rawValue).tag(filter)
                                    }
                                }
                                .labelsHidden()
                                .frame(width: 170)
                                Picker("Region", selection: $awardGroupFilter) {
                                    ForEach(AwardGroupFilter.allCases) { filter in
                                        Text(filter.rawValue).tag(filter)
                                    }
                                }
                                .labelsHidden()
                                .frame(width: 130)
                            }

                            HStack(spacing: 10) {
                                Text("Research facets")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(XLogTheme.secondary)
                                Picker("Mode", selection: $awardModeFilter) {
                                    ForEach(AwardModeFilter.allCases) { filter in
                                        Text(filter.rawValue).tag(filter)
                                    }
                                }
                                .labelsHidden()
                                .frame(width: 140)
                                Picker("Role", selection: $awardRoleFilter) {
                                    ForEach(AwardRoleFilter.allCases) { filter in
                                        Text(filter.rawValue).tag(filter)
                                    }
                                }
                                .labelsHidden()
                                .frame(width: 150)
                                Text("Mode and role facets use only explicit wording in the reviewed source record.")
                                    .font(.caption)
                                    .foregroundStyle(XLogTheme.secondary)
                                Spacer()
                            }

                            HStack(alignment: .top, spacing: 18) {
                                VStack(spacing: 0) {
                                    HStack {
                                        Text("\(filteredAwardProgrammes.count) PROGRAMMES")
                                            .font(.caption2.weight(.bold))
                                            .foregroundStyle(XLogTheme.secondary)
                                        Spacer()
                                        if !awardSearch.isEmpty || awardDeliveryFilter != .all || awardGroupFilter != .all
                                            || awardModeFilter != .all || awardRoleFilter != .all {
                                            Button("Clear filters") {
                                                awardSearch = ""
                                                awardDeliveryFilter = .all
                                                awardGroupFilter = .all
                                                awardModeFilter = .all
                                                awardRoleFilter = .all
                                            }
                                            .buttonStyle(.plain)
                                            .font(.caption)
                                            .foregroundStyle(XLogTheme.cyan)
                                        }
                                    }
                                    .padding(.horizontal, 10)
                                    .padding(.bottom, 7)

                                    ScrollView {
                                        LazyVStack(spacing: 0) {
                                            ForEach(filteredAwardProgrammes) { programme in
                                                AwardProgrammeRow(
                                                    programme: programme,
                                                    selected: programme.id == selectedAwardID,
                                                    action: { selectedAwardID = programme.id }
                                                )
                                                if programme.id != filteredAwardProgrammes.last?.id {
                                                    Rectangle().fill(XLogTheme.rule).frame(height: 1)
                                                }
                                            }
                                            if filteredAwardProgrammes.isEmpty {
                                                EmptyInsight(text: "No award programmes match these filters.")
                                                    .padding(.vertical, 40)
                                            }
                                        }
                                    }
                                }
                                .frame(width: 370, height: 520)

                                Rectangle().fill(XLogTheme.rule).frame(width: 1, height: 520)

                                if let selected = model.awardCatalog.programmes.first(where: { $0.id == selectedAwardID })
                                    ?? filteredAwardProgrammes.first
                                    ?? model.awardCatalog.programmes.first {
                                    AwardProgrammeDetail(
                                        programme: selected,
                                        referenceDate: model.awardCatalog.referenceDate,
                                        researchDate: model.awardCatalog.researchDate
                                    )
                                }
                            }
                        }
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

private enum AwardDeliveryFilter: String, CaseIterable, Identifiable {
    case all = "All states"
    case live = "Live calculations"
    case tracking = "Research tracking"
    case blocked = "Blocked"
    case historical = "Historical"
    var id: String { rawValue }

    func matches(_ state: AwardDeliveryState) -> Bool {
        switch self {
        case .all: return true
        case .live: return state == .implemented
        case .tracking: return state == .trackingOnly
        case .blocked: return state == .blocked
        case .historical: return state == .historical
        }
    }
}

private enum AwardGroupFilter: String, CaseIterable, Identifiable {
    case all = "All regions"
    case global = "Global"
    case europe = "Europe"
    case world = "World"
    case specialty = "Specialty"
    var id: String { rawValue }

    func matches(_ group: AwardCatalogueGroup) -> Bool {
        self == .all || rawValue.lowercased() == group.rawValue
    }
}

private enum AwardModeFilter: String, CaseIterable, Identifiable {
    case all = "All modes"
    case cw = "CW stated"
    case ssb = "SSB stated"
    case mixed = "Mixed stated"
    var id: String { rawValue }

    func matches(_ record: AwardProgrammeRecord) -> Bool {
        guard self != .all else { return true }
        let modes = record.research["modes"]?.displayText.lowercased() ?? ""
        switch self {
        case .all: return true
        case .cw: return modes.range(of: "\\bcw\\b", options: .regularExpression) != nil
        case .ssb: return modes.range(of: "\\bssb\\b", options: .regularExpression) != nil
        case .mixed: return modes.range(of: "\\bmixed\\b", options: .regularExpression) != nil
        }
    }
}

private enum AwardRoleFilter: String, CaseIterable, Identifiable {
    case all = "All roles"
    case hunter = "Hunter stated"
    case activator = "Activator stated"
    var id: String { rawValue }

    func matches(_ record: AwardProgrammeRecord) -> Bool {
        guard self != .all else { return true }
        let text = ([record.name, record.scopeOrCountingFocus]
            + record.research.values.map(\.displayText))
            .joined(separator: " ")
            .lowercased()
        switch self {
        case .all: return true
        case .hunter: return text.contains("hunter") || text.contains("chaser")
        case .activator: return text.contains("activator") || text.contains("activation")
        }
    }
}

private struct AwardLibrarySummary: View {
    let programmes: [AwardProgramme]

    var body: some View {
        HStack(spacing: 0) {
            summary("Library", programmes.count, XLogTheme.cyan)
            summary("Live", count(.implemented), XLogTheme.teal)
            summary("Tracking", count(.trackingOnly), XLogTheme.cyan)
            summary("Blocked", count(.blocked), XLogTheme.amber)
            summary("Historical", count(.historical), XLogTheme.secondary)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private func count(_ state: AwardDeliveryState) -> Int {
        programmes.filter { $0.deliveryState == state }.count
    }

    private func summary(_ label: String, _ value: Int, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value.formatted())
                .font(.title3.bold().monospacedDigit())
                .foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(XLogTheme.secondary)
        }
        .frame(minWidth: 86, alignment: .leading)
    }
}

private struct AwardProgrammeRow: View {
    let programme: AwardProgramme
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 11) {
                Image(systemName: deliverySymbol(programme.deliveryState))
                    .font(.caption.weight(.bold))
                    .foregroundStyle(deliveryColor(programme.deliveryState))
                    .frame(width: 18)
                    .accessibilityHidden(true)
                Text(programme.record.shortCode)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(programme.progress.map { awardColor($0.code) } ?? deliveryColor(programme.deliveryState))
                    .frame(width: 64, alignment: .leading)
                    .lineLimit(1)
                VStack(alignment: .leading, spacing: 2) {
                    Text(programme.record.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(programme.record.sponsor).font(.caption2).foregroundStyle(XLogTheme.secondary).lineLimit(1)
                }
                Spacer(minLength: 8)
                if let progress = programme.progress {
                    Text("\(progress.current.formatted()) / \(progress.target.formatted())")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(progress.completed ? XLogTheme.teal : XLogTheme.secondary)
                }
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 46)
            .background(selected ? XLogTheme.raised : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(programme.record.name), \(programme.deliveryState.title)")
        .accessibilityValue(selected ? "Selected" : "")
    }
}

private struct AwardProgrammeDetail: View {
    let programme: AwardProgramme
    let referenceDate: String
    let researchDate: String

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(programme.record.name).font(.title3.weight(.semibold))
                        Text(programme.record.sponsor).font(.subheadline).foregroundStyle(XLogTheme.secondary)
                    }
                    Spacer()
                    Label(programme.deliveryState.title, systemImage: deliverySymbol(programme.deliveryState))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(deliveryColor(programme.deliveryState))
                }

                if let award = programme.progress {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .lastTextBaseline, spacing: 7) {
                            Text(award.current.formatted())
                                .font(.system(size: 38, weight: .bold, design: .rounded)).monospacedDigit()
                                .foregroundStyle(awardColor(award.code))
                            Text("of \(award.target.formatted()) \(award.unit) evidence-eligible")
                                .font(.body.weight(.medium)).foregroundStyle(XLogTheme.secondary)
                        }
                        GeometryReader { proxy in
                            ZStack(alignment: .leading) {
                                Rectangle().fill(XLogTheme.raised)
                                Rectangle().fill(awardColor(award.code)).frame(width: max(4, proxy.size.width * award.fraction))
                            }
                        }
                        .frame(height: 7)
                        .clipShape(Capsule())
                        HStack(spacing: 18) {
                            EvidenceLabel(title: "Worked", value: award.worked.formatted())
                            EvidenceLabel(title: "Evidence-eligible", value: award.current.formatted())
                            EvidenceLabel(title: "Sponsor-credited", value: award.sponsorCredited?.formatted() ?? "Not imported")
                        }
                        Text(award.detail).font(.body).foregroundStyle(XLogTheme.secondary)

                        if !award.breakdowns.isEmpty {
                            Text("BREAKDOWN").font(.caption2.weight(.bold)).foregroundStyle(XLogTheme.secondary)
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 118), spacing: 8)], alignment: .leading, spacing: 8) {
                                ForEach(award.breakdowns) { item in
                                    HStack {
                                        Text(item.label).font(.caption.weight(.semibold)).lineLimit(1)
                                        Spacer()
                                        Text(item.target.map { "\(item.value)/\($0)" } ?? item.value.formatted())
                                            .font(.caption.monospacedDigit()).foregroundStyle(XLogTheme.secondary)
                                    }
                                    .padding(.horizontal, 9)
                                    .frame(minHeight: 30)
                                    .background(XLogTheme.raised)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                                }
                            }
                        }
                    }
                } else {
                    Text("No eligibility result is asserted for this programme.")
                        .font(.headline)
                        .foregroundStyle(deliveryColor(programme.deliveryState))
                }

                Text(programme.deliveryDetail)
                    .font(.body)
                    .foregroundStyle(XLogTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                detailSection("Counting focus", programme.record.scopeOrCountingFocus)

                ForEach(programme.record.research.sorted(by: { $0.key < $1.key }), id: \.key) { entry in
                    detailSection(entry.key.replacingOccurrences(of: "_", with: " ").capitalized, entry.value.displayText)
                }

                if !programme.record.openQuestions.isEmpty {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("OPEN DEPENDENCIES").font(.caption2.weight(.bold)).foregroundStyle(XLogTheme.amber)
                        ForEach(programme.record.openQuestions, id: \.self) { question in
                            Label(question, systemImage: "exclamationmark.circle")
                                .font(.caption)
                                .foregroundStyle(XLogTheme.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                if !programme.record.officialSources.isEmpty {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("OFFICIAL SOURCES").font(.caption2.weight(.bold)).foregroundStyle(XLogTheme.secondary)
                        ForEach(Array(programme.record.officialSources.enumerated()), id: \.offset) { index, source in
                            if let value = source.url, let url = URL(string: value) {
                                Link(destination: url) {
                                    Label(url.host ?? "Official source \(index + 1)", systemImage: "arrow.up.right.square")
                                        .font(.caption)
                                }
                            } else if let ref = source.ref {
                                Text(ref).font(.caption).foregroundStyle(XLogTheme.secondary)
                            }
                        }
                    }
                }

                HStack(spacing: 7) {
                    Image(systemName: "checkmark.shield")
                    Text("Research reviewed \(programme.record.checkedOnUTC.isEmpty ? researchDate : programme.record.checkedOnUTC)")
                    if programme.progress != nil, !referenceDate.isEmpty { Text("· JARL data \(referenceDate)") }
                }
                .font(.caption2)
                .foregroundStyle(XLogTheme.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .padding(.trailing, 8)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .frame(height: 520, alignment: .topLeading)
        .accessibilityElement(children: .contain)
    }

    private func detailSection(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(XLogTheme.secondary)
            Text(text).font(.caption).foregroundStyle(XLogTheme.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct EvidenceLabel: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(XLogTheme.secondary)
            Text(value).font(.caption.weight(.semibold)).lineLimit(2)
        }
    }
}

private func deliveryColor(_ state: AwardDeliveryState) -> Color {
    switch state {
    case .implemented: return XLogTheme.teal
    case .trackingOnly: return XLogTheme.cyan
    case .blocked: return XLogTheme.amber
    case .historical: return XLogTheme.secondary
    }
}

private func deliverySymbol(_ state: AwardDeliveryState) -> String {
    switch state {
    case .implemented: return "checkmark.seal.fill"
    case .trackingOnly: return "doc.text.magnifyingglass"
    case .blocked: return "exclamationmark.triangle.fill"
    case .historical: return "clock.arrow.circlepath"
    }
}

private func awardColor(_ code: String) -> Color {
    switch code {
    case "AJD", "JCC", "WACA": return XLogTheme.cyan
    case "WAJA", "JCG", "WAGA": return XLogTheme.teal
    case "AJA": return XLogTheme.amber
    case "WAPC": return XLogTheme.orange
    case "WCSA": return XLogTheme.pink
    default: return XLogTheme.cyan
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
