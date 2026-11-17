import { describe, expect, it } from 'vitest';
import { geoDistance, geoOrthographic, geoPath } from 'd3';
import { CITIES } from './data/cities';
import { ORIGINS } from './data/origins';
import { BOSTON_FLIGHTS } from './flights';
import { flightMapCenter, flightMapFor, nonstopFlightMaps } from './flight-map';
import type { FlightMap } from './flight-map';
import { matchesDestinationScope, travel } from './scoring';

const boston = ORIGINS.find(origin => origin.name === 'Boston')!;
const destination = (name: string) => CITIES.find(city => city.name === name)!;

describe('flight paths on the globe', () => {
  it('maps airport coordinates and stops at the gateway rather than inventing an onward flight', () => {
    const map = flightMapFor(travel(boston, destination('Banff'), 7), 'outbound')!;
    const airport = BOSTON_FLIGHTS.airports.YYC;
    expect(map.label).toBe('BOS → YYC');
    expect(map.legs).toHaveLength(1);
    expect(map.legs[0].coordinates[1]).toEqual([airport.lon, airport.lat]);
    expect(map.legs[0].coordinates[1]).not.toEqual([destination('Banff').lon, destination('Banff').lat]);
  });

  it('draws the actual connection and independently stored return path', () => {
    const trip = travel(boston, destination('Bali'), 7);
    const out = flightMapFor(trip, 'outbound')!, back = flightMapFor(trip, 'inbound')!;
    expect(out.label).toBe('BOS → HKG → DPS');
    expect(back.label).toBe('DPS → NRT → BOS');
    expect(out.legs).toHaveLength(2);
    expect(out.legs[0].coordinates[1]).toEqual(out.legs[1].coordinates[0]);
    expect(back.airports[1].code).toBe('NRT');
  });

  it('does not invent paths for missing directions, driving, or other home cities', () => {
    expect(flightMapFor(travel(boston, destination('Queenstown'), 7), 'outbound')).toBeNull();
    expect(flightMapFor(travel(boston, destination('Patagonia'), 7), 'inbound')).toBeNull();
    expect(flightMapFor(travel(boston, destination('Cape Cod'), 7), 'outbound')).toBeNull();
    const london = ORIGINS.find(origin => origin.name === 'London')!;
    expect(flightMapFor(travel(london, destination('Lisbon'), 7), 'outbound')).toBeNull();
    const island = flightMapFor(travel(boston, destination('Maafushi'), 7), 'outbound')!;
    expect(island.airports.at(-1)!.code).toBe('MLE');
  });

  it('centers every recorded route with all its airports on the visible hemisphere', () => {
    for (const city of CITIES) {
      const trip = travel(boston, city, 7);
      for (const direction of ['outbound', 'inbound'] as const) {
        const map = flightMapFor(trip, direction);
        if (!map) continue;
        const center = flightMapCenter(map);
        expect(center.every(Number.isFinite)).toBe(true);
        for (const airport of map.airports) {
          expect(geoDistance(center, airport.coordinates), `${city.name} ${direction} ${airport.code}`).toBeLessThan(Math.PI / 2 - 0.02);
        }
      }
    }
  });

  it('handles antimeridian centering and clips flight arcs on the far side of the globe', () => {
    const crossing: FlightMap = { direction: 'outbound', label: 'A → B', legs: [], airports: [
      { code: 'A', name: 'A', coordinates: [179, 20] }, { code: 'B', name: 'B', coordinates: [-179, 20] },
    ] };
    expect(Math.abs(flightMapCenter(crossing)[0])).toBeCloseTo(180);
    const map = flightMapFor(travel(boston, destination('Lisbon'), 7), 'outbound')!;
    const [lon, lat] = flightMapCenter(map);
    const projection = geoOrthographic().rotate([-lon, -lat]).clipAngle(90);
    const path = geoPath(projection);
    expect(path(map.legs[0])).toMatch(/^M/);
    projection.rotate([-lon - 180, lat]);
    expect(path(map.legs[0])).toBeNull();
  });

  it('shows every covered nonstop flight together with all endpoints on the visible hemisphere', () => {
    const maps = nonstopFlightMaps(CITIES.map(city => ({ city, travel: travel(boston, city, 7, true) })));
    expect(maps).toHaveLength(44);
    const airports = [...new Map(maps.flatMap(map => map.airports.map(airport => [airport.code, airport] as const))).values()];
    const [lon, lat] = flightMapCenter({ airports });
    const projection = geoOrthographic().rotate([-lon, -lat]).clipAngle(90);
    const path = geoPath(projection);
    for (const map of maps) {
      expect(map.airports[0].code).toBe('BOS');
      expect(map.legs).toHaveLength(1);
      expect(path(map.legs[0]), map.label).toMatch(/^M/);
      for (const airport of map.airports) {
        expect(geoDistance([lon, lat], airport.coordinates), airport.code).toBeLessThan(Math.PI / 2 - 0.02);
      }
    }
  });

  it('deduplicates shared gateways and excludes connecting, driving, missing, and non-Boston journeys', () => {
    const lisbon = { city: destination('Lisbon'), travel: travel(boston, destination('Lisbon'), 7, true) };
    const london = ORIGINS.find(origin => origin.name === 'London')!;
    const maps = nonstopFlightMaps([
      lisbon, lisbon, { ...lisbon, city: { ...lisbon.city, name: 'Shared Lisbon gateway' } },
      { city: destination('Bali'), travel: travel(boston, destination('Bali'), 7) },
      { city: destination('Cape Cod'), travel: travel(boston, destination('Cape Cod'), 7, true) },
      { city: destination('Queenstown'), travel: travel(boston, destination('Queenstown'), 7, true) },
      { city: destination('Lisbon'), travel: travel(london, destination('Lisbon'), 7, true) },
    ]);
    expect(maps.map(map => map.label)).toEqual(['BOS → LIS']);
    expect(maps[0].destinations.map(city => city.name)).toEqual(['Lisbon', 'Shared Lisbon gateway']);
    expect(nonstopFlightMaps([])).toEqual([]);
  });

  it('keeps the destination identity when the flight ends at a different gateway city', () => {
    const city = destination('Banff');
    const [map] = nonstopFlightMaps([{ city, travel: travel(boston, city, 7, true) }]);
    expect(map.label).toBe('BOS → YYC');
    expect(map.destinations.map(item => item.name)).toEqual(['Banff']);
  });

  it('limits the network to the supplied destination scope', () => {
    const domestic = CITIES.filter(city => matchesDestinationScope(city.country, boston.country, 'domestic'));
    const maps = nonstopFlightMaps(domestic.map(city => ({ city, travel: travel(boston, city, 7, true) })));
    expect(maps.map(map => map.airports[1].code).sort()).toEqual(['DAL', 'DCA', 'DEN', 'HNL', 'LAS', 'LAX', 'MDW', 'MIA', 'MSY', 'SAN', 'SEA', 'SFO', 'SJU']);
  });
});
