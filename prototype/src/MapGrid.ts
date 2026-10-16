import type { Coordinate } from "./MapGeography";

export type MaidenheadGridBounds = { west: number; east: number; south: number; north: number };
export type MaidenheadGridLabel = { key: string; locator: string; coordinate: Coordinate };
export type MaidenheadGrid = { lines: Coordinate[][]; labels: MaidenheadGridLabel[]; precision: number };

// Wavelog's Leaflet Maidenhead layer changes cell size and locator precision
// at these integer zoom levels. MapLibre zooms are fractional, so use the
// completed integer level to preserve the same progression.
const units = [20, 10, 10, 10, 10, 10, 1, 1, 1, 1, 1 / 24, 1 / 24, 1 / 24, 1 / 24, 1 / 24,
  1 / 240, 1 / 240, 1 / 240, 1 / 240, 1 / 5760, 1 / 5760];
const precisions = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5];
const fieldLetters = "ABCDEFGHIJKLMNOPQR";
const subsquareLetters = "ABCDEFGHIJKLMNOPQRSTUVWX";
const divisions = [10, 1, 1 / 24, 1 / 240, 1 / 5760];

const positiveRemainder = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

export function maidenheadLocator(longitude: number, latitude: number, precision = 3): string {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return "";
  let lon = longitude;
  while (lon < -180) lon += 360;
  while (lon >= 180) lon -= 360;
  const x = lon + 180;
  const y = Math.min(180 - Number.EPSILON, Math.max(0, latitude + 90));
  let locator = fieldLetters[Math.floor(x / 20)] + fieldLetters[Math.floor(y / 10)];
  for (let index = 0; index < 4 && precision > index + 1; index++) {
    const lonIndex = Math.floor(positiveRemainder(x, divisions[index] * 2) / (divisions[index + 1] * 2));
    const latIndex = Math.floor(positiveRemainder(y, divisions[index]) / divisions[index + 1]);
    locator += index % 2 === 0 ? `${lonIndex}${latIndex}`
      : `${subsquareLetters[lonIndex]}${subsquareLetters[latIndex]}`;
  }
  return locator;
}

function definition(bounds: MaidenheadGridBounds, zoom: number, maxCells: number) {
  let level = Math.max(0, Math.min(units.length - 1, Math.floor(zoom)));
  const dimensions = () => {
    const unit = units[level], width = unit * 2;
    const left = Math.floor(bounds.west / width) * width;
    const right = Math.ceil(bounds.east / width) * width;
    const bottom = Math.floor(Math.max(-85, bounds.south) / unit) * unit;
    const top = Math.ceil(Math.min(85, bounds.north) / unit) * unit;
    return { unit, width, left, right, bottom, top,
      cells: Math.max(0, Math.ceil((right - left) / width)) * Math.max(0, Math.ceil((top - bottom) / unit)) };
  };
  let result = dimensions();
  while (result.cells > maxCells && level > 0) { level--; result = dimensions(); }
  return { ...result, precision: precisions[level] };
}

export function maidenheadGrid(bounds: MaidenheadGridBounds, zoom: number, maxCells = 1200): MaidenheadGrid {
  if (![bounds.west, bounds.east, bounds.south, bounds.north, zoom].every(Number.isFinite)
    || bounds.east <= bounds.west || bounds.north <= bounds.south) return { lines: [], labels: [], precision: 1 };
  const normalized = { west: Math.max(-180, bounds.west), east: Math.min(180, bounds.east),
    south: Math.max(-85, bounds.south), north: Math.min(85, bounds.north) };
  if (normalized.east <= normalized.west || normalized.north <= normalized.south)
    return { lines: [], labels: [], precision: 1 };
  const { unit, width, left, right, bottom, top, precision } = definition(normalized, zoom, maxCells);
  const lines: Coordinate[][] = [], labels: MaidenheadGridLabel[] = [];
  const columns = Math.round((right - left) / width), rows = Math.round((top - bottom) / unit);
  for (let column = 0; column < columns; column++) {
    const west = left + column * width, east = west + width;
    for (let row = 0; row < rows; row++) {
      const south = bottom + row * unit, north = south + unit;
      lines.push([[west, south], [east, south], [east, north], [west, north], [west, south]]);
      const coordinate: Coordinate = [west + width / 2, south + unit / 2];
      const locator = maidenheadLocator(coordinate[0], coordinate[1], precision);
      if (coordinate[0] >= -180 && coordinate[0] < 180 && locator)
        labels.push({ key: `${west}:${south}:${precision}`, locator, coordinate });
    }
  }
  return { lines, labels, precision };
}
