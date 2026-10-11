import AppKit
import Combine
import MapKit
import SwiftUI
import XLogCore

private struct SpotMapPoint: Identifiable {
    enum Kind: String { case spot, station, dxcc, activeDX, sun }
    let id: String
    let coordinate: CLLocationCoordinate2D
    let title: String
    let subtitle: String
    let colorHex: String
    let labelColorHex: String?
    let spot: ClusterSpot?
    let kind: Kind

    var renderSignature: String {
        [
            id,
            kind.rawValue,
            title,
            subtitle,
            colorHex,
            labelColorHex ?? "",
            String(format: "%.6f", coordinate.latitude),
            String(format: "%.6f", coordinate.longitude),
        ].joined(separator: "|")
    }
}

private enum DXCCOverlayMode: String, CaseIterable, Identifiable {
    case spots = "Spots"
    case dxcc = "DXCC"
    case both = "Both"
    var id: String { rawValue }
}

private enum DXCCMapStatus {
    case needed, worked, confirmed

    var label: String {
        switch self {
        case .needed: return "Needed"
        case .worked: return "Worked"
        case .confirmed: return "Confirmed"
        }
    }

    var colorHex: String {
        switch self {
        case .needed: return "#8FB3D9"
        case .worked: return "#FF9D2E"
        case .confirmed: return "#12D6A0"
        }
    }
}

private struct DXCCMapBoundary {
    let adif: Int
    let polygons: [DXCCBoundaryPolygon]
    let colorHex: String
}

private enum RadioMapStyle: String, CaseIterable, Identifiable {
    case hybrid = "Hybrid"
    case satellite = "Satellite"
    case standard = "Standard"
    var id: String { rawValue }
    var mapType: MKMapType {
        switch self {
        case .hybrid: return .hybrid
        case .satellite: return .satellite
        case .standard: return .mutedStandard
        }
    }
}

private struct BandLegendItem: Identifiable {
    let band: String
    let hex: String
    var id: String { band }
}

struct OperatorDeskView: View {
    @EnvironmentObject private var model: AppModel
    @FocusState private var focusedLoggerField: LoggerField?

    private enum LoggerField: Hashable {
        case call, frequency, rstSent, rstReceived
        case name, comment, grid, country, county
        case pota, sota, iota, wwff, castle
    }

    var body: some View {
        GeometryReader { proxy in
            VStack(spacing: 10) {
                if proxy.size.width >= 1_420 {
                    HStack(alignment: .top, spacing: 10) {
                        compactLogger.frame(maxWidth: .infinity)
                        compactIntelligence.frame(width: max(430, proxy.size.width * 0.29))
                        compactRotor.frame(width: max(350, proxy.size.width * 0.22))
                    }
                    .frame(height: 264)
                } else {
                    VStack(spacing: 10) {
                        compactLogger.frame(height: 264)
                        HStack(alignment: .top, spacing: 10) {
                            compactIntelligence
                            compactRotor.frame(width: 240)
                        }
                        .frame(height: 264)
                    }
                }

                if proxy.size.width >= 980 {
                    HStack(spacing: 10) {
                        WorldMapView(compact: true).frame(width: proxy.size.width * 0.58)
                        BandMapsView(compact: true)
                    }
                } else {
                    VStack(spacing: 10) {
                        WorldMapView(compact: true)
                        BandMapsView(compact: true)
                    }
                }
            }.padding(10)
        }
    }

    private var compactLogger: some View {
        Panel(title: "Active QSO", symbol: "dot.radiowaves.left.and.right") {
            // Row 1: everything needed to identify and work the contact.
            HStack(alignment: .bottom, spacing: 7) {
                compactTextField(
                    "Callsign",
                    placeholder: "Callsign",
                    text: $model.draft.call,
                    field: .call,
                    next: model.radioSnapshot != nil && !model.isEditing ? .rstSent : .frequency
                )
                    .font(.system(size: 20, weight: .bold, design: .monospaced))
                    .foregroundStyle(XLogTheme.teal)
                    .onChange(of: model.draft.call) { _ in model.callChanged() }
                compactDatePicker("Date", components: .date).frame(width: 106)
                compactDatePicker("UTC", components: .hourAndMinute).frame(width: 78)
                compactRadioField
                compactBandField
                compactModeField
                compactTextField("RST S", placeholder: "59", text: $model.draft.rstSent, field: .rstSent, next: .rstReceived).frame(width: 54)
                compactTextField("RST R", placeholder: "59", text: $model.draft.rstReceived, field: .rstReceived, next: .name).frame(width: 54)
            }

            // Row 2: identity and location detail, populated by QRZ/CTY when available.
            HStack(alignment: .bottom, spacing: 7) {
                compactTextField("Name", placeholder: "Name", text: $model.draft.name, field: .name, next: .comment)
                compactTextField("Comment", placeholder: "Comment / spot note", text: $model.draft.comment, field: .comment, next: .grid)
                compactTextField("Grid", placeholder: "Grid", text: $model.draft.gridSquare, field: .grid, next: .country).frame(width: 92)
                compactTextField("Country", placeholder: "Country", text: $model.draft.country, field: .country, next: .county).frame(minWidth: 128)
                compactTextField("County", placeholder: "County", text: $model.draft.county, field: .county, next: .pota).frame(width: 110)
            }

            // Row 3: portable and award references carried over from cluster spots.
            HStack(alignment: .bottom, spacing: 7) {
                compactReferenceField("POTA", kind: .pota, text: $model.draft.pota, field: .pota, next: .sota)
                compactReferenceField("SOTA", kind: .sota, text: $model.draft.sota, field: .sota, next: .iota)
                compactReferenceField("IOTA", kind: .iota, text: $model.draft.iota, field: .iota, next: .wwff)
                compactReferenceField("WWFF", kind: .wwff, text: $model.draft.wwff, field: .wwff, next: .castle)
                compactReferenceField("Castle", kind: .castle, text: $model.draft.sigInfo, field: .castle, submitLogs: true)
                    .onChange(of: model.draft.sigInfo) { value in
                        if !value.isEmpty, model.draft.sig.isEmpty { model.draft.sig = "COTA" }
                    }
            }
            HStack {
                Button("Full editor") { model.destination = .log }
                if model.radioSnapshot == nil {
                    Button { model.readRadio() } label: { Label("Read radio", systemImage: "antenna.radiowaves.left.and.right") }
                } else {
                    Label(
                        model.spotWorkflowStatus,
                        systemImage: model.spotWorkflowBusy ? "arrow.triangle.2.circlepath" : "dot.radiowaves.left.and.right"
                    )
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(model.spotWorkflowBusy ? XLogTheme.amber : XLogTheme.cyan)
                }
                Spacer()
                Button {
                    model.clearCurrentQSO()
                    focusedLoggerField = .call
                } label: {
                    Label("Clear QSO", systemImage: "xmark.circle.fill")
                }
                .buttonStyle(.bordered)
                .tint(XLogTheme.danger)
                .controlSize(.regular)
                .help("Clear the current contact without logging it")
                Button {
                    model.logQSO()
                    focusedLoggerField = .call
                } label: { Label(model.isEditing ? "Update QSO" : "Log QSO", systemImage: "checkmark.circle.fill") }
                    .buttonStyle(PrimaryActionStyle())
                    .keyboardShortcut(.return, modifiers: [.command])
            }
        }
        .onAppear { focusedLoggerField = .call }
    }

