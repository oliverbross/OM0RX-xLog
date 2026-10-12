export type Coordinate = [number, number]; // longitude, latitude

const radians = (degrees: number) => degrees * Math.PI / 180;
const degrees = (radiansValue: number) => radiansValue * 180 / Math.PI;
const wrapLongitude = (longitude: number) => ((longitude + 540) % 360) - 180;

export function solarPosition(at: Date): Coordinate {
  const yearStart = Date.UTC(at.getUTCFullYear(), 0, 1);
  const day = (Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) - yearStart) / 86_400_000 + 1;
  const hour = at.getUTCHours() + at.getUTCMinutes() / 60 + at.getUTCSeconds() / 3600;
  const gamma = 2 * Math.PI / 365 * (day - 1 + (hour - 12) / 24);
  const equationMinutes = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma)
    - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  return [wrapLongitude((720 - hour * 60 - equationMinutes) / 4), degrees(declination)];
}

export function splitAntimeridian(points: Coordinate[]): Coordinate[][] {
  const sections: Coordinate[][] = [];
  for (const point of points) {
    const section = sections[sections.length - 1];
    if (!section || (section.length && Math.abs(section[section.length - 1][0] - point[0]) > 180)) {
      sections.push([point]);
    } else section.push(point);
  }
  return sections.filter(section => section.length > 1);
}

export function grayline(at: Date): Coordinate[][] {
  const [sunLon, sunLat] = solarPosition(at);
  const lon = radians(sunLon), lat = radians(sunLat);
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const points: Coordinate[] = [];
  for (let step = 0; step <= 360; step += 2) {
    const angle = radians(step);
    const x = east[0] * Math.cos(angle) + north[0] * Math.sin(angle);
    const y = east[1] * Math.cos(angle) + north[1] * Math.sin(angle);
    const z = east[2] * Math.cos(angle) + north[2] * Math.sin(angle);
    points.push([wrapLongitude(degrees(Math.atan2(y, x))), degrees(Math.asin(z))]);
  }
  return splitAntimeridian(points);
}

// On a Mercator map the night hemisphere is the area poleward of a single
// terminator latitude at each longitude. Build one closed ring across the
// full [-180, 180] domain, so the date-line seam and polar caps stay filled.
export function nightHemisphere(sun: Coordinate): Coordinate[][] {
  const mercatorLimit = 85.05112878;
  const [sunLongitude, sunLatitude] = sun;
  const sinDeclination = Math.sin(radians(sunLatitude));
  const denominator = Math.abs(sinDeclination) < 1e-10 ? 1e-10 : sinDeclination;
  const cosDeclination = Math.cos(radians(sunLatitude));
  const terminator = (longitude: number): Coordinate => {
    const latitude = degrees(Math.atan(-cosDeclination * Math.cos(radians(longitude - sunLongitude)) / denominator));
    return [longitude, Math.max(-mercatorLimit, Math.min(mercatorLimit, latitude))];
  };
  const northNight = sinDeclination < 0;
  const pole = northNight ? mercatorLimit : -mercatorLimit;
  const ring: Coordinate[] = northNight ? [[-180, pole]] : [[-180, pole], [180, pole]];
  for (let longitude = northNight ? -180 : 180;
    northNight ? longitude <= 180 : longitude >= -180;
    longitude += northNight ? 1 : -1) ring.push(terminator(longitude));
  if (northNight) ring.push([180, pole]);
  ring.push([-180, pole]);
  return [ring];
}

export function greatCircle(from: Coordinate, to: Coordinate, longPath = false): Coordinate[][] {
  const vector = ([lon, lat]: Coordinate) => [Math.cos(radians(lat)) * Math.cos(radians(lon)),
    Math.cos(radians(lat)) * Math.sin(radians(lon)), Math.sin(radians(lat))];
  const a = vector(from), b = vector(to);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.acos(dot);
  if (angle < 1e-7 || Math.abs(Math.PI - angle) < 1e-7) return [];
  const sinAngle = Math.sin(angle);
  const tangent = b.map((component, index) => (component - a[index] * dot) / sinAngle);
  const extent = longPath ? angle - Math.PI * 2 : angle;
  const count = Math.max(64, Math.ceil(Math.abs(extent) * 180 / Math.PI));
  const points: Coordinate[] = [];
  for (let step = 0; step <= count; step++) {
    const t = extent * step / count;
    const x = a[0] * Math.cos(t) + tangent[0] * Math.sin(t);
    const y = a[1] * Math.cos(t) + tangent[1] * Math.sin(t);
    const z = a[2] * Math.cos(t) + tangent[2] * Math.sin(t);
    points.push([wrapLongitude(degrees(Math.atan2(y, x))), degrees(Math.atan2(z, Math.hypot(x, y)))]);
  }
  return splitAntimeridian(points);
}

export function bearingAndDistance(from: Coordinate, to: Coordinate): { distanceKm: number; shortBearing: number; longBearing: number } {
  const [lon1, lat1] = from.map(radians), [lon2, lat2] = to.map(radians);
  const delta = lon2 - lon1;
  const y = Math.sin(delta) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta);
  const cosine = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(delta);
  const shortBearing = (degrees(Math.atan2(y, x)) + 360) % 360;
  return { distanceKm: 6371.0088 * Math.acos(Math.max(-1, Math.min(1, cosine))),
    shortBearing, longBearing: (shortBearing + 180) % 360 };
}
