import SwiftUI
import XLogCore

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var section: Section = .station

    private enum Section: String, CaseIterable, Identifiable {
        case station = "Station"
        case wavelog = "Wavelog"
        case qrz = "QRZ"
        case integrations = "Integrations"
        case bandMaps = "Band Maps"
        case data = "Reference Data"
        var id: String { rawValue }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Settings").font(.title2.bold())
                    Text("Secrets are stored only in macOS Keychain.").font(.caption).foregroundStyle(XLogTheme.secondary)
                }
                Spacer()
                Button("Save settings") { model.saveSettings() }
                    .buttonStyle(PrimaryActionStyle())
            }
            .padding(16).background(XLogTheme.surface)
            .overlay(alignment: .bottom) { Rectangle().fill(XLogTheme.rule).frame(height: 1) }
            HStack(spacing: 0) {
                List(Section.allCases, selection: $section) { item in Text(item.rawValue).tag(item) }
                    .listStyle(.sidebar).scrollContentBackground(.hidden)
                    .frame(width: 170).background(XLogTheme.surface)
                Divider().overlay(XLogTheme.rule)
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(section.rawValue).font(.title3.bold())
                        settingsContent
                    }.padding(20).frame(maxWidth: 720, alignment: .leading)
                }
            }
        }
    }

    @ViewBuilder private var settingsContent: some View {
        switch section {
        case .station:
            SettingsGroup(title: "Identity", help: "Written into new contacts and ADIF exports.") {
                SettingField("Operator callsign", text: $model.settings.operatorCall)
                SettingField("Station callsign", text: $model.settings.stationCall)
                SettingField("Station gridsquare", text: $model.settings.gridSquare)
                SettingField("Station location", text: $model.settings.stationLocation)
                SettingField("Default radio", text: $model.settings.defaultRadio)
                SettingField("Default TX power (W)", text: $model.settings.defaultPower)
            }
        case .wavelog:
            SettingsGroup(title: "API v2", help: "Create a Wavelog API v2 token. The token must start with wl2_.") {
                SettingField("Wavelog URL", text: $model.settings.wavelogURL)
                HStack {
                    Text("Station profile ID").frame(width: 170, alignment: .trailing)
                    TextField("1", value: $model.settings.wavelogStationID, format: .number).textFieldStyle(DarkTextFieldStyle())
                }
                HStack {
                    Text("API token").frame(width: 170, alignment: .trailing)
                    SecureField("wl2_…", text: $model.wavelogToken).textFieldStyle(DarkTextFieldStyle())
                }
                Toggle("Synchronize automatically", isOn: $model.settings.automaticSync)
                Stepper("Every \(model.settings.syncIntervalMinutes) minutes", value: $model.settings.syncIntervalMinutes, in: 1...60)
            }
        case .qrz:
            SettingsGroup(title: "Callsign lookup", help: "Full QRZ XML data requires an eligible QRZ subscription. Operator-entered values are never overwritten.") {
                Toggle("Enable QRZ lookup", isOn: $model.settings.qrzEnabled)
                SettingField("QRZ username", text: $model.settings.qrzUsername)
                HStack {
                    Text("QRZ password").frame(width: 170, alignment: .trailing)
                    SecureField("Password", text: $model.qrzPassword).textFieldStyle(DarkTextFieldStyle())
                }
            }
        case .integrations:
            SettingsGroup(title: "OM0RX-xCat", help: "xLog uses RigCtlD over loopback. xCat remains the only process connected to the physical radio.") {
                SettingField("Host", text: $model.settings.xcatHost)
                HStack {
                    Text("RigCtlD port").frame(width: 170, alignment: .trailing)
                    TextField("14532", value: $model.settings.xcatRigCtlPort, format: .number).textFieldStyle(DarkTextFieldStyle())
                }
                Label(model.radioStatus, systemImage: model.radioSnapshot == nil ? "xmark.circle" : "checkmark.circle.fill")
                    .foregroundStyle(model.radioSnapshot == nil ? XLogTheme.danger : XLogTheme.teal)
            }
        case .bandMaps:
            SettingsGroup(title: "Band-map workspaces", help: "The Operator Desk and the undocked Band Maps window keep independent selections. The first map in either workspace cannot be removed until another is enabled.") {
                HStack {
                    Text("Operator Desk").font(.headline)
                    Toggle("Follow radio", isOn: Binding(
                        get: { model.deskBandMapFollowsRadio },
                        set: { model.setDeskBandMapFollowsRadio($0) }
                    ))
                    .toggleStyle(.checkbox)
                    Spacer()
                    Button("All bands") { model.showAllBandMaps() }
                    Text("\(model.bandMapBands.count) selected").foregroundStyle(XLogTheme.secondary)
                }
                Text("Follow radio keeps the desk map beside the world map on the band currently tuned in xCat. Choosing bands manually turns following off.")
                    .font(.caption).foregroundStyle(XLogTheme.secondary)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], alignment: .leading, spacing: 8) {
                    ForEach(BandPlan.bands, id: \.self) { band in
                        Toggle(band, isOn: Binding(
                            get: { model.bandMapBands.contains(band) },
                            set: { model.setBandMap(band, enabled: $0) }
                        ))
                    }
                }
                Divider().overlay(XLogTheme.rule)
                HStack {
                    Text("Undocked window").font(.headline)
                    Spacer()
                    Picker("Layout", selection: Binding(
                        get: { model.detachedBandMapLayout },
                        set: { model.setDetachedBandMapLayout($0) }
                    )) {
                        ForEach(BandMapLayout.allCases) { layout in Text(layout.rawValue).tag(layout) }
                    }
                    .frame(width: 240)
                    Button("All bands") { model.showAllBandMaps(detached: true) }
                    Text("\(model.detachedBandMapBands.count) selected").foregroundStyle(XLogTheme.secondary)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], alignment: .leading, spacing: 8) {
                    ForEach(BandPlan.bands, id: \.self) { band in
                        Toggle(band, isOn: Binding(
                            get: { model.detachedBandMapBands.contains(band) },
                            set: { model.setBandMap(band, enabled: $0, detached: true) }
                        ))
                    }
                }
                Divider().overlay(XLogTheme.rule)
                HStack {
                    Text("Band-map text size").frame(width: 170, alignment: .trailing)
                    Slider(
                        value: Binding(
                            get: { model.bandMapFontScale },
                            set: { model.setBandMapFontScale($0) }
                        ),
                        in: 0.8...2,
                        step: 0.1
                    )
                    Text("\(Int(model.bandMapFontScale * 100))%")
                        .monospacedDigit().frame(width: 48, alignment: .trailing)
                    Button("Reset") { model.setBandMapFontScale(1) }
                }
                Text("Spot labels, frequency ticks, allocation labels and collision spacing scale together for 4K and distant displays.")
                    .font(.caption).foregroundStyle(XLogTheme.secondary)
            }
        case .data:
            SettingsGroup(title: "Automatic classification data", help: "Club Log distributes cty.xml using an application API key. The key is stored in macOS Keychain; updates are validated before replacing the last known good copy.") {
                SettingField("Club Log CTY URL", text: $model.settings.clubLogCTYURL)
                HStack {
                    Text("Club Log API key").frame(width: 170, alignment: .trailing)
                    SecureField("Application API key", text: $model.clubLogAPIKey).textFieldStyle(DarkTextFieldStyle())
                }
                SettingField("LoTW activity URL", text: $model.settings.lotwActivityURL)
                Button("Update reference data now") { Task { await model.refreshReferenceData() } }.disabled(model.isWorking)
            }
        }
    }
}

private struct SettingsGroup<Content: View>: View {
    let title: String
    let help: String
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline)
            Text(help).font(.caption).foregroundStyle(XLogTheme.secondary)
            Divider().overlay(XLogTheme.rule)
            content
        }
        .padding(16).background(XLogTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(XLogTheme.rule))
    }
}

private struct SettingField: View {
    let title: String
    @Binding var text: String
    init(_ title: String, text: Binding<String>) { self.title = title; _text = text }
    var body: some View {
        HStack {
            Text(title).frame(width: 170, alignment: .trailing)
            TextField(title, text: $text).textFieldStyle(DarkTextFieldStyle())
        }
    }
}
