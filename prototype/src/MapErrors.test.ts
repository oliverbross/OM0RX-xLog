import { describe, expect, it } from "vitest";
import { describeMapError } from "./MapErrors";

describe("map error attribution", () => {
  it("recognises a raster AJAX error without a top-level source ID", () => {
    const value = describeMapError({ error: { message: "Failed to fetch", url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/tile.jpeg" } });
    expect(value).toEqual({ source: "imagery", detail: "Failed to fetch", imagery: true });
  });
  it("retains genuine source failures and unknown errors instead of classifying them as raster", () => {
    expect(describeMapError({ sourceId: "route", error: { message: "Invalid GeoJSON" } })).toEqual({ source: "route", detail: "Invalid GeoJSON", imagery: false });
    expect(describeMapError({ error: { message: "Style is not loaded" } }).source).toBe("unknown");
    expect(describeMapError({ error: { message: "https://gibs.earthdata.nasa.gov.evil.invalid/wmts/tile" } }).imagery).toBe(false);
  });
  it("strips credentials and query strings while preserving allowlisted map assets", () => {
    expect(describeMapError({ error: { message: "Failed https://user:private@example.org/data?key=private" } }).detail).toBe("Failed [map resource]");
    expect(describeMapError({ error: { message: "Failed https://gibs.earthdata.nasa.gov/wmts/tile.jpeg?key=private" } }).detail).not.toContain("private");
    expect(describeMapError({ error: { message: "Failed tauri://localhost/assets/dxcc-boundaries-AB12.geojson?key=private" } }).detail).toBe("Failed /assets/dxcc-boundaries-AB12.geojson");
    expect(describeMapError({ error: { message: "Bearer private" } }).detail).not.toContain("Bearer private");
  });
  it("bounds diagnostic text and removes control characters", () => {
    expect(describeMapError({ error: { message: `Source\n${"x".repeat(1000)}` } }).detail.length).toBe(240);
    expect(describeMapError({ error: { message: "Source\nfailed" } }).detail).toBe("Source failed");
  });
});