    private func compactTextField(
        _ title: String,
        placeholder: String,
        text: Binding<String>,
        field: LoggerField,
        next: LoggerField? = nil,
        submitLogs: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            FieldLabel(title: title)
            TextField(placeholder, text: text)
                .textFieldStyle(DarkTextFieldStyle())
                .focused($focusedLoggerField, equals: field)
                .submitLabel(submitLogs ? .done : .next)
                .onSubmit {
                    if submitLogs {
                        model.logQSO()
                        focusedLoggerField = .call
                    } else if let next {
                        focusedLoggerField = next
                    }
                }
        }
    }

    private func compactReferenceField(
        _ title: String,
        kind: ActivationReferenceKind,
        text: Binding<String>,
        field: LoggerField,
        next: LoggerField? = nil,
        submitLogs: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            FieldLabel(title: title)
            TextField(title == "Castle" ? "Castle / COTA" : title, text: text)
                .textFieldStyle(DarkTextFieldStyle())
                .focused($focusedLoggerField, equals: field)
                .submitLabel(submitLogs ? .done : .next)
                .onSubmit {
                    if submitLogs {
                        model.logQSO()
                        focusedLoggerField = .call
                    } else if let next {
                        focusedLoggerField = next
                    }
                }
            referenceConfirmation(kind: kind, value: text.wrappedValue)
        }
    }

    @ViewBuilder
    private func referenceConfirmation(kind: ActivationReferenceKind, value: String) -> some View {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        Group {
            if !normalized.isEmpty {
                if let match = model.activationReference(kind, value: normalized) {
                    HStack(spacing: 4) {
                        Label(match.name, systemImage: "checkmark.circle.fill")
                            .foregroundStyle(XLogTheme.teal)
                            .lineLimit(1)
                        if match.latitude != nil, match.longitude != nil {
                            Spacer(minLength: 0)
                            Button {
                                model.useActivationReferenceLocation(match)
                            } label: {
                                Image(systemName: "location.fill")
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(XLogTheme.cyan)
                            .help("Use \(match.reference) as this QSO's map target; rotor movement remains manual")
                        }
                    }
                    .help([match.reference, match.name, match.detail].filter { !$0.isEmpty }.joined(separator: " · "))
                } else if let suggestion = model.activationReferenceSuggestions(kind, value: normalized, limit: 1).first {
                    Label("\(suggestion.reference) · \(suggestion.name)", systemImage: "text.magnifyingglass")
                        .foregroundStyle(XLogTheme.cyan)
                } else if model.hasActivationDirectory(kind) {
                    Label("No match · value kept", systemImage: "questionmark.circle")
                        .foregroundStyle(XLogTheme.amber)
                } else {
                    Label(kind == .castle ? "WCA source unavailable · value kept" : "Directory unavailable · value kept", systemImage: "externaldrive.badge.questionmark")
                        .foregroundStyle(XLogTheme.secondary)
                }
            } else {
                Text(" ")
            }
        }
        .font(.system(size: 9, weight: .semibold))
        .lineLimit(1)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func compactDatePicker(_ title: String, components: DatePickerComponents) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            FieldLabel(title: title)
            DatePicker(title, selection: $model.draft.timestamp, displayedComponents: components)
                .labelsHidden()
                .datePickerStyle(.field)
                .environment(\.timeZone, TimeZone(secondsFromGMT: 0)!)
        }
    }

    @ViewBuilder private var compactRadioField: some View {
        VStack(alignment: .leading, spacing: 3) {
            FieldLabel(title: "Frequency MHz")
            if model.radioSnapshot != nil, !model.isEditing {
                readOnlyRadioValue(model.draft.frequency, width: 120)
            } else {
                TextField("14.074000", text: $model.draft.frequency)
                    .textFieldStyle(DarkTextFieldStyle())
                    .font(.system(.body, design: .monospaced).weight(.semibold))
                    .foregroundStyle(.white)
                    .focused($focusedLoggerField, equals: .frequency)
                    .submitLabel(.next)
                    .onSubmit { focusedLoggerField = .rstSent }
                    .frame(width: 120)
                    .onChange(of: model.draft.frequency) { value in
                        if let hz = BandPlan.frequencyHz(from: value) {
                            let band = BandPlan.band(for: hz)
                            if !band.isEmpty { model.draft.band = band }
                        }
                    }
            }
        }
    }

    @ViewBuilder private var compactBandField: some View {
        VStack(alignment: .leading, spacing: 3) {
            FieldLabel(title: "Band")
            if model.radioSnapshot != nil, !model.isEditing {
                readOnlyRadioValue(model.draft.band, width: 66)
            } else {
                Picker("Band", selection: $model.draft.band) {
                    ForEach(BandPlan.bands, id: \.self) { Text($0).tag($0) }
                }.labelsHidden().frame(width: 66)
            }
        }
    }

    @ViewBuilder private var compactModeField: some View {
        VStack(alignment: .leading, spacing: 3) {
            FieldLabel(title: "Mode")
            if model.radioSnapshot != nil, !model.isEditing {
                readOnlyRadioValue(model.draft.mode, width: 72)
            } else {
                Picker("Mode", selection: $model.draft.mode) {
                    ForEach(BandPlan.modes, id: \.self) { Text($0).tag($0) }
                }.labelsHidden().frame(width: 72)
            }
        }
    }

    private func readOnlyRadioValue(_ value: String, width: CGFloat) -> some View {
        Text(value.isEmpty ? "—" : value)
            .font(.system(.body, design: .monospaced).weight(.semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .padding(.horizontal, 9)
            .frame(width: width, alignment: .leading)
            .frame(minHeight: 30)
            .background(XLogTheme.raised)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(XLogTheme.cyan.opacity(0.5)))
            .accessibilityLabel("Live radio value \(value)")
    }

    private var compactIntelligence: some View {
        let call = model.draft.call.trimmingCharacters(in: .whitespacesAndNewlines)
        let lookup = intelligenceLookupState
        let workedCount = model.previous.count
        let confirmedCount = model.previous.filter(\.isConfirmed).count
        let solution = model.currentRotorSolution
        return Panel(title: "Callsign & DXCC intelligence", symbol: "person.text.rectangle") {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(call.isEmpty ? "ENTER CALLSIGN" : call)
                        .font(.system(size: 25, weight: .bold, design: .monospaced))
                        .foregroundStyle(call.isEmpty ? XLogTheme.secondary : XLogTheme.teal)
                        .lineLimit(1)
                    Text(model.draft.name.isEmpty ? (model.draft.country.isEmpty ? "Waiting for a callsign" : model.draft.country) : model.draft.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(XLogTheme.text)
                        .lineLimit(1)
                    if !model.draft.name.isEmpty {
                        Text(model.draft.country.isEmpty ? "Country unresolved" : model.draft.country)
                            .font(.caption).foregroundStyle(XLogTheme.secondary).lineLimit(1)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 5) {
                    Text(lookup.label)
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(lookup.color)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(lookup.color.opacity(0.12))
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(lookup.color.opacity(0.28)))
                    Text(model.dxLocationSource.label.uppercased())
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .foregroundStyle(XLogTheme.secondary)
                }
            }

            HStack(spacing: 6) {
                IntelligenceFact(title: "DXCC", value: model.draft.dxcc.isEmpty ? "—" : "#\(model.draft.dxcc)", tint: XLogTheme.orange)
                IntelligenceFact(title: "GRID", value: model.draft.gridSquare.isEmpty ? "—" : model.draft.gridSquare.uppercased(), tint: XLogTheme.cyan)
                IntelligenceFact(title: "CONT", value: model.draft.continent.isEmpty ? "—" : model.draft.continent.uppercased(), tint: XLogTheme.pink)
                IntelligenceFact(title: "ZONES", value: "CQ \(model.draft.cqZone.isEmpty ? "—" : model.draft.cqZone) · ITU \(model.draft.ituZone.isEmpty ? "—" : model.draft.ituZone)", tint: XLogTheme.amber)
                IntelligenceFact(title: "DISTANCE", value: solution.map { "\(Int($0.distanceKilometres.rounded()).formatted()) km" } ?? "—", tint: XLogTheme.teal)
            }

            HStack(alignment: .top, spacing: 8) {
                IntelligenceMatrix(
                    title: "CALLSIGN",
                    subtitle: "\(workedCount) worked · \(confirmedCount) confirmed",
                    bands: model.intelligenceBands,
                    matrix: model.matrix,
                    accent: XLogTheme.cyan
                )
                Rectangle().fill(XLogTheme.rule).frame(width: 1, height: 56)
                IntelligenceMatrix(
                    title: "DXCC \(model.draft.dxcc.isEmpty ? "" : "#\(model.draft.dxcc)")",
                    subtitle: "\(model.dxccSummary.qsoCount) worked · \(model.dxccSummary.confirmedCount) confirmed",
                    bands: model.intelligenceBands,
                    matrix: model.dxccSummary.matrix,
                    accent: XLogTheme.orange
                )
            }

            HStack(spacing: 8) {
                Text(model.previous.first.map { "CALL LAST · \($0.start.formatted(date: .abbreviated, time: .shortened)) · \($0.band.uppercased()) \($0.submode.isEmpty ? $0.mode : $0.submode)" } ?? "CALL · NEW")
                    .lineLimit(1)
                Spacer()
                Text(model.dxccSummary.latest.map { "DXCC LAST · \($0.start.formatted(date: .abbreviated, time: .shortened))" } ?? "DXCC · NOT WORKED")
                    .lineLimit(1)
            }
            .font(.system(size: 10, weight: .semibold, design: .rounded))
            .foregroundStyle(XLogTheme.secondary)
        }
    }

    private var intelligenceLookupState: (label: String, color: Color) {
        if model.draft.call.isEmpty { return ("AWAITING CALL", XLogTheme.secondary) }
        if model.lookupStatus == "Waiting…" { return ("QRZ LOOKUP…", XLogTheme.amber) }
        if model.lookupStatus == "QRZ matched" { return ("QRZ VERIFIED", XLogTheme.teal) }
        if model.lookupStatus == "QRZ unavailable", !model.draft.dxcc.isEmpty { return ("QRZ OFFLINE · CTY", XLogTheme.amber) }
        if !model.draft.dxcc.isEmpty { return ("CTY RESOLVED", XLogTheme.cyan) }
        return ("UNRESOLVED", XLogTheme.danger)
    }

    private var compactRotor: some View {
        let rotor = model.stationSnapshot?.rotor
        let solution = model.currentRotorSolution
        let bearing = model.currentRotorBearing
        let targetCall = model.draft.call.isEmpty ? "NO DX TARGET" : model.draft.call
        let pathColor = model.rotorPath == .shortPath ? XLogTheme.cyan : XLogTheme.pink
        return Panel(title: "Rotor", symbol: "location.north.circle") {
            VStack(spacing: 10) {
                HStack(spacing: 16) {
                    CompactRotorDial(
                        azimuth: rotor?.azimuth,
                        target: bearing ?? rotor?.targetBearing,
                        isMoving: rotor?.isMoving == true
                    )
                    .frame(width: 166, height: 166)

                    VStack(alignment: .leading, spacing: 7) {
                        HStack(spacing: 5) {
                            Circle().fill(rotor?.connected == true ? XLogTheme.teal : XLogTheme.danger).frame(width: 7, height: 7)
                            Text(rotor?.connected == true ? (rotor?.isMoving == true ? "TURNING" : "ROTOR READY") : "ROTOR OFFLINE")
                                .font(.system(size: 10, weight: .bold, design: .rounded))
                                .foregroundStyle(rotor?.connected == true ? XLogTheme.teal : XLogTheme.danger)
                        }
                        Text(targetCall)
                            .font(.system(size: 20, weight: .bold, design: .monospaced))
                            .foregroundStyle(model.draft.call.isEmpty ? XLogTheme.secondary : XLogTheme.text)
                            .lineLimit(1)
                        Text(model.draft.gridSquare.isEmpty ? model.dxLocationSource.label : "\(model.draft.gridSquare.uppercased()) · \(model.dxLocationSource.label)")
                            .font(.system(size: 10, weight: .medium)).foregroundStyle(XLogTheme.secondary).lineLimit(1)
                        HStack(alignment: .firstTextBaseline, spacing: 7) {
                            Text(rotor?.azimuth.map { String(format: "%03.0f°", $0) } ?? "---°")
                                .font(.system(size: 35, weight: .bold, design: .rounded))
                                .foregroundStyle(XLogTheme.cyan).monospacedDigit()
                            Text("CURRENT").font(.system(size: 9, weight: .bold)).foregroundStyle(XLogTheme.secondary)
                        }
                        HStack(spacing: 7) {
                            Text(bearing.map { String(format: "%@ %03.0f°", model.rotorPath.rawValue, $0) } ?? "\(model.rotorPath.rawValue) ---°")
                                .font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(pathColor).monospacedDigit()
                            Text(solution.map { "\(Int($0.distanceKilometres.rounded()).formatted()) km" } ?? "— km")
                                .font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(XLogTheme.secondary)
                        }
                        Text(rotorStatusText(rotor: rotor, target: bearing))
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(rotor?.isMoving == true ? XLogTheme.amber : XLogTheme.secondary)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)

                HStack(spacing: 7) {
                    rotorPathButton(.shortPath)
                    rotorPathButton(.longPath)
                    Button { model.performStationAction("rotor_stop") } label: {
                        Label("Stop", systemImage: "stop.fill").frame(maxWidth: .infinity)
                    }
                        .disabled(rotor?.connected != true || model.stationSnapshot?.station.allowedActions.contains("rotor_stop") != true)
                        .tint(XLogTheme.danger)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder
    private func rotorPathButton(_ path: RotorPathSelection) -> some View {
        let solution = model.currentRotorSolution
        let bearing = path == .shortPath ? solution?.shortPathBearing : solution?.longPathBearing
        Button {
            model.turnRotorToCurrentDX(path: path)
        } label: {
            Text(bearing.map { String(format: "%@ · %03.0f°", path.rawValue, $0) } ?? path.rawValue)
                .monospacedDigit().frame(maxWidth: .infinity)
        }
        .tint(model.rotorPath == path ? (path == .shortPath ? XLogTheme.cyan : XLogTheme.pink) : XLogTheme.raised)
        .disabled(
            bearing == nil
                || model.stationSnapshot?.rotor.connected != true
                || model.stationSnapshot?.station.allowedActions.contains("rotor_goto") != true
        )
        .help("Turn the rotor via \(path.title)")
    }

    private func rotorStatusText(rotor: XCatStationSnapshot.Rotor?, target: Double?) -> String {
        guard let rotor else { return model.stationStatus }
        if rotor.isMoving { return rotor.status }
        guard let azimuth = rotor.azimuth, let target else { return rotor.status }
        let raw = abs(azimuth - target).truncatingRemainder(dividingBy: 360)
        let delta = min(raw, 360 - raw)
        return delta < 2 ? "ON TARGET · \(rotor.status)" : String(format: "%.0f° TO TARGET · %@", delta, rotor.status)
    }

}

private struct CompactRotorDial: View {
    let azimuth: Double?
    let target: Double?
    let isMoving: Bool

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            ZStack {
                Circle().fill(
                    RadialGradient(colors: [XLogTheme.raised, XLogTheme.background], center: .center, startRadius: 4, endRadius: side * 0.52)
                )
                Circle().stroke(XLogTheme.cyan.opacity(0.35), lineWidth: 1.5)
                Circle().stroke(XLogTheme.rule.opacity(0.7), lineWidth: 1).padding(side * 0.12)
                ForEach(0..<36, id: \.self) { index in
                    Capsule()
                        .fill(index.isMultiple(of: 9) ? XLogTheme.cyan : XLogTheme.secondary.opacity(index.isMultiple(of: 3) ? 0.65 : 0.3))
                        .frame(width: index.isMultiple(of: 3) ? 2 : 1, height: index.isMultiple(of: 3) ? 8 : 5)
                        .offset(y: -side * 0.43)
                        .rotationEffect(.degrees(Double(index) * 10))
                }
                Text("N").offset(y: -side * 0.32)
                Text("E").offset(x: side * 0.32)
                Text("S").offset(y: side * 0.32)
                Text("W").offset(x: -side * 0.32)
                if let target {
                    Capsule().fill(XLogTheme.pink)
                        .frame(width: 2.5, height: side * 0.38)
                        .offset(y: -side * 0.19)
                        .rotationEffect(.degrees(target))
                        .shadow(color: XLogTheme.pink.opacity(0.45), radius: 3)
                }
                if let azimuth {
                    Capsule().fill(isMoving ? XLogTheme.amber : XLogTheme.cyan)
                        .frame(width: 6, height: side * 0.44)
                        .offset(y: -side * 0.20)
                        .rotationEffect(.degrees(azimuth))
                        .shadow(color: XLogTheme.cyan.opacity(0.45), radius: 3)
                }
                Circle().fill(XLogTheme.background).frame(width: 17, height: 17)
                Circle().fill(isMoving ? XLogTheme.amber : XLogTheme.teal).frame(width: 9, height: 9)
            }
            .font(.system(size: 9, weight: .bold, design: .rounded))
            .foregroundStyle(XLogTheme.secondary)
            .frame(width: side, height: side)
            .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
        }
        .accessibilityLabel("Rotor heading \(azimuth.map { String(format: "%.0f degrees", $0) } ?? "unavailable")")
    }
}

private struct IntelligenceFact: View {
    let title: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.system(size: 8, weight: .bold, design: .rounded)).foregroundStyle(XLogTheme.secondary)
            Text(value).font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundStyle(tint).lineLimit(1)
        }
        .padding(.horizontal, 7).padding(.vertical, 5)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(XLogTheme.raised)
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(XLogTheme.rule.opacity(0.8)))
    }
}

