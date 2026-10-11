import AppKit
import MapKit
import SwiftUI
import XLogCore

private struct SpotMapPoint: Identifiable {
    enum Kind: String { case spot, station, dxcc, activeDX }
    let id: String
    let coordinate: CLLocationCoordinate2D
    let title: String
    let subtitle: String
    let colorHex: String
    let spot: ClusterSpot?
    let kind: Kind
}

private enum DXCCOverlayMode: String, CaseIterable, Identifiable {
    case spots = "Spots"
    case dxcc = "DXCC"
    case both = "Both"
    var id: String { rawValue }
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
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        GeometryReader { proxy in
            VStack(spacing: 10) {
                HStack(alignment: .top, spacing: 10) {
                    compactLogger.frame(maxWidth: .infinity)
                    compactIntelligence.frame(width: max(315, proxy.size.width * 0.29))
                    stationPulse.frame(width: 220)
                }
                .frame(height: 190)

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
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 4) {
                    FieldLabel(title: "Callsign")
                    TextField("Callsign", text: $model.draft.call)
                        .textFieldStyle(DarkTextFieldStyle())
                        .font(.system(size: 20, weight: .bold, design: .monospaced))
                        .foregroundStyle(XLogTheme.teal)
                        .onChange(of: model.draft.call) { _ in model.callChanged() }
                }
                VStack(alignment: .leading, spacing: 4) {
                    FieldLabel(title: "Frequency MHz")
                    TextField("14.074000", text: $model.draft.frequency)
                        .textFieldStyle(DarkTextFieldStyle()).monospacedDigit()
                        .foregroundStyle(XLogTheme.cyan)
                }.frame(width: 125)
                Picker("Band", selection: $model.draft.band) { ForEach(BandPlan.bands, id: \.self) { Text($0).tag($0) } }
                    .labelsHidden().frame(width: 76)
                Picker("Mode", selection: $model.draft.mode) { ForEach(BandPlan.modes, id: \.self) { Text($0).tag($0) } }
                    .labelsHidden().frame(width: 84)
            }
            HStack(spacing: 8) {
                TextField("Name", text: $model.draft.name).textFieldStyle(DarkTextFieldStyle())
                TextField("Comment / spot note", text: $model.draft.comment).textFieldStyle(DarkTextFieldStyle())
                TextField("RST S", text: $model.draft.rstSent).textFieldStyle(DarkTextFieldStyle()).frame(width: 60)
                TextField("RST R", text: $model.draft.rstReceived).textFieldStyle(DarkTextFieldStyle()).frame(width: 60)
            }
            HStack {
                Button("Full editor") { model.destination = .log }
                Button { model.readRadio() } label: { Label("Read radio", systemImage: "antenna.radiowaves.left.and.right") }
                Spacer()
                Button {
                    model.logQSO()
                } label: { Label(model.isEditing ? "Update QSO" : "Log QSO", systemImage: "checkmark.circle.fill") }
                    .buttonStyle(PrimaryActionStyle())
                    .keyboardShortcut(.return, modifiers: [.command])
            }
        }
    }

    private var compactIntelligence: some View {
        Panel(title: "Callsign intelligence", symbol: "person.text.rectangle") {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.draft.country.isEmpty ? "Country unresolved" : model.draft.country).font(.headline)
                    Text(model.draft.gridSquare.isEmpty ? "Grid unavailable" : model.draft.gridSquare)
                        .font(.caption).foregroundStyle(XLogTheme.secondary)
                }
                Spacer()
                Text(model.previous.isEmpty ? "NEW CALL" : "\(model.previous.count) WORKED")
                    .font(.caption.bold()).foregroundStyle(model.previous.isEmpty ? XLogTheme.amber : XLogTheme.teal)
            }
            HStack(spacing: 5) {
                ForEach(["80m", "40m", "20m", "17m", "15m", "10m"], id: \.self) { band in
                    let matches = model.matrix.filter { $0.band == band }
                    VStack(spacing: 3) {
                        Text(band).font(.caption2).foregroundStyle(XLogTheme.secondary)
                        Image(systemName: matches.contains(where: \.confirmed) ? "checkmark.circle.fill" : matches.isEmpty ? "minus" : "circle.fill")
                            .foregroundStyle(matches.contains(where: \.confirmed) ? XLogTheme.teal : matches.isEmpty ? XLogTheme.secondary.opacity(0.5) : XLogTheme.orange)
                    }.frame(maxWidth: .infinity)
                }
            }
            Text(model.previous.first.map { "Last QSO · \($0.start.formatted(date: .abbreviated, time: .shortened)) · \($0.band) \($0.mode)" } ?? "No local QSO history")
                .font(.caption).foregroundStyle(XLogTheme.secondary).lineLimit(1)
        }
    }

    private var stationPulse: some View {
        Panel(title: "Station pulse", symbol: "waveform.path.ecg") {
            deskStatus("Radio", model.radioSnapshot == nil ? "Offline" : model.radioSnapshot?.mode ?? "Live", model.radioSnapshot == nil ? XLogTheme.danger : XLogTheme.cyan)
            deskStatus("xCluster", model.clusterConnectedCount > 0 ? "\(model.clusterSpots.count) spots" : "Offline", model.clusterConnectedCount > 0 ? XLogTheme.teal : XLogTheme.secondary)
            deskStatus("Wavelog", model.syncStatus, model.syncStatus == "Up to date" ? XLogTheme.teal : XLogTheme.amber)
            HStack {
                Button { openWindow(id: "world-map") } label: { Image(systemName: "map") }.help("Open World Map in a window")
                Button { openWindow(id: "band-maps") } label: { Image(systemName: "slider.vertical.3") }.help("Open Band Maps in a window")
                Spacer()
                Text("\(model.stats.qsoCount) QSOs").font(.caption.bold())
            }
        }
    }

    private func deskStatus(_ title: String, _ value: String, _ color: Color) -> some View {
        HStack { Circle().fill(color).frame(width: 7, height: 7); Text(title).font(.caption); Spacer(); Text(value).font(.caption.bold()).lineLimit(1) }
    }
}

