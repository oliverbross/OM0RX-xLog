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
        case backup = "Backup & Restore"
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
            HStack(alignment: .top, spacing: 16) {
                VStack(spacing: 5) {
                    ForEach(Section.allCases) { item in
                        Button {
                            section = item
                        } label: {
                            HStack {
                                Text(item.rawValue).fontWeight(section == item ? .semibold : .regular)
                                Spacer()
                                if section == item { Image(systemName: "chevron.right").font(.caption.bold()) }
                            }
                            .foregroundStyle(section == item ? Color.white : XLogTheme.text)
                            .padding(.horizontal, 11)
                            .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
                            .background(section == item ? XLogTheme.cyan.opacity(0.42) : Color.clear)
                            .clipShape(RoundedRectangle(cornerRadius: 7))
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                }
                .padding(12)
                .frame(width: 190)
                .frame(maxHeight: .infinity, alignment: .top)
                .background(XLogTheme.surface)

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(section.rawValue).font(.title3.bold())
                        settingsContent
                    }
                    .padding(20)
                    .frame(maxWidth: 920, alignment: .leading)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .sheet(isPresented: Binding(
            get: { model.pendingRestorePreview != nil },
            set: { if !$0 { model.cancelPendingRestore() } }
        )) {
            if let preview = model.pendingRestorePreview {
                RestoreBackupSheet(preview: preview)
                    .environmentObject(model)
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
            SettingsGroup(title: "Cluster spot workflow", help: "By default a spot populates the compact logger and keeps the Operator Desk visible. Enable this only if every spot should open the full QSO editor.") {
                Toggle("Open full Log QSO editor when loading a spot", isOn: Binding(
                    get: { model.clusterSpotOpensFullEditor },
                    set: { model.setClusterSpotOpensFullEditor($0) }
                ))
                Toggle("Send xCluster spots to FLEX through xCat", isOn: Binding(
                    get: { model.sendSpotsToFlex },
                    set: { model.setSendSpotsToFlex($0) }
                ))
                Toggle("Automatically turn the rotor to a loaded callsign or spot", isOn: Binding(
                    get: { model.automaticallyTurnRotor },
                    set: { model.setAutomaticallyTurnRotor($0) }
                ))
                HStack {
                    Text("xCat spot UDP port").frame(width: 170, alignment: .trailing)
                    TextField("12062", value: Binding(
                        get: { model.flexSpotPort },
                        set: { model.setFlexSpotPort($0) }
                    ), format: .number)
                    .textFieldStyle(DarkTextFieldStyle())
                }
                Label(model.flexSpotStatus, systemImage: "dot.radiowaves.up.forward")
                    .foregroundStyle(model.sendSpotsToFlex ? XLogTheme.teal : XLogTheme.secondary)
            }
        case .bandMaps:
            SettingsGroup(title: "World-map preset", help: "Choose the default information density. You can still adjust overlays, Sun and greyline directly on the map.") {
                Picker("Map detail", selection: Binding(
                    get: { model.mapDisplayPreset },
                    set: { model.setMapDisplayPreset($0) }
                )) {
                    ForEach(MapDisplayPreset.allCases) { preset in Text(preset.rawValue).tag(preset) }
                }
                .pickerStyle(.segmented)
                Text(mapPresetDescription(model.mapDisplayPreset))
                    .font(.caption).foregroundStyle(XLogTheme.secondary)
            }
            SettingsGroup(title: "Callsign Intelligence", help: "Choose the bands shown in the worked/confirmed matrix. The Operator Desk wraps them into two rows when necessary.") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 8)], alignment: .leading, spacing: 8) {
                    ForEach(BandPlan.bands, id: \.self) { band in
                        Toggle(band, isOn: Binding(
                            get: { model.intelligenceBands.contains(band) },
                            set: { model.setIntelligenceBand(band, enabled: $0) }
                        ))
                    }
                }
            }
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
        case .backup:
            SettingsGroup(
                title: "Verified station backup",
                help: "Create a self-checking snapshot of the complete SQLite log, station settings, workspace preferences and cached reference data. Keychain secrets are never copied."
            ) {
                HStack(spacing: 14) {
                    Image(systemName: "externaldrive.badge.checkmark")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(XLogTheme.teal)
                        .frame(width: 42)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(model.stats.qsoCount.formatted()) contacts ready to protect")
                            .font(.headline)
                        Text("The backup is verified with SQLite integrity checking, record counts and a SHA-256 checksum before it is accepted.")
                            .font(.caption)
                            .foregroundStyle(XLogTheme.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .layoutPriority(1)
                    Spacer()
                    Button(model.isWorking ? "Working…" : "Create backup…") {
                        model.createVerifiedBackup()
                    }
                    .buttonStyle(PrimaryActionStyle())
                    .disabled(model.isWorking)
                }
            }
            SettingsGroup(
                title: "Restore with preview",
                help: "Inspection changes nothing. Before a confirmed restore, xLog creates a second verified snapshot of the current profile and retains the replaced database as a timestamped rollback file."
            ) {
                HStack(spacing: 14) {
                    Image(systemName: "arrow.counterclockwise.circle")
                        .font(.system(size: 28, weight: .medium))
                        .foregroundStyle(XLogTheme.cyan)
                        .frame(width: 42)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Inspect before replacing anything")
                            .font(.headline)
                        Text("Preview the backup date, contact and pending-sync counts, last QSO, settings and reference data before Restore is enabled.")
                            .font(.caption)
                            .foregroundStyle(XLogTheme.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .layoutPriority(1)
                    Spacer()
                    Button("Inspect backup…") { model.inspectBackupForRestore() }
                        .disabled(model.isWorking)
                }
            }
            SettingsGroup(
                title: "Recovery guarantees",
                help: "Backups are ordinary .xlogbackup folders that remain readable without xLog."
            ) {
                Label("Live writes are captured through SQLite's consistent backup API", systemImage: "checkmark.seal.fill")
                Label("A modified or incomplete package is rejected before restore", systemImage: "checkmark.seal.fill")
                Label("Wavelog and QRZ credentials remain in macOS Keychain", systemImage: "key.fill")
                Label("Pre-restore snapshots are kept under Application Support › OM0RX-xLog › Recovery", systemImage: "archivebox.fill")
            }
            .foregroundStyle(XLogTheme.secondary)
        case .data:
            SettingsGroup(title: "Automatic classification data", help: "Club Log distributes cty.xml using an application API key. The key is stored in macOS Keychain; updates are validated before replacing the last known good copy.") {
                SettingField("Club Log CTY URL", text: $model.settings.clubLogCTYURL)
                HStack {
                    Text("Club Log API key").frame(width: 170, alignment: .trailing)
                    SecureField("Application API key", text: $model.clubLogAPIKey).textFieldStyle(DarkTextFieldStyle())
                }
                SettingField("LoTW activity URL", text: $model.settings.lotwActivityURL)
                Divider().overlay(XLogTheme.rule)
                referenceDatasetRow(
                    "Club Log CTY",
                    updated: model.referenceState.clubLogUpdatedAt,
                    bytes: model.referenceState.clubLogBytes,
                    stateKey: "cty.xml"
                )
                referenceDatasetRow(
                    "LoTW activity",
                    updated: model.referenceState.lotwUpdatedAt,
                    bytes: model.referenceState.lotwBytes,
                    stateKey: "lotw-user-activity.csv"
                )
                referenceDatasetRow(
                    "Wavelog catalog",
                    updated: model.referenceState.wavelogCatalogUpdatedAt,
                    bytes: model.referenceState.wavelogCatalogBytes,
                    stateKey: "wavelog-catalog.json"
                )
            }
            SettingsGroup(title: "Activation directories", help: "Full official POTA, SOTA, IOTA and WWFF directories are validated and replaced atomically for offline matching. Unknown references are preserved and never block a QSO.") {
                ForEach([ActivationReferenceKind.pota, .sota, .iota, .wwff], id: \.self) { kind in
                    activationDirectoryRow(kind)
                }
                Divider().overlay(XLogTheme.rule)
                HStack(spacing: 10) {
                    Image(systemName: "building.columns")
                        .foregroundStyle(XLogTheme.secondary)
                        .frame(width: 24)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("WCA / COTA castles").font(.callout.weight(.semibold))
                        Text("The official WCA spreadsheet link is currently unavailable. Castle values remain loggable; full offline matching will activate when a working official bulk source is available.")
                            .font(.caption).foregroundStyle(XLogTheme.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Button(model.isWorking ? "Updating…" : "Update all reference data now") {
                    Task { await model.refreshReferenceData() }
                }
                .buttonStyle(PrimaryActionStyle())
                .disabled(model.isWorking)
            }
        }
    }

    private func activationDirectoryRow(_ kind: ActivationReferenceKind) -> some View {
        let key = kind.rawValue
        let count = model.referenceState.activationCounts[key] ?? 0
        let bytes = model.referenceState.activationBytes[key] ?? 0
        let updated = model.referenceState.activationUpdatedAt[key]
        let validator = model.referenceState.validators[kind.fileName]
        let version = referenceDatasetVersion(validator)
        return HStack(spacing: 10) {
            Image(systemName: count > 0 ? "checkmark.circle.fill" : "arrow.down.circle")
                .foregroundStyle(count > 0 ? XLogTheme.teal : XLogTheme.secondary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(kind.label) · \(count.formatted()) references")
                    .font(.callout.weight(.semibold))
                Text(updated.map {
                    [
                        "Checked \($0.formatted(date: .abbreviated, time: .shortened))",
                        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file),
                        version,
                    ].compactMap { $0 }.joined(separator: " · ")
                } ?? "Not downloaded yet")
                    .font(.caption).foregroundStyle(XLogTheme.secondary)
            }
            Spacer()
            if let source = ReferenceDataUpdater.activationSourceURLs[kind] {
                Link("Official source", destination: source)
                    .font(.caption.weight(.semibold))
            }
        }
    }

    private func referenceDatasetRow(_ title: String, updated: Date?, bytes: Int, stateKey: String) -> some View {
        let version = referenceDatasetVersion(model.referenceState.validators[stateKey])
        return HStack(spacing: 10) {
            Image(systemName: bytes > 0 ? "checkmark.circle.fill" : "arrow.down.circle")
                .foregroundStyle(bytes > 0 ? XLogTheme.teal : XLogTheme.secondary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.callout.weight(.semibold))
                Text(updated.map {
                    [
                        "Checked \($0.formatted(date: .abbreviated, time: .shortened))",
                        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file),
                        version,
                    ].compactMap { $0 }.joined(separator: " · ")
                } ?? "Not downloaded yet")
                    .font(.caption)
                    .foregroundStyle(XLogTheme.secondary)
                    .lineLimit(1)
            }
            Spacer()
        }
    }

    private func referenceDatasetVersion(_ validator: ReferenceDataValidator?) -> String? {
        validator?.eTag.map { "ETag \($0.trimmingCharacters(in: CharacterSet(charactersIn: "\"")))" }
            ?? validator?.lastModified.map { "Last-Modified \($0)" }
    }

    private func mapPresetDescription(_ preset: MapDisplayPreset) -> String {
        switch preset {
        case .simple: return "Live spots only, without solar overlays—a calm operating map."
        case .detailed: return "Spots, DXCC status, Sun position and greyline together."
        case .dx: return "DXCC entities and solar conditions without live spot labels."
        }
    }
}