private struct IntelligenceBandCell: View {
    let band: String
    let worked: Bool
    let confirmed: Bool

    private var color: Color { confirmed ? XLogTheme.teal : worked ? XLogTheme.orange : XLogTheme.secondary }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: confirmed ? "checkmark.circle.fill" : worked ? "circle.fill" : "minus")
                .font(.system(size: 9, weight: .bold))
            Text(band).font(.system(size: 10, weight: .bold, design: .rounded))
        }
        .foregroundStyle(worked || confirmed ? color : color.opacity(0.58))
        .frame(maxWidth: .infinity, minHeight: 23)
        .background(color.opacity(confirmed ? 0.12 : worked ? 0.09 : 0.035))
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(color.opacity(worked || confirmed ? 0.25 : 0.08)))
        .accessibilityLabel("\(band), \(confirmed ? "confirmed" : worked ? "worked" : "not worked")")
    }
}

private struct IntelligenceMatrix: View {
    let title: String
    let subtitle: String
    let bands: [String]
    let matrix: Set<BandModeCell>
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Text(title).font(.system(size: 9, weight: .bold, design: .rounded)).foregroundStyle(accent)
                Text(subtitle).font(.system(size: 8, weight: .semibold, design: .rounded)).foregroundStyle(XLogTheme.secondary).lineLimit(1)
            }
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: min(5, max(1, bands.count))),
                spacing: 4
            ) {
                ForEach(bands, id: \.self) { band in
                    let matches = matrix.filter { $0.band == band }
                    IntelligenceBandCell(
                        band: band,
                        worked: !matches.isEmpty,
                        confirmed: matches.contains(where: \.confirmed)
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct WorldMapView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow
    var compact = false
    @State private var overlayMode: DXCCOverlayMode = .both
    @State private var mapStyle: RadioMapStyle = .hybrid
    @State private var showSun = true
    @State private var showGrayline = true
    @State private var solarDate = Date()
    private let solarTimer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()

    private var stationCoordinate: CLLocationCoordinate2D? {
        MaidenheadLocator.coordinate(model.settings.gridSquare).map {
            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
        }
    }

    private var activeDXCoordinate: CLLocationCoordinate2D? {
        guard let latitude = model.dxLatitude, let longitude = model.dxLongitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    private var mappedSpots: [ClusterSpot] {
        model.clusterSpots.filter { model.bandMapBands.contains($0.band) }
    }

    private var routeSolution: GreatCircleSolution? {
        guard let stationCoordinate, let activeDXCoordinate else { return nil }
        return GreatCircle.solve(
            from: GeoCoordinate(latitude: stationCoordinate.latitude, longitude: stationCoordinate.longitude),
            to: GeoCoordinate(latitude: activeDXCoordinate.latitude, longitude: activeDXCoordinate.longitude)
        )
    }

    private var routeCoordinates: [CLLocationCoordinate2D]? {
        guard let stationCoordinate, let activeDXCoordinate else { return nil }
        return GreatCircle.route(
            from: GeoCoordinate(latitude: stationCoordinate.latitude, longitude: stationCoordinate.longitude),
            to: GeoCoordinate(latitude: activeDXCoordinate.latitude, longitude: activeDXCoordinate.longitude),
            longPath: model.rotorPath == .longPath
        ).map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
    }

    private var solarState: SolarMapState { SolarEphemeris.state(at: solarDate) }

    private var graylineCoordinates: [CLLocationCoordinate2D]? {
        guard showGrayline else { return nil }
        return solarState.terminator.map {
            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
        }
    }

    private var dxccStatusByADIF: [Int: DXCCMapStatus] {
        var statuses: [Int: DXCCMapStatus] = [:]
        for qso in model.qsos {
            guard let adif = qso.dxcc else { continue }
            if qso.isConfirmed {
                statuses[adif] = .confirmed
            } else if statuses[adif] == nil {
                statuses[adif] = .worked
            }
        }
        return statuses
    }

    private var boundaries: [DXCCMapBoundary] {
        guard overlayMode != .spots else { return [] }
        let statuses = dxccStatusByADIF
        return model.dxccBoundaries.map { boundary in
            let status = statuses[boundary.adif] ?? .needed
            return DXCCMapBoundary(adif: boundary.adif, polygons: boundary.polygons, colorHex: status.colorHex)
        }
    }

    private var points: [SpotMapPoint] {
        var result: [SpotMapPoint] = []
        if overlayMode != .dxcc {
            var seenSpotIDs = Set<String>()
            result += mappedSpots.prefix(250).compactMap { spot -> SpotMapPoint? in
                guard let latitude = spot.latitude, let longitude = spot.longitude else { return nil }
                // xCluster snapshots may assign a fresh UUID to the same on-air station.
                // The map deliberately represents one location per callsign, so use the
                // callsign as its durable visual identity and update the annotation in place.
                let stableID = "spot-\(spot.callsign.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())"
                guard seenSpotIDs.insert(stableID).inserted else { return nil }
                return SpotMapPoint(
                    id: stableID,
                    coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
                    title: spot.callsign,
                    subtitle: "\(spot.band) · \(spot.mode) · \(spot.callStatus)",
                    colorHex: spot.bandHex,
                    labelColorHex: spot.statusHex,
                    spot: spot,
                    kind: .spot
                )
            }
        }
        if overlayMode != .spots {
            let statuses = dxccStatusByADIF
            let prefixes = Dictionary(uniqueKeysWithValues: model.dxccBoundaries.map { ($0.adif, $0.prefix) })
            result += model.dxccEntities.compactMap { entity -> SpotMapPoint? in
                let status = statuses[entity.adif] ?? .needed
                let fullPrefix = prefixes[entity.adif]?.replacingOccurrences(of: "_", with: "/") ?? ""
                let prefix = conciseDXCCPrefix(fullPrefix)
                guard !prefix.isEmpty else { return nil }
                return SpotMapPoint(
                    id: "dxcc-\(entity.adif)",
                    coordinate: CLLocationCoordinate2D(latitude: entity.latitude ?? 0, longitude: entity.longitude ?? 0),
                    title: prefix,
                    subtitle: "\(entity.name.capitalized) · DXCC \(entity.adif) · \(status.label) · \(fullPrefix)",
                    colorHex: status.colorHex,
                    labelColorHex: status.colorHex,
                    spot: nil,
                    kind: .dxcc
                )
            }
        }
        if let coordinate = stationCoordinate {
            result.append(SpotMapPoint(
                id: "station",
                coordinate: coordinate,
                title: model.settings.stationCall.isEmpty ? "My station" : model.settings.stationCall,
                subtitle: model.settings.gridSquare,
                colorHex: "#12D6A0",
                labelColorHex: nil,
                spot: nil,
                kind: .station
            ))
        }
        if let activeDXCoordinate, !model.draft.call.isEmpty {
            result.append(SpotMapPoint(
                id: "active-dx",
                coordinate: activeDXCoordinate,
                title: model.draft.call,
                subtitle: model.draft.country,
                colorHex: "#F3B23C",
                labelColorHex: nil,
                spot: nil,
                kind: .activeDX
            ))
        }
        if showSun {
            result.append(SpotMapPoint(
                id: "subsolar-point",
                coordinate: CLLocationCoordinate2D(
                    latitude: solarState.subsolarPoint.latitude,
                    longitude: solarState.subsolarPoint.longitude
                ),
                title: "Sun",
                subtitle: String(
                    format: "Subsolar point · %.1f° %@ · %.1f° %@",
                    abs(solarState.subsolarPoint.latitude),
                    solarState.subsolarPoint.latitude >= 0 ? "N" : "S",
                    abs(solarState.subsolarPoint.longitude),
                    solarState.subsolarPoint.longitude >= 0 ? "E" : "W"
                ),
                colorHex: "#FFD75A",
                labelColorHex: nil,
                spot: nil,
                kind: .sun
            ))
        }
        return result
    }

    private func conciseDXCCPrefix(_ value: String) -> String {
        let primaryGroup = value
            .split(separator: ",", maxSplits: 1)
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return primaryGroup
            .split(separator: "-", maxSplits: 1)
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? primaryGroup
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("World map").font(compact ? .headline : .title2.bold())
                    if !compact { Text("Live xCluster entities in the same status colours used by the spot table.").font(.caption).foregroundStyle(XLogTheme.secondary) }
                }
                Spacer()
                Menu {
                    ForEach(MapDisplayPreset.allCases) { preset in
                        Button {
                            model.setMapDisplayPreset(preset)
                            applyMapPreset(preset)
                        } label: {
                            Label(preset.rawValue, systemImage: preset == model.mapDisplayPreset ? "checkmark" : "map")
                        }
                    }
                } label: {
                    Label(model.mapDisplayPreset.rawValue, systemImage: "slider.horizontal.3")
                }
                .help("Apply a saved map-density preset")
                .fixedSize()
                Menu(overlayMode.rawValue) {
                    ForEach(DXCCOverlayMode.allCases) { mode in Button(mode.rawValue) { overlayMode = mode } }
                }
                .help("Choose live spots, the DXCC entity overlay, or both")
                .fixedSize()
                Menu(mapStyle.rawValue) {
                    ForEach(RadioMapStyle.allCases) { style in Button(style.rawValue) { mapStyle = style } }
                }
                .help("Choose the map appearance")
                .fixedSize()
                Button { showSun.toggle() } label: {
                    Image(systemName: showSun ? "sun.max.fill" : "sun.max")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .tint(showSun ? XLogTheme.amber : XLogTheme.secondary)
                .help(showSun ? "Hide the current subsolar point" : "Show the current subsolar point")
                .accessibilityLabel(showSun ? "Hide Sun position" : "Show Sun position")
                Button { showGrayline.toggle() } label: {
                    Image(systemName: showGrayline ? "circle.lefthalf.filled" : "circle")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .tint(showGrayline ? XLogTheme.secondary : XLogTheme.secondary.opacity(0.65))
                .help(showGrayline ? "Hide the day/night greyline" : "Show the day/night greyline")
                .accessibilityLabel(showGrayline ? "Hide greyline" : "Show greyline")
                Label("\(mappedSpots.count) mapped", systemImage: "mappin.and.ellipse")
                    .foregroundStyle(XLogTheme.cyan)
                if compact {
                    Button { openWindow(id: "world-map") } label: { Image(systemName: "macwindow.on.rectangle") }
                        .help("Open World Map in a separate window")
                } else {
                    Button("Band maps") { model.destination = .bandMaps }
                }
            }
            .padding(compact ? 9 : 14).background(XLogTheme.surface)
            .overlay(alignment: .bottom) { Rectangle().fill(XLogTheme.rule).frame(height: 1) }

            ZStack(alignment: .bottomLeading) {
                RadioMapView(
                    points: points,
                    boundaries: boundaries,
                    route: routeCoordinates,
                    routeIsLongPath: model.rotorPath == .longPath,
                    grayline: graylineCoordinates,
                    mapType: mapStyle.mapType,
                    initialCenter: stationCoordinate,
                    select: model.openClusterSpot
                ).ignoresSafeArea(edges: .bottom)

                VStack(alignment: .leading, spacing: 6) {
                    if let routeSolution {
                        Text(String(
                            format: "%@ · %@ selected · %.0f km · SP %03.0f° · LP %03.0f°",
                            model.draft.call,
                            model.rotorPath.rawValue,
                            routeSolution.distanceKilometres,
                            routeSolution.shortPathBearing,
                            routeSolution.longPathBearing
                        ))
                            .font(.caption.bold()).foregroundStyle(XLogTheme.text)
                    } else if stationCoordinate == nil {
                        Text("Set your station grid in Settings to draw accurate DX paths.")
                            .font(.caption).foregroundStyle(XLogTheme.amber)
                    }
                    HStack(spacing: 12) {
                        if overlayMode != .dxcc {
                            ForEach(activeBandLegend) { item in legend(item.band, item.hex) }
                        }
                        if overlayMode != .spots {
                            legend("Needed", "#8FB3D9"); legend("Worked", "#FF9D2E"); legend("Confirmed", "#12D6A0")
                        }
                        if showSun { legend("Sun", "#FFD75A") }
                        if showGrayline { legend("Greyline", "#A9B6C8") }
                    }
                }
                .padding(10).background(Color(hex: "#07111F").opacity(0.9))
                .clipShape(RoundedRectangle(cornerRadius: 8)).padding(12)
            }
        }
        .onReceive(solarTimer) { solarDate = $0 }
        .onAppear { applyMapPreset(model.mapDisplayPreset) }
        .onChange(of: model.mapDisplayPreset) { applyMapPreset($0) }
    }

    private func applyMapPreset(_ preset: MapDisplayPreset) {
        switch preset {
        case .simple:
            overlayMode = .spots
            showSun = false
            showGrayline = false
        case .detailed:
            overlayMode = .both
            showSun = true
            showGrayline = true
        case .dx:
            overlayMode = .dxcc
            showSun = true
            showGrayline = true
        }
    }

    private func legend(_ title: String, _ hex: String) -> some View {
        Label(title, systemImage: "circle.fill").font(.caption2).foregroundStyle(Color(hex: hex))
    }

    private var activeBandLegend: [BandLegendItem] {
        let values = model.bandMapBands.compactMap { band in
            model.clusterSpots.first(where: { $0.band == band }).map { BandLegendItem(band: band, hex: $0.bandHex) }
        }
        return Array(values.prefix(compact ? 5 : 9))
    }
}

private struct RadioMapView: NSViewRepresentable {
    let points: [SpotMapPoint]
    let boundaries: [DXCCMapBoundary]
    let route: [CLLocationCoordinate2D]?
    let routeIsLongPath: Bool
    let grayline: [CLLocationCoordinate2D]?
    let mapType: MKMapType
    let initialCenter: CLLocationCoordinate2D?
    let select: (ClusterSpot) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(select: select) }

    func makeNSView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.mapType = mapType
        map.showsCompass = true
        map.showsScale = true
        map.pointOfInterestFilter = .excludingAll
        map.setRegion(
            MKCoordinateRegion(
                center: initialCenter ?? CLLocationCoordinate2D(latitude: 12, longitude: 15),
                span: initialCenter == nil
                    ? MKCoordinateSpan(latitudeDelta: 130, longitudeDelta: 310)
                    : MKCoordinateSpan(latitudeDelta: 55, longitudeDelta: 95)
            ),
            animated: false
        )
        return map
    }

    func updateNSView(_ map: MKMapView, context: Context) {
        context.coordinator.select = select
        map.mapType = mapType
        context.coordinator.update(
            points: points,
            boundaries: boundaries,
            route: route,
            routeIsLongPath: routeIsLongPath,
            grayline: grayline,
            on: map
        )
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var select: (ClusterSpot) -> Void
        private var pointsByID: [String: SpotMapPoint] = [:]
        private var annotationsByID: [String: RadioMapAnnotation] = [:]
        private var visibleDXCCLabelIDs = Set<String>()
        private var labelLayoutSignature = ""
        private var boundarySignature = ""
        private var routeSignature = ""
        private var graylineSignature = ""
        private var routeIsLongPath = false
        private var routeOverlay: MKOverlay?
        private var graylineOverlays: [MKOverlay] = []
        private var boundaryOverlays: [MKOverlay] = []
        private var boundaryColors: [ObjectIdentifier: String] = [:]

        init(select: @escaping (ClusterSpot) -> Void) { self.select = select }

        func update(
            points: [SpotMapPoint],
            boundaries: [DXCCMapBoundary],
            route: [CLLocationCoordinate2D]?,
            routeIsLongPath: Bool,
            grayline: [CLLocationCoordinate2D]?,
            on map: MKMapView
        ) {
            let nextPoints = Dictionary(uniqueKeysWithValues: points.map { ($0.id, $0) })
            let removedIDs = Set(annotationsByID.keys).subtracting(nextPoints.keys)
            if !removedIDs.isEmpty {
                let removed = removedIDs.compactMap { annotationsByID.removeValue(forKey: $0) }
                map.removeAnnotations(removed)
            }
            var additions: [RadioMapAnnotation] = []
            for point in points {
                if let existing = annotationsByID[point.id] {
                    guard existing.renderSignature != point.renderSignature else { continue }
                    CATransaction.begin()
                    CATransaction.setDisableActions(true)
                    existing.update(from: point)
                    CATransaction.commit()
                    if let view = map.view(for: existing) as? RadioDotAnnotationView {
                        configure(view, for: existing, on: map)
                    }
                    continue
                }
                let annotation = RadioMapAnnotation(point)
                annotationsByID[point.id] = annotation
                additions.append(annotation)
            }
            if !additions.isEmpty {
                map.addAnnotations(additions)
            }
            pointsByID = nextPoints
            refreshDXCCLabelVisibility(on: map)
            let newBoundarySignature = boundaries.map { "\($0.adif):\($0.colorHex)" }.joined(separator: "|")
            if newBoundarySignature != boundarySignature {
                boundarySignature = newBoundarySignature
                map.removeOverlays(boundaryOverlays)
                boundaryOverlays.removeAll(keepingCapacity: true)
                boundaryColors.removeAll(keepingCapacity: true)
                for boundary in boundaries {
                    for polygon in boundary.polygons {
                        guard polygon.outerRing.count >= 4 else { continue }
                        let innerPolygons = polygon.innerRings.compactMap(Self.mapPolygon)
                        var outerCoordinates = polygon.outerRing.map {
                            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                        }
                        let overlay = MKPolygon(
                            coordinates: &outerCoordinates,
                            count: outerCoordinates.count,
                            interiorPolygons: innerPolygons.isEmpty ? nil : innerPolygons
                        )
                        boundaryOverlays.append(overlay)
                        boundaryColors[ObjectIdentifier(overlay)] = boundary.colorHex
                    }
                }
                map.addOverlays(boundaryOverlays, level: .aboveRoads)
            }
            let newRouteSignature = "\(routeIsLongPath)|" + (route?.map { "\($0.latitude),\($0.longitude)" }.joined(separator: "|") ?? "")
            if newRouteSignature != routeSignature {
                let hadRoute = !routeSignature.isEmpty
                routeSignature = newRouteSignature
                self.routeIsLongPath = routeIsLongPath
                if let routeOverlay { map.removeOverlay(routeOverlay) }
                routeOverlay = nil
                if var coordinates = route, coordinates.count >= 2 {
                    let path = RadioMapPolyline(coordinates: &coordinates, count: coordinates.count)
                    path.role = .route
                    routeOverlay = path
                    map.addOverlay(path, level: .aboveLabels)
                    fit(path: path, points: points, on: map, animated: hadRoute)
                }
            }
            let newGraylineSignature = grayline?.map {
                String(format: "%.3f,%.3f", $0.latitude, $0.longitude)
            }.joined(separator: "|") ?? ""
            if newGraylineSignature != graylineSignature {
                graylineSignature = newGraylineSignature
                map.removeOverlays(graylineOverlays)
                graylineOverlays.removeAll()
                for segment in Self.splitAtAntimeridian(grayline ?? []) where segment.count >= 2 {
                    var coordinates = segment
                    let band = RadioMapPolyline(coordinates: &coordinates, count: coordinates.count)
                    band.role = .graylineBand
                    let edge = RadioMapPolyline(coordinates: &coordinates, count: coordinates.count)
                    edge.role = .graylineEdge
                    graylineOverlays.append(contentsOf: [band, edge])
                }
                map.addOverlays(graylineOverlays, level: .aboveRoads)
            }
        }

        private static func splitAtAntimeridian(_ coordinates: [CLLocationCoordinate2D]) -> [[CLLocationCoordinate2D]] {
            guard var previous = coordinates.first else { return [] }
            var result: [[CLLocationCoordinate2D]] = [[previous]]
            for coordinate in coordinates.dropFirst() {
                if abs(coordinate.longitude - previous.longitude) > 180 {
                    result.append([coordinate])
                } else {
                    result[result.count - 1].append(coordinate)
                }
                previous = coordinate
            }
            return result
        }

        private static func mapPolygon(_ ring: [GeoCoordinate]) -> MKPolygon? {
            guard ring.count >= 4 else { return nil }
            var coordinates = ring.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            return MKPolygon(coordinates: &coordinates, count: coordinates.count)
        }

        private func fit(path: MKPolyline, points: [SpotMapPoint], on map: MKMapView, animated: Bool) {
            var visibleRect = path.boundingMapRect
            for point in points where point.kind == .station || point.kind == .activeDX {
                let mapPoint = MKMapPoint(point.coordinate)
                visibleRect = visibleRect.union(MKMapRect(x: mapPoint.x, y: mapPoint.y, width: 1, height: 1))
            }

            // A same-grid lookup produces a zero-size route. Keep enough context around it to be useful.
            let minimumSide = MKMapPointsPerMeterAtLatitude(points.first(where: { $0.kind == .station })?.coordinate.latitude ?? 0) * 250_000
            if visibleRect.width < minimumSide {
                visibleRect = visibleRect.insetBy(dx: -(minimumSide - visibleRect.width) / 2, dy: 0)
            }
            if visibleRect.height < minimumSide {
                visibleRect = visibleRect.insetBy(dx: 0, dy: -(minimumSide - visibleRect.height) / 2)
            }
            map.setVisibleMapRect(
                visibleRect,
                edgePadding: NSEdgeInsets(top: 54, left: 64, bottom: 86, right: 64),
                animated: animated
            )
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard let annotation = annotation as? RadioMapAnnotation else { return nil }
            let identifier = "radio-\(annotation.kind.rawValue)"
            let view = (mapView.dequeueReusableAnnotationView(withIdentifier: identifier) as? RadioDotAnnotationView)
                ?? RadioDotAnnotationView(annotation: annotation, reuseIdentifier: identifier)
            view.annotation = annotation
            configure(view, for: annotation, on: mapView)
            view.toolTip = [annotation.title, annotation.subtitle].compactMap { $0 }.joined(separator: " · ")
            return view
        }

        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            refreshDXCCLabelVisibility(on: mapView, force: true)
            for annotation in annotationsByID.values {
                guard let view = mapView.view(for: annotation) as? RadioDotAnnotationView else { continue }
                configure(view, for: annotation, on: mapView)
            }
        }

        private func configure(_ view: RadioDotAnnotationView, for annotation: RadioMapAnnotation, on mapView: MKMapView) {
            let showLabel: Bool
            switch annotation.kind {
            case .dxcc:
                showLabel = visibleDXCCLabelIDs.contains(annotation.pointID)
            case .spot:
                // Close-range spot labels remain fixed beside their dot. At wider
                // scales the dots carry the feed without a restless field of text.
                showLabel = mapView.region.span.longitudeDelta <= 25
            default:
                showLabel = false
            }
            view.apply(
                colorHex: annotation.colorHex,
                labelColorHex: annotation.labelColorHex,
                kind: annotation.kind,
                title: annotation.title ?? "",
                showLabel: showLabel
            )
            view.toolTip = [annotation.title, annotation.subtitle].compactMap { $0 }.joined(separator: " · ")
        }

        private func refreshDXCCLabelVisibility(on mapView: MKMapView, force: Bool = false) {
            let rect = mapView.visibleMapRect
            let dxccIDs = annotationsByID.values
                .filter { $0.kind == .dxcc }
                .map(\.pointID)
                .sorted()
            let signature = [
                String(format: "%.0f", rect.origin.x),
                String(format: "%.0f", rect.origin.y),
                String(format: "%.0f", rect.size.width),
                String(format: "%.0f", rect.size.height),
                dxccIDs.joined(separator: ","),
            ].joined(separator: "|")
            guard force || signature != labelLayoutSignature else { return }
            labelLayoutSignature = signature

            var occupied: [CGRect] = []
            var visible = Set<String>()
            let candidates = annotationsByID.values
                .filter { $0.kind == .dxcc && rect.contains(MKMapPoint($0.coordinate)) }
                .sorted { $0.pointID < $1.pointID }
            for annotation in candidates {
                let point = mapView.convert(annotation.coordinate, toPointTo: mapView)
                guard mapView.bounds.insetBy(dx: 8, dy: 8).contains(point) else { continue }
                // Reserve a conservative, fixed footprint. Selection depends only
                // on the camera and static DXCC coordinates, never on live spots.
                let footprint = CGRect(x: point.x - 7, y: point.y - 13, width: 88, height: 26)
                guard !occupied.contains(where: { $0.intersects(footprint) }) else { continue }
                visible.insert(annotation.pointID)
                occupied.append(footprint)
            }
            visibleDXCCLabelIDs = visible
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            guard let annotation = view.annotation as? RadioMapAnnotation,
                  let spot = pointsByID[annotation.pointID]?.spot else { return }
            select(spot)
            mapView.deselectAnnotation(annotation, animated: true)
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let polygon = overlay as? MKPolygon,
               let colorHex = boundaryColors[ObjectIdentifier(polygon)] {
                let color = NSColor(xlogHex: colorHex)
                let renderer = MKPolygonRenderer(polygon: polygon)
                renderer.fillColor = color.withAlphaComponent(colorHex == "#61758D" ? 0.07 : 0.12)
                renderer.strokeColor = color.withAlphaComponent(0.72)
                renderer.lineWidth = 0.85
                return renderer
            }
            guard let line = overlay as? RadioMapPolyline else { return MKOverlayRenderer(overlay: overlay) }
            let renderer = MKPolylineRenderer(polyline: line)
            switch line.role {
            case .route:
                renderer.strokeColor = routeIsLongPath
                    ? NSColor(calibratedRed: 0.96, green: 0.48, blue: 0.77, alpha: 0.95)
                    : NSColor(calibratedRed: 0.21, green: 0.78, blue: 0.96, alpha: 0.95)
                renderer.lineWidth = 3
                renderer.lineDashPattern = [8, 5]
            case .graylineBand:
                renderer.strokeColor = NSColor(calibratedRed: 0.03, green: 0.07, blue: 0.12, alpha: 0.42)
                renderer.lineWidth = 30
            case .graylineEdge:
                renderer.strokeColor = NSColor(calibratedRed: 0.66, green: 0.71, blue: 0.78, alpha: 0.78)
                renderer.lineWidth = 1.25
                renderer.lineDashPattern = [4, 5]
            }
            return renderer
        }
    }
}