struct WorldMapView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow
    var compact = false
    @State private var overlayMode: DXCCOverlayMode = .both
    @State private var mapStyle: RadioMapStyle = .hybrid

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

    private var points: [SpotMapPoint] {
        var result: [SpotMapPoint] = []
        if overlayMode != .dxcc {
            result += mappedSpots.prefix(250).compactMap { spot -> SpotMapPoint? in
                guard let latitude = spot.latitude, let longitude = spot.longitude else { return nil }
                return SpotMapPoint(
                    id: spot.id.uuidString,
                    coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude),
                    title: spot.callsign,
                    subtitle: "\(spot.band) · \(spot.mode) · \(spot.callStatus)",
                    colorHex: spot.bandHex,
                    spot: spot,
                    kind: .spot
                )
            }
        }
        if overlayMode != .spots {
            result += model.dxccEntities.map { entity in
                let qsos = model.qsos.filter { $0.dxcc == entity.adif }
                let color = qsos.contains(where: \.isConfirmed) ? "#10B981" : (qsos.isEmpty ? "#61758D" : "#FF8C00")
                return SpotMapPoint(
                    id: "dxcc-\(entity.adif)",
                    coordinate: CLLocationCoordinate2D(latitude: entity.latitude ?? 0, longitude: entity.longitude ?? 0),
                    title: entity.name.capitalized,
                    subtitle: "DXCC \(entity.adif) · \(qsos.isEmpty ? "Needed" : qsos.contains(where: \.isConfirmed) ? "Confirmed" : "Worked")",
                    colorHex: color,
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
                spot: nil,
                kind: .activeDX
            ))
        }
        return result
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("World map").font(compact ? .headline : .title2.bold())
                    if !compact { Text("Live xCluster entities in the same status colours used by the spot table.").font(.caption).foregroundStyle(XLogTheme.secondary) }
                }
                Spacer()
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
                    route: stationCoordinate.flatMap { origin in activeDXCoordinate.map { [origin, $0] } },
                    mapType: mapStyle.mapType,
                    select: model.openClusterSpot
                ).ignoresSafeArea(edges: .bottom)

                VStack(alignment: .leading, spacing: 6) {
                    if let routeSolution {
                        Text(String(format: "%@ · %.0f km · SP %03.0f° · LP %03.0f°", model.draft.call, routeSolution.distanceKilometres, routeSolution.shortPathBearing, routeSolution.longPathBearing))
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
                            legend("Needed", "#61758D"); legend("Worked", "#FF8C00"); legend("Confirmed", "#10B981")
                        }
                    }
                }
                .padding(10).background(Color(hex: "#07111F").opacity(0.9))
                .clipShape(RoundedRectangle(cornerRadius: 8)).padding(12)
            }
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
    let route: [CLLocationCoordinate2D]?
    let mapType: MKMapType
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
            MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 12, longitude: 15), span: MKCoordinateSpan(latitudeDelta: 130, longitudeDelta: 310)),
            animated: false
        )
        return map
    }

    func updateNSView(_ map: MKMapView, context: Context) {
        context.coordinator.select = select
        map.mapType = mapType
        context.coordinator.update(points: points, route: route, on: map)
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var select: (ClusterSpot) -> Void
        private var pointsByID: [String: SpotMapPoint] = [:]
        private var pointSignature = ""
        private var routeSignature = ""

        init(select: @escaping (ClusterSpot) -> Void) { self.select = select }

        func update(points: [SpotMapPoint], route: [CLLocationCoordinate2D]?, on map: MKMapView) {
            let signature = points.map { "\($0.id):\($0.colorHex):\($0.coordinate.latitude):\($0.coordinate.longitude)" }.joined(separator: "|")
            if signature != pointSignature {
                pointSignature = signature
                pointsByID = Dictionary(uniqueKeysWithValues: points.map { ($0.id, $0) })
                map.removeAnnotations(map.annotations)
                map.addAnnotations(points.map(RadioMapAnnotation.init))
            }
            let newRouteSignature = route?.map { "\($0.latitude),\($0.longitude)" }.joined(separator: "|") ?? ""
            if newRouteSignature != routeSignature {
                let hadRoute = !routeSignature.isEmpty
                routeSignature = newRouteSignature
                map.removeOverlays(map.overlays)
                if var coordinates = route, coordinates.count == 2 {
                    let path = MKGeodesicPolyline(coordinates: &coordinates, count: coordinates.count)
                    map.addOverlay(path)
                    fit(path: path, points: points, on: map, animated: hadRoute)
                }
            }
        }

        private func fit(path: MKGeodesicPolyline, points: [SpotMapPoint], on map: MKMapView, animated: Bool) {
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
            view.apply(colorHex: annotation.colorHex, kind: annotation.kind)
            view.toolTip = [annotation.title, annotation.subtitle].compactMap { $0 }.joined(separator: " · ")
            return view
        }

        func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
            guard let annotation = view.annotation as? RadioMapAnnotation,
                  let spot = pointsByID[annotation.pointID]?.spot else { return }
            select(spot)
            mapView.deselectAnnotation(annotation, animated: true)
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            guard let line = overlay as? MKPolyline else { return MKOverlayRenderer(overlay: overlay) }
            let renderer = MKPolylineRenderer(polyline: line)
            renderer.strokeColor = NSColor(calibratedRed: 0.21, green: 0.78, blue: 0.96, alpha: 0.95)
            renderer.lineWidth = 3
            renderer.lineDashPattern = [8, 5]
            return renderer
        }
    }
}

