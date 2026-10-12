import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import geometryUrl from "../../Sources/XLogCore/Resources/dxcc-boundaries.geojson?url";
import { type Spot, spots, fixtureBounds } from "./model";
import { acceptanceActive, interiorLandProbe, landPixelMatches } from "./acceptance";
// MapLibre 6 resolves its default worker relative to import.meta.url. Vite's
// optimized module and packaged bundle do not preserve that adjacent path.
// Emit the standalone worker as a local asset and configure it before any map.
maplibregl.setWorkerUrl(new URL(workerUrl, window.location.href).href);
export default function WorldMap({
  selected,
  onSpot,
}: {
  selected: string | null;
  onSpot?: (spot: Spot) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [error, setError] = useState("");
  const callback = useRef(onSpot);
  const selection = useRef(selected);
  const preserveCamera = useRef(Boolean(selected));
  callback.current = onSpot;
  selection.current = selected;
  useEffect(() => {
    if (!container.current) return;
    const element = container.current;
    let map: maplibregl.Map;
    let disposed = false;
    let landFeatures = 0;
    let captureRequested = acceptanceActive;
    const repaint = () => {
      if (disposed) return;
      map.resize();
      map.triggerRepaint();
    };
    const requestEvidence = () => {
      if (!acceptanceActive || disposed) return;
      captureRequested = true;
      element.dataset.capturedAt = "0";
      repaint();
    };
    const evidence = () => {
      if (disposed || !acceptanceActive || !captureRequested) return;
      const canvas = map.getCanvas();
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      element.dataset.canvasWidth = String(canvas.width);
      element.dataset.canvasHeight = String(canvas.height);
      element.dataset.webgl = String(Boolean(gl && !gl.isContextLost() && gl.getError() === gl.NO_ERROR));
      element.dataset.landFeatures = String(landFeatures);
      element.dataset.renderedLandFeatures = String(map.isStyleLoaded() ? map.queryRenderedFeatures(undefined, { layers: ["land"] }).length : 0);
      element.dataset.mapLoaded = String(map.isStyleLoaded() && map.isSourceLoaded("land") && landFeatures > 0);
      element.dataset.tilesLoaded = String(map.areTilesLoaded());
      if (!gl || !landFeatures || !map.isStyleLoaded() || !map.isSourceLoaded("land") || !map.areTilesLoaded()) return;
      let probes = 0;
      let matches = 0;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const pixels = new Uint8Array(36);
      const mismatches: { x: number; y: number; rgba: number[] }[] = [];
      const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // A distributed grid catches missing GPU tiles even when the CPU feature
      // index still contains the complete geography. Only acceptance reads pixels.
      for (let row = 0; row < 16; row++) {
        for (let column = 0; column < 24; column++) {
          const point: [number, number] = [(column + 0.5) * width / 24, (row + 0.5) * height / 16];
          if (!interiorLandProbe(point, (neighbor, layers) => map.queryRenderedFeatures(neighbor, { layers }).length > 0)) continue;
          probes++;
          const x = Math.max(0, Math.min(canvas.width - 3, Math.round(point[0] * canvas.width / width) - 1));
          const y = Math.max(0, Math.min(canvas.height - 3, canvas.height - Math.round(point[1] * canvas.height / height) - 1));
          gl.readPixels(x, y, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          if (landPixelMatches(pixels)) matches++;
          else if (mismatches.length < 4) mismatches.push({ x: point[0], y: point[1], rgba: [...pixels.slice(16, 20)] });
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      element.dataset.landPixelProbes = String(probes);
      element.dataset.matchedLandPixels = String(matches);
      element.dataset.pixelMismatches = JSON.stringify(mismatches);
      element.dataset.webgl = String(!gl.isContextLost() && gl.getError() === gl.NO_ERROR);
      element.dataset.capturedAt = String(Date.now());
      captureRequested = false;
    };
    const fitFixture = () =>
      map.fitBounds(fixtureBounds(spots), {
        padding: { top: 24, right: 48, bottom: 75, left: 24 },
        duration: 0,
        maxZoom: 2,
      });
    try {
      map = new maplibregl.Map({
        container: container.current,
        center: [-15, 38],
        zoom: 1.65,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            land: { type: "geojson", data: geometryUrl },
            spots: {
              type: "geojson",
              data: {
                type: "FeatureCollection",
                features: spots.map((s) => ({
                  type: "Feature",
                  properties: { id: s.id, state: s.state },
                  geometry: { type: "Point", coordinates: [s.lon, s.lat] },
                })),
              },
            },
          },
          layers: [
            {
              id: "ocean",
              type: "background",
              paint: { "background-color": "#123347" },
            },
            {
              id: "land",
              type: "fill",
              source: "land",
              paint: { "fill-color": "#314741", "fill-opacity": 1 },
            },
            {
              id: "borders",
              type: "line",
              source: "land",
              paint: { "line-color": "#6d8484", "line-width": 0.5 },
            },
            {
              id: "spots",
              type: "circle",
              source: "spots",
              paint: {
                "circle-radius": 5,
                "circle-color": [
                  "match",
                  ["get", "state"],
                  "confirmed",
                  "#12d6a0",
                  "worked",
                  "#ff8c00",
                  "#35c8f5",
                ],
                "circle-stroke-color": "#07111f",
                "circle-stroke-width": 1.5,
              },
            },
          ],
        },
      });
      mapRef.current = map;
      map.on("load", () => {
        const source = map.getSource("land") as maplibregl.GeoJSONSource;
        source.getData().then((data) => {
          if (disposed) return;
          landFeatures = data.type === "FeatureCollection" ? data.features.length : 0;
          requestEvidence();
        }).catch(() => {
          if (!disposed) {
            element.dataset.mapError = "Loaded geography could not be read back";
            setError("Map geography could not be read back.");
          }
        });
      });
      // Read framebuffer pixels synchronously at the end of a requested frame,
      // before the browser discards its non-preserved drawing buffer.
      map.on("render", evidence);
      document.addEventListener("xlog-native-acceptance", requestEvidence);
      document.addEventListener("xlog-native-map-evidence", requestEvidence);
      window.addEventListener("focus", repaint);
      fitFixture();
      map.on("movestart", (event) => {
        if (event.originalEvent) preserveCamera.current = true;
      });
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: true }),
        "top-right",
      );
      map.addControl(
        new maplibregl.AttributionControl({
          compact: false,
          customAttribution:
            "DXCC geometry: amazingproducer/dxcc-world-map · offline prototype",
        }),
        "bottom-right",
      );
      map.addControl(
        new maplibregl.ScaleControl({ unit: "metric" }),
        "top-left",
      );
      map.on("click", "spots", (e) => {
        const id = e.features?.[0]?.properties?.id;
        const s = spots.find((s) => s.id === id);
        if (s) callback.current?.(s);
      });
      map.on("mouseenter", "spots", () => {
        if (callback.current) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "spots", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("error", () => {
        element.dataset.mapError = "Map data could not render";
        setError(
          "Map data could not render. Logging and cluster selection remain available.",
        );
      });
      const resize = new ResizeObserver(() => {
        map.resize();
        if (!preserveCamera.current && !selection.current) fitFixture();
      });
      resize.observe(container.current);
      return () => {
        disposed = true;
        document.removeEventListener("xlog-native-acceptance", requestEvidence);
        document.removeEventListener("xlog-native-map-evidence", requestEvidence);
        window.removeEventListener("focus", repaint);
        resize.disconnect();
        map.remove();
        mapRef.current = null;
      };
    } catch (e) {
      element.dataset.mapError = e instanceof Error ? e.message : String(e);
      setError(
        `Map unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, []);
  useEffect(() => {
    const s = spots.find((s) => s.id === selected);
    if (s && mapRef.current) {
      preserveCamera.current = true;
      mapRef.current.easeTo({
        center: [s.lon, s.lat],
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 180,
      });
    }
  }, [selected]);
  return (
    <div className="map-wrap">
      <div
        ref={container}
        className="map"
        role="region"
        aria-label="Interactive offline world map, arrow keys pan, plus and minus zoom"
      />
      {error && (
        <p className="map-error" role="alert">
          {error}
        </p>
      )}
      <div className="map-legend">
        <span>Offline geography · fixture colours</span>
        <div>
          <i className="dot cyan" /> Needed <i className="dot orange" /> Worked{" "}
          <i className="dot teal" /> Confirmed
        </div>
      </div>
    </div>
  );
}