private final class RadioMapPolyline: MKPolyline {
    enum Role { case route, graylineBand, graylineEdge }
    var role: Role = .route
}

private final class RadioMapAnnotation: NSObject, MKAnnotation {
    @objc dynamic var coordinate: CLLocationCoordinate2D
    let pointID: String
    var colorHex: String
    var labelColorHex: String?
    let kind: SpotMapPoint.Kind
    var renderSignature: String
    @objc dynamic var title: String?
    @objc dynamic var subtitle: String?

    init(_ point: SpotMapPoint) {
        coordinate = point.coordinate
        pointID = point.id
        colorHex = point.colorHex
        labelColorHex = point.labelColorHex
        kind = point.kind
        renderSignature = point.renderSignature
        title = point.title
        subtitle = point.subtitle
    }

    func update(from point: SpotMapPoint) {
        coordinate = point.coordinate
        colorHex = point.colorHex
        labelColorHex = point.labelColorHex
        renderSignature = point.renderSignature
        title = point.title
        subtitle = point.subtitle
    }
}

private final class RadioDotAnnotationView: MKAnnotationView {
    private let dotLayer = CALayer()
    private let entityLabel = NSTextField(labelWithString: "")
    private var appliedSignature = ""

    override init(annotation: MKAnnotation?, reuseIdentifier: String?) {
        super.init(annotation: annotation, reuseIdentifier: reuseIdentifier)
        wantsLayer = true
        layer?.addSublayer(dotLayer)
        entityLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        entityLabel.textColor = NSColor(xlogHex: "#35C8F5")
        entityLabel.drawsBackground = false
        entityLabel.backgroundColor = .clear
        entityLabel.isBordered = false
        entityLabel.alignment = .left
        entityLabel.lineBreakMode = .byTruncatingTail
        entityLabel.shadow = {
            let shadow = NSShadow()
            shadow.shadowColor = NSColor.black.withAlphaComponent(0.9)
            shadow.shadowBlurRadius = 2
            shadow.shadowOffset = NSSize(width: 0, height: -1)
            return shadow
        }()
        addSubview(entityLabel)
    }