private struct RestoreBackupSheet: View {
    @EnvironmentObject private var model: AppModel
    let preview: XLogBackupPreview

    private var manifest: XLogBackupManifest { preview.manifest }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "externaldrive.badge.checkmark")
                    .font(.system(size: 34, weight: .medium))
                    .foregroundStyle(XLogTheme.teal)
                    .frame(width: 48)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Verified backup")
                        .font(.title2.bold())
                    Text(preview.packageURL.lastPathComponent)
                        .font(.callout.monospaced())
                        .foregroundStyle(XLogTheme.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
            }

            Divider().overlay(XLogTheme.rule)

            LazyVGrid(
                columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())],
                alignment: .leading,
                spacing: 14
            ) {
                restoreFact("Created", manifest.createdAt.formatted(date: .abbreviated, time: .shortened))
                restoreFact("Contacts", manifest.qsoCount.formatted())
                restoreFact("Pending sync", manifest.pendingSyncCount.formatted())
                restoreFact("Last QSO", manifest.lastQSOAt?.formatted(date: .abbreviated, time: .shortened) ?? "No contacts")
                restoreFact("Database", ByteCountFormatter.string(fromByteCount: manifest.databaseBytes, countStyle: .file))
                restoreFact("Checksum", String(manifest.databaseSHA256.prefix(12)) + "…", monospaced: true)
            }

            VStack(alignment: .leading, spacing: 10) {
                Toggle("Restore station and service settings", isOn: $model.restoreSettingsFromBackup)
                    .disabled(preview.settings == nil)
                Toggle("Restore band-map and intelligence workspace", isOn: $model.restoreWorkspaceFromBackup)
                    .disabled(preview.preferences == nil)
                Label(
                    manifest.includesReferenceData ? "Cached reference data is included" : "Reference data is not included and can be downloaded again",
                    systemImage: manifest.includesReferenceData ? "checkmark.circle.fill" : "arrow.down.circle"
                )
                .foregroundStyle(manifest.includesReferenceData ? XLogTheme.teal : XLogTheme.secondary)
                Label("Keychain passwords and API tokens are not changed", systemImage: "key.fill")
                    .foregroundStyle(XLogTheme.secondary)
            }

            Text("Restoring replaces the active local log. xLog first creates a verified pre-restore backup and keeps the replaced SQLite file for rollback.")
                .font(.callout)
                .foregroundStyle(XLogTheme.amber)

            HStack {
                Spacer()
                Button("Cancel") { model.cancelPendingRestore() }
                    .keyboardShortcut(.cancelAction)
                Button("Restore verified backup", role: .destructive) {
                    model.restorePendingBackup()
                }
                .buttonStyle(.borderedProminent)
                .tint(XLogTheme.danger)
                .keyboardShortcut(.defaultAction)
                .disabled(model.isWorking)
            }
        }
        .padding(24)
        .frame(width: 620)
        .background(XLogTheme.background)
    }

    @ViewBuilder
    private func restoreFact(_ label: String, _ value: String, monospaced: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(XLogTheme.secondary)
            Text(value)
                .font(monospaced ? .callout.monospaced() : .callout.weight(.semibold))
                .foregroundStyle(XLogTheme.text)
                .lineLimit(1)
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
