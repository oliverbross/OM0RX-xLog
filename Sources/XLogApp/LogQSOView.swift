import SwiftUI
import XLogCore

struct LogQSOView: View {
    @EnvironmentObject private var model: AppModel
    @FocusState private var focused: Field?
    @State private var tab: DetailTab = .qso

    private enum Field { case call, frequency }
    private enum DetailTab: String, CaseIterable, Identifiable {
        case qso = "QSO"
        case station = "Station"
        case general = "General"
        case notes = "Notes"
        case qsl = "QSL"
        var id: String { rawValue }
    }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                if proxy.size.width >= 1_080 {
                    HStack(alignment: .top, spacing: 14) {
                        editor.frame(maxWidth: .infinity)
                        contextInspector.frame(width: 365)
                    }
                } else {
                    VStack(spacing: 14) { editor; contextInspector }
                }
            }
            .padding(16)
        }
        .onAppear { focused = .call }
    }

    private var editor: some View {
        VStack(spacing: 14) {
            Panel(title: "Active contact", symbol: "dot.radiowaves.left.and.right") {
                HStack(alignment: .bottom, spacing: 12) {
                    VStack(alignment: .leading, spacing: 5) {
                        FieldLabel(title: "Callsign")
                        TextField("Callsign", text: $model.draft.call)
                            .textFieldStyle(DarkTextFieldStyle())
                            .font(.system(size: 25, weight: .bold, design: .monospaced))
                            .foregroundStyle(XLogTheme.teal)
                            .focused($focused, equals: .call)
                            .onChange(of: model.draft.call) { _ in model.callChanged() }
                            .onSubmit { focused = .frequency }
                            .accessibilityLabel("Callsign")
                    }
                    VStack(alignment: .leading, spacing: 5) {
                        FieldLabel(title: "Frequency MHz")
                        TextField("14.074000", text: $model.draft.frequency)
                            .textFieldStyle(DarkTextFieldStyle())
                            .font(.system(.body, design: .monospaced))
                            .foregroundStyle(XLogTheme.cyan)
                            .focused($focused, equals: .frequency)
                            .frame(width: 132)
                            .onChange(of: model.draft.frequency) { value in
                                if let hz = BandPlan.frequencyHz(from: value) {
                                    let band = BandPlan.band(for: hz)
                                    if !band.isEmpty { model.draft.band = band }
                                }
                            }
                    }
                    VStack(alignment: .leading, spacing: 5) {
                        FieldLabel(title: "Band")
                        Picker("Band", selection: $model.draft.band) {
                            ForEach(BandPlan.bands, id: \.self) { Text($0).tag($0) }
                        }.labelsHidden().frame(width: 82)
                    }
                    VStack(alignment: .leading, spacing: 5) {
                        FieldLabel(title: "Mode")
                        Picker("Mode", selection: $model.draft.mode) {
                            ForEach(BandPlan.modes, id: \.self) { Text($0).tag($0) }
                        }.labelsHidden().frame(width: 92)
                    }
                    Button { model.readRadio() } label: { Label("Read radio", systemImage: "antenna.radiowaves.left.and.right") }
                        .buttonStyle(.bordered)
                }

                HStack(spacing: 12) {
                    DatePicker("UTC", selection: $model.draft.timestamp)
                        .datePickerStyle(.field)
                        .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
                    Spacer()
                    reportField("RST sent", text: $model.draft.rstSent)
                    reportField("RST received", text: $model.draft.rstReceived)
                }
            }

            Picker("Contact details", selection: $tab) {
                ForEach(DetailTab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Panel(title: tab.rawValue + " details", symbol: tabSymbol) {
                detailFields
                    .frame(minHeight: 184, alignment: .top)
            }

            HStack {
                Text("Saved locally first; Wavelog synchronization follows in the background.")
                    .font(.caption).foregroundStyle(XLogTheme.secondary)
                Spacer()
                Button("Clear") {
                    model.cancelEditing()
                    focused = .call
                }
                .buttonStyle(.bordered)
                Button {
                    model.logQSO()
                    focused = .call
                } label: {
                    Label(model.isEditing ? "Update QSO" : "Log QSO", systemImage: model.isEditing ? "square.and.pencil" : "checkmark.circle.fill")
                }
                .buttonStyle(PrimaryActionStyle())
                .keyboardShortcut(.return, modifiers: [.command])
                .accessibilityHint(model.isEditing ? "Updates the selected local contact" : "Saves the contact locally")
            }
        }
    }

    @ViewBuilder private var detailFields: some View {
        switch tab {
        case .qso:
            FieldGrid {
                FormField("Name", text: $model.draft.name)
                FormField("Gridsquare", text: $model.draft.gridSquare)
                FormField("IOTA", text: $model.draft.iota)
                FormField("SOTA", text: $model.draft.sota)
                FormField("WWFF", text: $model.draft.wwff)
                FormField("POTA", text: $model.draft.pota)
                FormField("SIG", text: $model.draft.sig)
                FormField("SIG info", text: $model.draft.sigInfo)
                FormField("DOK", text: $model.draft.dok)
                FormField("Location", text: $model.draft.qth)
            }
        case .station:
            FieldGrid {
                FormField("Station location", text: $model.draft.stationLocation)
                FormField("Radio", text: $model.draft.radio)
                FormField("RX frequency", text: $model.draft.rxFrequency)
                FormField("RX band", text: $model.draft.rxBand)
                FormField("TX power", text: $model.draft.txPower)
                FormField("Operator", text: $model.draft.operatorCall)
            }
        case .general:
            FieldGrid {
                FormField("Country", text: $model.draft.country)
                FormField("DXCC", text: $model.draft.dxcc)
                FormField("Continent", text: $model.draft.continent)
                FormField("CQ zone", text: $model.draft.cqZone)
                FormField("ITU zone", text: $model.draft.ituZone)
                FormField("State", text: $model.draft.state)
                FormField("County", text: $model.draft.county)
                FormField("Propagation", text: $model.draft.propagation)
                FormField("Antenna path", text: $model.draft.antennaPath)
                FormField("Email", text: $model.draft.email)
            }
        case .notes:
            VStack(spacing: 10) {
                FormField("Comment", text: $model.draft.comment)
                VStack(alignment: .leading, spacing: 5) {
                    FieldLabel(title: "QSO note")
                    TextEditor(text: $model.draft.notes)
                        .font(.body)
                        .scrollContentBackground(.hidden)
                        .padding(6).frame(minHeight: 108)
                        .background(XLogTheme.raised)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(XLogTheme.rule))
                }
            }
        case .qsl:
            FieldGrid {
                FormField("QSL sent", text: $model.draft.qslSent)
                FormField("QSL received", text: $model.draft.qslReceived)
                FormField("Method", text: $model.draft.qslMethod)
                FormField("Via", text: $model.draft.qslVia)
                FormField("QSL message", text: $model.draft.qslMessage)
            }
        }
    }

    private var contextInspector: some View {
        VStack(spacing: 14) {
            Panel(title: "Callsign intelligence", symbol: "person.text.rectangle") {
                if model.draft.call.isEmpty {
                    EmptyContext(title: "Enter a callsign", message: "Previous contacts, confirmations and band/mode history will appear here.", symbol: "text.cursor")
                } else {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.draft.country.isEmpty ? "Country unresolved" : model.draft.country)
                                .font(.headline)
                            Text(model.draft.gridSquare.isEmpty ? "Grid unavailable" : model.draft.gridSquare)
                                .font(.caption).foregroundStyle(XLogTheme.secondary)
                        }
                        Spacer()
                        Text(model.previous.isEmpty ? "NEW CALL" : "\(model.previous.count) WORKED")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(model.previous.isEmpty ? XLogTheme.amber : XLogTheme.teal)
                    }
                }
            }
            Panel(title: "Previous QSOs", symbol: "clock.arrow.circlepath") {
                if model.previous.isEmpty {
                    EmptyContext(title: "No local history", message: "A matching contact has not been logged in xLog.", symbol: "clock")
                } else {
                    VStack(spacing: 0) {
                        ForEach(model.previous.prefix(6)) { qso in
                            HStack {
                                Text(qso.start.formatted(date: .numeric, time: .shortened)).monospacedDigit()
                                Spacer()
                                Text(qso.band).foregroundStyle(XLogTheme.cyan)
                                Text(qso.mode).frame(width: 45, alignment: .leading)
                                Image(systemName: qso.isConfirmed ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(qso.isConfirmed ? XLogTheme.teal : XLogTheme.orange)
                            }
                            .font(.caption)
                            .padding(.vertical, 6)
                            if qso.id != model.previous.prefix(6).last?.id { Divider().overlay(XLogTheme.rule) }
                        }
                    }
                }
            }
            Panel(title: "Band / mode matrix", symbol: "square.grid.3x3") {
                MatrixView(cells: model.matrix)
            }
        }
    }

    private func reportField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(title: title)
            TextField("", text: text).textFieldStyle(DarkTextFieldStyle()).frame(width: 74)
        }
    }

    private var tabSymbol: String {
        switch tab {
        case .qso: return "waveform"
        case .station: return "antenna.radiowaves.left.and.right"
        case .general: return "globe"
        case .notes: return "note.text"
        case .qsl: return "envelope"
        }
    }
}