    required init?(coder: NSCoder) { nil }

    override func prepareForReuse() {
        super.prepareForReuse()
        appliedSignature = ""
    }

    func apply(colorHex: String, labelColorHex: String?, kind: SpotMapPoint.Kind, title: String, showLabel: Bool) {
        let signature = [colorHex, labelColorHex ?? "", kind.rawValue, title, showLabel ? "1" : "0"].joined(separator: "|")
        guard signature != appliedSignature else { return }
        appliedSignature = signature

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }

        let size: CGFloat = kind == .sun ? 18 : (kind == .station || kind == .activeDX ? 16 : (kind == .spot ? 11 : 6))
        entityLabel.isHidden = !showLabel
        entityLabel.stringValue = title
        entityLabel.font = kind == .spot
            ? .monospacedSystemFont(ofSize: 13, weight: .semibold)
            : .systemFont(ofSize: 14, weight: .semibold)
        let requestedColor = NSColor(xlogHex: labelColorHex ?? colorHex)
        let semanticColor = requestedColor.xlogReadableMapLabelColor
        entityLabel.textColor = semanticColor
        if showLabel {
            let maximumWidth: CGFloat = kind == .spot ? 154 : 80
            let minimumWidth: CGFloat = kind == .spot ? 54 : 30
            let labelHeight: CGFloat = 21
            let labelWidth = min(maximumWidth, max(minimumWidth, entityLabel.intrinsicContentSize.width + 3))
            let labelOriginX = size + 4
            frame.size = NSSize(width: labelWidth + labelOriginX, height: labelHeight)
            centerOffset = NSPoint(x: frame.width / 2 - size / 2, y: 0)
            dotLayer.frame = CGRect(x: 0, y: (labelHeight - size) / 2, width: size, height: size)
            entityLabel.frame = CGRect(x: labelOriginX, y: 0, width: labelWidth, height: labelHeight)
            // MapKit's collision solver can change its answer every time a live
            // spot arrives. Visibility is chosen deterministically by Coordinator.
            collisionMode = .none
        } else {
            frame.size = NSSize(width: size, height: size)
            centerOffset = .zero
            dotLayer.frame = bounds
            collisionMode = .none
        }
        layer?.backgroundColor = NSColor.clear.cgColor
        dotLayer.cornerRadius = kind == .activeDX ? 2 : size / 2
        dotLayer.backgroundColor = NSColor(xlogHex: colorHex).cgColor
        dotLayer.borderColor = semanticColor.withAlphaComponent(0.95).cgColor
        dotLayer.borderWidth = kind == .dxcc ? 1 : (kind == .sun ? 2 : 1.5)
        dotLayer.shadowColor = (kind == .sun ? NSColor.systemYellow : NSColor.black).cgColor
        dotLayer.shadowOpacity = kind == .sun ? 0.9 : 0.7
        dotLayer.shadowRadius = kind == .sun ? 6 : 2
        displayPriority = .required
    }
}

