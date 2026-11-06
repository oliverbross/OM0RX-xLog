// Development-only fixture. The geometry harness supplies a throwing MapLibre
// constructor; this page does not mount the map when opened outside that harness.
import { createRoot } from "react-dom/client";
import WorldMap from "../../src/Map";
import "../../src/style.css";
import "../../src/live/DeskMapLogbook.css";

const compact = new URLSearchParams(location.search).get("compact") === "1";
const ownRbnTransport = async (source: string) => {
  if (source !== "own_rbn") throw new Error("Outside synthetic Heard-me fixture");
  return JSON.stringify({ spots: {}, call_info: {} });
};
const armed = (window as Window & { __xlogMapErrorFixture?: boolean }).__xlogMapErrorFixture === true;
createRoot(document.getElementById("root")!).render(armed ? (
  <main style={{ padding: 16 }}>
    <p>Synthetic map error · no native or device access</p>
    <section className={"map-error-fixture-pane" + (compact ? " desk-map-logbook-map" : "")}
      aria-label="Synthetic map error pane"
      style={{ display: "flex", width: 798, height: 520, minWidth: 0 }}>
      <WorldMap selected={null} data={[]} fixture compact={compact}
        ownCall="K1TEST" ownRbnContext="synthetic-map-error" frequencyHz={14025000}
        ownRbnTransport={ownRbnTransport} />
    </section>
  </main>
) : <p>Run this inert fixture with map-error-layout.playwright.js.</p>);