private final class RadioMapAnnotation: NSObject, MKAnnotation {
    @objc dynamic var coordinate: CLLocationCoordinate2D
    let pointID: String
    let colorHex: String
    let kind: SpotMapPoint.Kind
    var title: String?
    var subtitle: String?

    init(_ point: SpotMapPoint) {
        coordinate = point.coordinate
        pointID = point.id
        colorHex = point.colorHex
        kind = point.kind
        title = point.title
        subtitle = point.subtitle
    }
}

private final class RadioDotAnnotationView: MKAnnotationView {
    func apply(colorHex: String, kind: SpotMapPoint.Kind) {
        let size: CGFloat = kind == .station || kind == .activeDX ? 16 : (kind == .spot ? 11 : 6)
        frame.size = NSSize(width: size, height: size)
        wantsLayer = true
        layer?.cornerRadius = kind == .activeDX ? 2 : size / 2
        layer?.backgroundColor = NSColor(xlogHex: colorHex).cgColor
        layer?.borderColor = NSColor.white.withAlphaComponent(kind == .dxcc ? 0.25 : 0.85).cgColor
        layer?.borderWidth = kind == .dxcc ? 0.5 : 1.5
        layer?.shadowColor = NSColor.black.cgColor
        layer?.shadowOpacity = 0.7
        layer?.shadowRadius = 2
        displayPriority = kind == .dxcc ? .defaultLow : .required
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
}

struct BandMapsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.openWindow) private var openWindow
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
                            spots: model.clusterSpots.filter { $0.band == band },
                            remove: { model.removeBandMap(band, detached: detached) },
                            select: model.openClusterSpot,
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
                spots: model.clusterSpots.filter { $0.band == band },
                remove: { model.removeBandMap(band, detached: detached) },
                select: model.openClusterSpot,
                allowsVerticalResize: !compact && bands.count > 1,
                fontScale: model.bandMapFontScale,
                preferredContainerHeight: minimumHeight > 0 ? minimumHeight : nil
            )
            .frame(width: width)
            .frame(minHeight: minimumHeight)
        }
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
                                Text(String(format: "%.1f", spot.frequencyKHz)).monospacedDigit().opacity(0.82)
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
                        .help("\(spot.callsign) · \(spot.mode) · \(spot.callStatus) · \(spot.comment)")
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