private extension NSColor {
    convenience init(xlogHex: String) {
        let value = xlogHex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var number: UInt64 = 0
        Scanner(string: value).scanHexInt64(&number)
        self.init(
            calibratedRed: CGFloat((number >> 16) & 255) / 255,
            green: CGFloat((number >> 8) & 255) / 255,
            blue: CGFloat(number & 255) / 255,
            alpha: 1
        )
    }

    var xlogReadableMapLabelColor: NSColor {
        guard let rgb = usingColorSpace(.deviceRGB) else { return self }
        // White labels disappear among MapKit place names. Keep externally
        // supplied semantic colours, but replace near-white/neutral labels
        // with xLog's radio cyan so spots remain immediately identifiable.
        if rgb.redComponent > 0.78,
           rgb.greenComponent > 0.78,
           rgb.blueComponent > 0.78,
           abs(rgb.redComponent - rgb.greenComponent) < 0.08,
           abs(rgb.greenComponent - rgb.blueComponent) < 0.08 {
            return NSColor(xlogHex: "#35C8F5")
        }
        return rgb
    }
}

private enum ClusterStatusScope: String, CaseIterable, Identifiable {
    case all = "All spots"
    case needed = "Needed"
    case worked = "Worked"
    case confirmed = "Confirmed"
    case priority = "Priority"
    var id: String { rawValue }
}

private enum ClusterModeScope: String, CaseIterable, Identifiable {
    case all = "All modes"
    case cw = "CW"
    case phone = "Phone"
    case digital = "Digital"
    var id: String { rawValue }
}

