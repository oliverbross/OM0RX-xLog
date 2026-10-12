const sources = new Set(["land", "imagery", "spots", "route", "grayline", "landmarks"]);
type MapErrorEvent = { sourceId?: unknown; source?: { type?: string; tiles?: string[]; data?: unknown }; error?: { message?: string; url?: string } };

function imageryURL(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "gibs.earthdata.nasa.gov" && url.pathname.startsWith("/wmts/"); }
  catch { return false; }
}

/** Keep diagnostics useful without echoing arbitrary resource credentials. */
export function describeMapError(event: MapErrorEvent): { source: string; detail: string; imagery: boolean } {
  const message = typeof event.error?.message === "string" ? event.error.message : "The map renderer reported an error.";
  const urls = message.match(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"')]+/gi) ?? [];
  const source = typeof event.sourceId === "string" && sources.has(event.sourceId) ? event.sourceId :
    imageryURL(event.error?.url) || urls.some(imageryURL) || event.source?.tiles?.some(imageryURL) ? "imagery" : "unknown";
  const detail = /\b(?:authorization|bearer|password|secret|token)\b/i.test(message) ? "Renderer detail withheld because it contains private information." : message
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"')]+/gi, value => {
      try {
        const url = new URL(value);
        if (imageryURL(value)) return `${url.origin}${url.pathname}`;
        if (/\/assets\/(?:dxcc-boundaries|maplibre-gl-worker)[\w.-]*\.(?:geojson|js|mjs)$/.test(url.pathname)) return url.pathname;
      } catch { /* Unrecognised URLs are not echoed. */ }
      return "[map resource]";
    }).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 240);
  return { source, detail, imagery: source === "imagery" };
}