private struct FieldGrid<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 12)], alignment: .leading, spacing: 10) { content }
    }
}

private struct FormField: View {
    let title: String
    @Binding var text: String
    init(_ title: String, text: Binding<String>) { self.title = title; _text = text }
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            FieldLabel(title: title)
            TextField(title, text: $text).textFieldStyle(DarkTextFieldStyle())
        }
    }
}

private struct EmptyContext: View {
    let title: String
    let message: String
    let symbol: String
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol).font(.title2).foregroundStyle(XLogTheme.secondary)
            Text(title).font(.headline)
            Text(message).font(.caption).foregroundStyle(XLogTheme.secondary).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity, minHeight: 82)
    }
}

private struct MatrixView: View {
    let cells: Set<BandModeCell>
    private let bands = ["80m", "40m", "20m", "15m", "10m"]
    private let modes = ["CW", "SSB", "FT8"]
    var body: some View {
        Grid(horizontalSpacing: 5, verticalSpacing: 5) {
            GridRow {
                Text("").frame(width: 35)
                ForEach(bands, id: \.self) { Text($0).font(.caption2).foregroundStyle(XLogTheme.secondary) }
            }
            ForEach(modes, id: \.self) { mode in
                GridRow {
                    Text(mode).font(.caption2.weight(.semibold)).frame(width: 35, alignment: .leading)
                    ForEach(bands, id: \.self) { band in
                        let match = cells.first { $0.band == band && $0.mode == mode }
                        Image(systemName: match?.confirmed == true ? "checkmark.circle.fill" : match?.worked == true ? "checkmark.circle" : "minus")
                            .font(.caption)
                            .foregroundStyle(match?.confirmed == true ? XLogTheme.teal : match?.worked == true ? XLogTheme.orange : XLogTheme.secondary.opacity(0.45))
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }
}