struct BandMapsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow
    @State private var statusScope: ClusterStatusScope = .all
    @State private var modeScope: ClusterModeScope = .all
    @State private var spotSearch = ""
    @State private var selectedSpot: ClusterSpot?
    var compact = false
    private let columns = [GridItem(.adaptive(minimum: 320, maximum: 480), spacing: 12, alignment: .top)]

    private var bands: [String] { compact ? model.bandMapBands : model.detachedBandMapBands }
    private var detached: Bool { !compact }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Band maps").font(compact ? .headline : .title2.bold())
                    if !compact { Text("One map or the whole station view; click any spot to load and tune it.").font(.caption).foregroundStyle(XLogTheme.secondary) }
                }
                Spacer()
                if compact {
                    Toggle("Follow radio", isOn: Binding(
                        get: { model.deskBandMapFollowsRadio },
                        set: { model.setDeskBandMapFollowsRadio($0) }
                    ))
                    .toggleStyle(.checkbox)
                    .controlSize(.small)
                    .help("Keep the Operator Desk map on the radio's current band")
                }
                HStack(spacing: 5) {
                    Button { model.setBandMapFontScale(model.bandMapFontScale - 0.1) } label: {
                        Text("A−").fontWeight(.semibold)
                    }
                    .disabled(model.bandMapFontScale <= 0.8)
                    .accessibilityLabel("Decrease band map text size")
                    Text("\(Int(model.bandMapFontScale * 100))%")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(XLogTheme.secondary)
                        .frame(width: 38)
                    Button { model.setBandMapFontScale(model.bandMapFontScale + 0.1) } label: {
                        Text("A+").fontWeight(.semibold)
                    }
                    .disabled(model.bandMapFontScale >= 2)
                    .accessibilityLabel("Increase band map text size")
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
                .help("Band map text size. You can also set this in Settings → Band Maps.")
                if !compact {
                    Picker("Layout", selection: Binding(
                        get: { model.detachedBandMapLayout },
                        set: { model.setDetachedBandMapLayout($0) }
                    )) {
                        ForEach(BandMapLayout.allCases) { layout in Text(layout.rawValue).tag(layout) }
                    }
                    .labelsHidden()
                    .pickerStyle(.segmented)
                    .frame(width: 190)
                    .help("Keep every map in one horizontal row or wrap maps into an adaptive grid")
                }
                Menu {
                    Button("All bands") { model.showAllBandMaps(detached: detached) }
                    Divider()
                    ForEach(BandPlan.bands.filter { !bands.contains($0) }, id: \.self) { band in
                        Button(band) { model.addBandMap(band, detached: detached) }
                    }
                } label: { Label("Add band map", systemImage: "plus") }
                .fixedSize()
                if compact {
                    Button { openWindow(id: "band-maps") } label: { Image(systemName: "macwindow.on.rectangle") }
                        .help("Open Band Maps in a separate window")
                } else {
                    Button("World map") { model.destination = .map }
                }
            }
            .padding(compact ? 9 : 14).background(XLogTheme.surface)
            .overlay(alignment: .bottom) { Rectangle().fill(XLogTheme.rule).frame(height: 1) }

            if !compact { clusterIntelligenceBar }

            if model.clusterFeedUpdatedAt == nil {
                VStack(spacing: 12) {
                    Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: 38)).foregroundStyle(XLogTheme.secondary)
                    Text("Waiting for OM0RX-xCluster").font(.title3.bold())
                    Text("Start xCluster 0.1.6 or newer. Its classified spot feed stays local to this Mac.")
                        .foregroundStyle(XLogTheme.secondary)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                if compact {
                    GeometryReader { proxy in
                        ScrollView(.horizontal) {
                            HStack(spacing: 10) { bandPanels(width: bands.count == 1 ? max(320, proxy.size.width - 20) : 320) }.padding(10)
                        }
                    }
                } else if bands.count == 1, let band = bands.first {
                    GeometryReader { proxy in
                        BandMapPanel(
                            band: band,
                            spots: spots(for: band),
                            remove: { model.removeBandMap(band, detached: detached) },
                            select: inspectAndOpen,
                            fontScale: model.bandMapFontScale,
                            preferredContainerHeight: max(430, proxy.size.height - 28)
                        )
                        .frame(width: max(320, proxy.size.width - 28), height: max(430, proxy.size.height - 28))
                        .padding(14)
                    }
                } else if model.detachedBandMapLayout == .singleRow {
                    GeometryReader { proxy in
                        let widthPerMap = max(
                            240 + 80 * CGFloat(max(0, model.bandMapFontScale - 1)),
                            (proxy.size.width - 28 - CGFloat(max(0, bands.count - 1)) * 12) / CGFloat(max(1, bands.count))
                        )
                        ScrollView(.horizontal) {
                            HStack(spacing: 12) {
                                bandPanels(width: widthPerMap, minimumHeight: max(528, proxy.size.height - 28))
                            }
                            .padding(14)
                        }
                    }
                } else {
                    GeometryReader { proxy in
                        let usableWidth = max(320, proxy.size.width - 28)
                        let columnCount = max(1, Int((usableWidth + 12) / (320 + 12)))
                        let rowCount = max(1, Int(ceil(Double(bands.count) / Double(columnCount))))
                        let rowSpacing = CGFloat(max(0, rowCount - 1)) * 12
                        let usableHeight = max(0, proxy.size.height - 28 - rowSpacing)
                        let scale = CGFloat(model.bandMapFontScale)
                        let minimumPanelHeight = 260 + max(38, 24 + 12 * scale) + max(32, 16 + 18 * scale) + max(28, 14 + 12 * scale)
                        let panelHeight = max(minimumPanelHeight, usableHeight / CGFloat(rowCount))
                        ScrollView {
                            LazyVGrid(columns: columns, spacing: 12) {
                                bandPanels(width: nil, minimumHeight: panelHeight)
                            }
                            .padding(14)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func bandPanels(width: CGFloat?, minimumHeight: CGFloat = 0) -> some View {
        ForEach(bands, id: \.self) { band in
            BandMapPanel(
                band: band,
                spots: spots(for: band),
                remove: { model.removeBandMap(band, detached: detached) },
                select: inspectAndOpen,
                allowsVerticalResize: !compact && bands.count > 1,
                fontScale: model.bandMapFontScale,
                preferredContainerHeight: minimumHeight > 0 ? minimumHeight : nil
            )
            .frame(width: width)
            .frame(minHeight: minimumHeight)
        }
    }

    private var clusterIntelligenceBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "scope").foregroundStyle(XLogTheme.cyan)
            TextField("Call, country or note", text: $spotSearch)
                .textFieldStyle(DarkTextFieldStyle()).frame(width: 190)
            Picker("Status", selection: $statusScope) {
                ForEach(ClusterStatusScope.allCases) { Text($0.rawValue).tag($0) }
            }
            .labelsHidden().frame(width: 120)
            Picker("Mode", selection: $modeScope) {
                ForEach(ClusterModeScope.allCases) { Text($0.rawValue).tag($0) }
            }
            .labelsHidden().frame(width: 110)
            Text("\(filteredSpots.count) of \(model.clusterSpots.count)")
                .font(.caption.monospacedDigit()).foregroundStyle(XLogTheme.secondary)
            Rectangle().fill(XLogTheme.rule).frame(width: 1, height: 32)
            if let spot = selectedSpot {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 7) {
                        Text(spot.callsign).font(.body.weight(.bold)).foregroundStyle(Color(hex: spot.statusHex))
                        Text(String(format: "%.3f MHz", spot.frequencyKHz / 1_000)).font(.body.monospacedDigit())
                        Text(spot.mode).font(.caption.weight(.semibold)).foregroundStyle(XLogTheme.cyan)
                        Text("\(spot.callStatus) · \(spot.dxccStatus)").font(.caption).foregroundStyle(XLogTheme.secondary)
                    }
                    Text([spot.country, spot.comment, spot.source].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(XLogTheme.secondary).lineLimit(1)
                }
            } else {
                Text("Select a marker to load it into the logger, tune through xCat and inspect its classification here.")
                    .font(.caption).foregroundStyle(XLogTheme.secondary).lineLimit(2)
            }
            Spacer(minLength: 0)
            if statusScope != .all || modeScope != .all || !spotSearch.isEmpty {
                Button("Clear filters") { statusScope = .all; modeScope = .all; spotSearch = "" }
                    .controlSize(.small)
            }
        }
        .padding(.horizontal, 14).frame(minHeight: 52)
        .background(XLogTheme.raised)
        .overlay(alignment: .bottom) { Rectangle().fill(XLogTheme.rule).frame(height: 1) }
    }

    private var filteredSpots: [ClusterSpot] {
        model.clusterSpots.filter { spot in
            let status = "\(spot.callStatus) \(spot.dxccStatus)".lowercased()
            let statusMatches: Bool
            switch statusScope {
            case .all: statusMatches = true
            case .needed: statusMatches = status.contains("need") || status.contains("new")
            case .worked: statusMatches = status.contains("worked") && !status.contains("confirmed")
            case .confirmed: statusMatches = status.contains("confirmed")
            case .priority: statusMatches = spot.score >= 50 || !spot.specialTags.isEmpty
            }
            let normalizedMode = spot.mode.uppercased()
            let modeMatches: Bool
            switch modeScope {
            case .all: modeMatches = true
            case .cw: modeMatches = normalizedMode == "CW"
            case .phone: modeMatches = ["SSB", "USB", "LSB", "AM", "FM"].contains(normalizedMode)
            case .digital: modeMatches = normalizedMode != "CW" && !["SSB", "USB", "LSB", "AM", "FM"].contains(normalizedMode)
            }
            let needle = spotSearch.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let searchMatches = needle.isEmpty || [spot.callsign, spot.country, spot.comment, spot.source]
                .contains(where: { $0.lowercased().contains(needle) })
            return statusMatches && modeMatches && searchMatches
        }
    }

    private func spots(for band: String) -> [ClusterSpot] {
        (compact ? model.clusterSpots : filteredSpots).filter { $0.band == band }
    }

    private func inspectAndOpen(_ spot: ClusterSpot) {
        selectedSpot = spot
        model.openClusterSpot(spot)
    }
}

private struct BandMapPanel: View {
    let band: String
    let spots: [ClusterSpot]
    let remove: () -> Void
    let select: (ClusterSpot) -> Void
    var allowsVerticalResize = false
    let fontScale: Double
    let preferredContainerHeight: CGFloat?

    @State private var visibleLower: Double
    @State private var visibleUpper: Double
    @State private var userChartHeight: CGFloat?
    @State private var resizeStartHeight: CGFloat?

    private var fullBounds: ClosedRange<Double> { Self.ranges[band] ?? 0...1 }
    private var bounds: ClosedRange<Double> { visibleLower...visibleUpper }
    private var accent: Color { spots.first.map { Color(hex: $0.bandHex) } ?? XLogTheme.cyan }
    private var visibleSpots: [ClusterSpot] { spots.filter { bounds.contains($0.frequencyKHz) } }

    init(
        band: String,
        spots: [ClusterSpot],
        remove: @escaping () -> Void,
        select: @escaping (ClusterSpot) -> Void,
        allowsVerticalResize: Bool = false,
        fontScale: Double = 1,
        preferredContainerHeight: CGFloat? = nil
    ) {
        self.band = band
        self.spots = spots
        self.remove = remove
        self.select = select
        self.allowsVerticalResize = allowsVerticalResize
        self.fontScale = min(2, max(0.8, fontScale))
        self.preferredContainerHeight = preferredContainerHeight
        let range = Self.ranges[band] ?? 0...1
        _visibleLower = State(initialValue: range.lowerBound)
        _visibleUpper = State(initialValue: range.upperBound)
    }

