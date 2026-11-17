import { geoDistance, geoInterpolate } from 'd3';
import type { LineString } from 'geojson';
import { BOSTON_FLIGHTS, isNonstopBostonTrip } from './flights';
import type { City, CityScore, Travel } from './types';

export type FlightDirection = 'outbound' | 'inbound';
export interface RouteAirport { code: string; name: string; coordinates: [number, number] }
export interface FlightMap {
  direction: FlightDirection; airports: RouteAirport[]; legs: LineString[]; label: string;
}
export interface NonstopFlightMap extends FlightMap { destinations: City[] }

/** Draw only recorded flight legs; city coordinates and onward transfers are not flight endpoints. */
export function flightMapFor(travel: Travel, direction: FlightDirection): FlightMap | null {
  const route = travel.mode === 'flight' ? travel.flights?.[direction]?.route : null;
  if (!route) return null;
  const airports: RouteAirport[] = [];
  for (const code of route.path) {
    const airport = BOSTON_FLIGHTS.airports[code];
    if (!airport || !Number.isFinite(airport.lat) || !Number.isFinite(airport.lon)) return null;
    airports.push({ code, name: airport.name, coordinates: [airport.lon, airport.lat] });
  }
  return {
    direction, airports, label: route.path.join(' → '),
    legs: airports.slice(1).map((airport, index) => ({ type: 'LineString', coordinates: [airports[index].coordinates, airport.coordinates] })),
  };
}

/** One outbound arc per airport, using the same round-trip coverage rule as the nonstop filter. */
export function nonstopFlightMaps(destinations: readonly Pick<CityScore, 'city' | 'travel'>[]): NonstopFlightMap[] {
  const routes = new Map<string, NonstopFlightMap>();
  for (const { city, travel } of destinations) {
    if (!isNonstopBostonTrip(travel)) continue;
    const map = flightMapFor(travel, 'outbound');
    if (!map) continue;
    const existing = routes.get(map.label);
    if (!existing) routes.set(map.label, { ...map, destinations: [city] });
    else if (!existing.destinations.some(item => item.name === city.name)) existing.destinations.push(city);
  }
  return [...routes.values()];
}

/** Smallest sampled spherical cap; exact for up to three airports, including antimeridian routes. */
export function flightMapCenter(map: Pick<FlightMap, 'airports'>): [number, number] {
  const points = map.airports.map(airport => airport.coordinates);
  if (!points.length) return [0, 0];
  const candidates: [number, number][] = [...points];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) candidates.push(geoInterpolate(points[i], points[j])(0.5));
  }
  if (points.length === 3) {
    const vectors = points.map(([lon, lat]) => {
      const phi = lat * Math.PI / 180, lambda = lon * Math.PI / 180;
      return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
    });
    const a = vectors[0].map((value, i) => value - vectors[1][i]);
    const b = vectors[0].map((value, i) => value - vectors[2][i]);
    const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const length = Math.hypot(...cross);
    if (length > 1e-10) {
      for (const sign of [1, -1]) candidates.push([
        Math.atan2(sign * cross[1], sign * cross[0]) * 180 / Math.PI,
        Math.asin(Math.max(-1, Math.min(1, sign * cross[2] / length))) * 180 / Math.PI,
      ]);
    }
  }
  const radius = (center: [number, number]) => Math.max(...points.map(point => geoDistance(center, point)));
  return candidates.reduce((best, point) => radius(point) < radius(best) ? point : best);
}