    var body: some View {
        let scale = CGFloat(fontScale)
        let headerHeight = max(38, 24 + 12 * scale)
        let controlsHeight = max(32, 16 + 18 * scale)
        let footerHeight = max(28, 14 + 12 * scale)
        let automaticChartHeight = preferredContainerHeight.map {
            max(260, $0 - headerHeight - controlsHeight - footerHeight)
        } ?? 430
        VStack(spacing: 0) {
            HStack {
                Circle().fill(accent).frame(width: 8, height: 8)
                Text(band).font(.system(size: 15 * scale, weight: .semibold))
                Text("\(visibleSpots.count)/\(spots.count) spots")
                    .font(.system(size: 11 * scale))
                    .foregroundStyle(XLogTheme.secondary)
                Spacer()
                Button(action: remove) { Image(systemName: "xmark") }
                    .buttonStyle(.plain).accessibilityLabel("Close \(band) band map")
            }
            .padding(.horizontal, 12)
            .frame(height: headerHeight)
            .background(XLogTheme.raised)

            HStack(spacing: 7) {
                Menu {
                    Button("Full band") { show(range: fullBounds) }
                    Divider()
                    ForEach(Self.allocations[band] ?? []) { allocation in
                        Button(allocation.name) { show(range: allocation.range) }
                    }
                } label: {
                    Label(segmentName, systemImage: "scope")
                }
                .menuStyle(.borderlessButton)
                Spacer()
                Button { pan(fraction: 0.3) } label: { Image(systemName: "arrow.up") }
                    .help("Pan up the band")
                Button { pan(fraction: -0.3) } label: { Image(systemName: "arrow.down") }
                    .help("Pan down the band")
                Button { zoom(factor: 1.55) } label: { Image(systemName: "minus.magnifyingglass") }
                    .help("Zoom out")
                Button { zoom(factor: 0.62) } label: { Image(systemName: "plus.magnifyingglass") }
                    .help("Zoom in")
                Button { show(range: fullBounds) } label: { Image(systemName: "arrow.counterclockwise") }
                    .help("Show the whole band")
            }
            .buttonStyle(.borderless)
            .font(.system(size: 11 * scale))
            .padding(.horizontal, 10)
            .frame(height: controlsHeight)
            .background(XLogTheme.surface)
            .overlay(alignment: .bottom) { Rectangle().fill(XLogTheme.rule).frame(height: 1) }

            GeometryReader { proxy in
                ZStack(alignment: .topLeading) {
                    ForEach(Self.allocations[band] ?? []) { allocation in
                        if let clipped = allocation.clipped(to: bounds) {
                            let top = yPosition(for: clipped.upperBound, height: proxy.size.height)
                            let bottom = yPosition(for: clipped.lowerBound, height: proxy.size.height)
                            Rectangle()
                                .fill(allocation.color.opacity(0.16))
                                .frame(width: proxy.size.width, height: max(1, bottom - top))
                                .position(x: proxy.size.width / 2, y: top + (bottom - top) / 2)
                            Text(allocation.shortName)
                                .font(.system(size: 8 * scale, weight: .bold))
                                .foregroundStyle(allocation.color.opacity(0.95))
                                .position(x: proxy.size.width - (24 * scale), y: max(top + 7 * scale, min(bottom - 7 * scale, top + 10 * scale)))
                        }
                    }
                    ForEach(0...8, id: \.self) { index in
                        let fraction = Double(index) / 8
                        let value = bounds.upperBound - (bounds.upperBound - bounds.lowerBound) * fraction
                        Rectangle().fill(XLogTheme.rule.opacity(index % 2 == 0 ? 0.8 : 0.35)).frame(height: 1)
                            .position(x: proxy.size.width / 2, y: max(1, proxy.size.height * fraction))
                        Text(String(format: value >= 1_000 ? "%.3f" : "%.1f", value / 1_000))
                            .font(.system(size: 9 * scale, design: .monospaced)).foregroundStyle(XLogTheme.secondary)
                            .position(x: max(28, 24 * scale), y: min(proxy.size.height - 8 * scale, max(8 * scale, proxy.size.height * fraction)))
                    }
                    ForEach(spotPlacements(width: proxy.size.width, height: proxy.size.height)) { placement in
                        let spot = placement.spot
                        Button { select(spot) } label: {
                            HStack(spacing: 4) {
                                Text(spot.callsign).fontWeight(.bold).lineLimit(1)
                                Spacer(minLength: 2)
                                Text(spot.opportunityCode)
                                    .font(.system(size: 9 * scale, weight: .black, design: .rounded))
                                    .opacity(0.92)
                            }
                            .font(.system(size: 10 * scale))
                            .foregroundStyle(Color(hex: spot.statusHex))
                            .padding(.horizontal, 6 * scale)
                            .frame(width: placement.width, height: 20 * scale)
                            .background(Color(hex: spot.statusHex).opacity(0.18))
                            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color(hex: spot.statusHex).opacity(0.7)))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        .buttonStyle(.plain)
                        .help("\(spot.callsign) · \(spot.opportunityCode) · \(spot.mode) · \(spot.callStatus) · \(spot.dxccStatus) · \(spot.comment)")
                        .position(x: placement.x, y: placement.y)
                    }
                }
            }
            .frame(minHeight: userChartHeight ?? automaticChartHeight)
            .background(XLogTheme.surface)

            HStack(spacing: 10) {
                allocationLegend("CW", color: XLogTheme.cyan)
                allocationLegend("Data", color: XLogTheme.pink)
                allocationLegend("Phone", color: XLogTheme.amber)
                Spacer()
                Text(String(format: "%.3f–%.3f MHz", visibleLower / 1_000, visibleUpper / 1_000))
                    .font(.system(size: 10 * scale, design: .monospaced)).foregroundStyle(XLogTheme.secondary)
                if allowsVerticalResize {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .foregroundStyle(XLogTheme.cyan)
                        .help("Drag to resize this band map vertically")
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture()
                                .onChanged { value in
                                    if resizeStartHeight == nil { resizeStartHeight = userChartHeight ?? automaticChartHeight }
                                    userChartHeight = min(1_400, max(260, (resizeStartHeight ?? automaticChartHeight) + value.translation.height))
                                }
                                .onEnded { _ in resizeStartHeight = nil }
                        )
                }
            }
            .padding(.horizontal, 10)
            .frame(height: footerHeight)
            .background(XLogTheme.raised)
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(XLogTheme.rule))
    }

    private var segmentName: String {
        let matching = (Self.allocations[band] ?? []).first {
            abs($0.range.lowerBound - visibleLower) < 0.01 && abs($0.range.upperBound - visibleUpper) < 0.01
        }
        return matching?.name ?? (abs(fullBounds.lowerBound - visibleLower) < 0.01 && abs(fullBounds.upperBound - visibleUpper) < 0.01 ? "Full band" : "Custom")
    }

    private func yPosition(for frequency: Double, height: CGFloat) -> CGFloat {
        let fraction = 1 - (frequency - visibleLower) / max(1, visibleUpper - visibleLower)
        return min(height, max(0, height * fraction))
    }

    private func show(range: ClosedRange<Double>) {
        visibleLower = max(fullBounds.lowerBound, range.lowerBound)
        visibleUpper = min(fullBounds.upperBound, range.upperBound)
    }

    private func zoom(factor: Double) {
        let centre = (visibleLower + visibleUpper) / 2
        let minimumSpan = max(2, (fullBounds.upperBound - fullBounds.lowerBound) / 80)
        let span = min(fullBounds.upperBound - fullBounds.lowerBound, max(minimumSpan, (visibleUpper - visibleLower) * factor))
        let lower = min(max(fullBounds.lowerBound, centre - span / 2), fullBounds.upperBound - span)
        visibleLower = lower
        visibleUpper = lower + span
    }

    private func pan(fraction: Double) {
        let span = visibleUpper - visibleLower
        let delta = span * fraction
        let lower = min(max(fullBounds.lowerBound, visibleLower + delta), fullBounds.upperBound - span)
        visibleLower = lower
        visibleUpper = lower + span
    }

    private func allocationLegend(_ title: String, color: Color) -> some View {
        let scale = CGFloat(fontScale)
        return HStack(spacing: 4) { Rectangle().fill(color).frame(width: 10, height: 4); Text(title) }
            .font(.system(size: 10 * scale)).foregroundStyle(XLogTheme.secondary)
    }

    private struct SpotPlacement: Identifiable {
        let spot: ClusterSpot
        let x: CGFloat
        let y: CGFloat
        let width: CGFloat
        var id: UUID { spot.id }
    }

    private func spotPlacements(width: CGFloat, height: CGFloat) -> [SpotPlacement] {
        let scale = CGFloat(fontScale)
        let scaleWidth = max(58, 48 + 10 * scale)
        let available = max(100, width - scaleWidth - 8)
        let columnCount = max(1, min(6, Int(available / (112 * scale))))
        let columnWidth = available / CGFloat(columnCount)
        let pillWidth = max(92 * scale, min(126 * scale, columnWidth - 6))
        let minimumGap = max(22, 20 * scale + 3)
        let topLimit = minimumGap / 2
        let bottomLimit = max(topLimit, height - minimumGap / 2)
        var nextY = Array(repeating: topLimit, count: columnCount)
        var output: [SpotPlacement] = []

        let ordered = visibleSpots.prefix(80).sorted { lhs, rhs in
            if lhs.frequencyKHz == rhs.frequencyKHz { return lhs.callsign < rhs.callsign }
            return lhs.frequencyKHz > rhs.frequencyKHz
        }
        for spot in ordered {
            let desired = yPosition(for: spot.frequencyKHz, height: height)
            let lane = (0..<columnCount).min { lhs, rhs in
                max(desired, nextY[lhs]) < max(desired, nextY[rhs])
            } ?? 0
            let y = max(topLimit, max(desired, nextY[lane]))
            nextY[lane] = y + minimumGap
            output.append(SpotPlacement(
                spot: spot,
                x: scaleWidth + CGFloat(lane) * columnWidth + columnWidth / 2,
                y: y,
                width: pillWidth
            ))
        }

        for lane in 0..<columnCount {
            let indices = output.indices.filter { index in
                abs(output[index].x - (scaleWidth + CGFloat(lane) * columnWidth + columnWidth / 2)) < 1
            }
            guard let last = indices.last, output[last].y > bottomLimit else { continue }
            let shift = output[last].y - bottomLimit
            for index in indices {
                let item = output[index]
                output[index] = SpotPlacement(spot: item.spot, x: item.x, y: max(topLimit, item.y - shift), width: item.width)
            }
        }
        return output
    }

    private struct Allocation: Identifiable {
        let name: String
        let shortName: String
        let range: ClosedRange<Double>
        let color: Color
        var id: String { name }
        func clipped(to bounds: ClosedRange<Double>) -> ClosedRange<Double>? {
            let lower = max(range.lowerBound, bounds.lowerBound)
            let upper = min(range.upperBound, bounds.upperBound)
            return lower < upper ? lower...upper : nil
        }
    }

    private static let ranges: [String: ClosedRange<Double>] = [
        "160m": 1_800...2_000, "80m": 3_500...4_000, "60m": 5_250...5_500,
        "40m": 7_000...7_300, "30m": 10_100...10_150, "20m": 14_000...14_350,
        "17m": 18_068...18_168, "15m": 21_000...21_450, "12m": 24_890...24_990,
        "10m": 28_000...29_700, "6m": 50_000...54_000, "2m": 144_000...148_000,
        "70cm": 420_000...450_000,
    ]

    private static let allocations: [String: [Allocation]] = [
        "160m": segments(1_800...1_840, 1_840...1_850, 1_850...2_000),
        "80m": segments(3_500...3_570, 3_570...3_600, 3_600...4_000),
        "60m": segments(5_250...5_330, 5_330...5_405, 5_405...5_500),
        "40m": segments(7_000...7_040, 7_040...7_100, 7_100...7_300),
        "30m": [Allocation(name: "CW portion", shortName: "CW", range: 10_100...10_130, color: XLogTheme.cyan), Allocation(name: "Data portion", shortName: "DATA", range: 10_130...10_150, color: XLogTheme.pink)],
        "20m": segments(14_000...14_070, 14_070...14_112, 14_112...14_350),
        "17m": segments(18_068...18_095, 18_095...18_110, 18_110...18_168),
        "15m": segments(21_000...21_070, 21_070...21_150, 21_150...21_450),
        "12m": segments(24_890...24_915, 24_915...24_930, 24_930...24_990),
        "10m": segments(28_000...28_070, 28_070...28_300, 28_300...29_700),
        "6m": segments(50_000...50_100, 50_100...50_300, 50_300...54_000),
        "2m": segments(144_000...144_100, 144_100...144_500, 144_500...148_000),
        "70cm": segments(420_000...420_100, 420_100...433_000, 433_000...450_000),
    ]

    private static func segments(_ cw: ClosedRange<Double>, _ data: ClosedRange<Double>, _ phone: ClosedRange<Double>) -> [Allocation] {
        [
            Allocation(name: "CW portion", shortName: "CW", range: cw, color: XLogTheme.cyan),
            Allocation(name: "Data portion", shortName: "DATA", range: data, color: XLogTheme.pink),
            Allocation(name: "Phone portion", shortName: "PHONE", range: phone, color: XLogTheme.amber),
        ]
    }
}
