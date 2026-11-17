import { describe, expect, it } from 'vitest';
import { CITIES } from './data/cities';
import { ORIGINS } from './data/origins';
import { destinationRegion, GLOBE_REGIONS, matchesDestinationRegion } from './regions';
import { matchesDestinationScope, rankCities, scoreCities } from './scoring';
import { nonstopFlightMaps } from './flight-map';

const boston = ORIGINS.find(origin => origin.name === 'Boston')!;
const city = (name: string) => CITIES.find(item => item.name === name)!;
const trip = { start: '2027-07-01', end: '2027-07-14' };

describe('destination region filtering', () => {
  it('assigns every bundled destination to one region and restores all with All regions', () => {
    const regions = new Set(GLOBE_REGIONS.map(region => region.id));
    for (const destination of CITIES) {
      expect(regions.has(destinationRegion(destination)!), destination.name).toBe(true);
      expect(GLOBE_REGIONS.filter(region => matchesDestinationRegion(destination, region.id))).toHaveLength(1);
    }
    expect(CITIES.filter(destination => matchesDestinationRegion(destination, 'all'))).toEqual(CITIES);
    for (const region of GLOBE_REGIONS) expect(CITIES.some(destination => matchesDestinationRegion(destination, region.id))).toBe(true);
  });

  it('ranks only European destinations, including unserved destinations, for different dates', () => {
    const expected = ['Paris', 'London', 'Rome', 'Barcelona', 'Seville', 'Lisbon', 'Athens', 'Santorini',
      'Dubrovnik', 'Amsterdam', 'Prague', 'Copenhagen', 'Interlaken', 'Reykjavik', 'Istanbul',
      'Berlin', 'Brussels', 'Dublin', 'Frankfurt', 'Madrid', 'Milan', 'Stockholm', 'Vienna'].sort();
    for (const trip of [{ start: '2027-01-01', end: '2027-01-07' }, { start: '2027-07-01', end: '2027-07-07' }]) {
      const ranked = rankCities(scoreCities(trip, boston)
        .filter(result => matchesDestinationRegion(result.city, 'europe')));
      expect(ranked.map(result => result.city.name).sort()).toEqual(expected);
      expect(ranked.map(result => result.rank)).toEqual(Array.from({ length: expected.length }, (_, index) => index + 1));
    }
  });

  it('groups overseas locations geographically rather than by their home country', () => {
    expect(destinationRegion(city('Tahiti'))).toBe('oceania');
    expect(destinationRegion(city('Honolulu'))).toBe('oceania');
    expect(destinationRegion(city('San Juan'))).toBe('central-america');
    expect(destinationRegion(city('Mexico City'))).toBe('north-america');
    for (const name of ['Tenerife', 'Puerto de la Cruz', 'La Orotava']) {
      expect(destinationRegion(city(name))).toBe('africa');
      expect(matchesDestinationRegion(city(name), 'europe')).toBe(false);
    }
    expect(matchesDestinationRegion(city('Paris'), 'europe')).toBe(true);
  });

  it('restricts Boston flight arcs to the destinations in Europe', () => {
    const scores = scoreCities(trip, boston, undefined, undefined, true)
      .filter(result => matchesDestinationRegion(result.city, 'europe'));
    const maps = nonstopFlightMaps(scores);
    expect(maps.map(map => map.airports.at(-1)!.code).sort())
      .toEqual(['AMS', 'ATH', 'BCN', 'CDG', 'CPH', 'DUB', 'FCO', 'FRA', 'IST', 'KEF', 'LHR', 'LIS', 'MAD', 'MXP', 'VIE', 'ZRH']);
    expect(maps.every(map => map.destinations.every(destination => matchesDestinationRegion(destination, 'europe')))).toBe(true);
    expect(maps.find(map => map.label === 'BOS → ZRH')!.destinations.map(destination => destination.name)).toEqual(['Interlaken']);
  });

  it('combines region with domestic/global scope without changing country rules', () => {
    const oceania = scoreCities(trip, boston, undefined, undefined, true)
      .filter(result => matchesDestinationRegion(result.city, 'oceania'));
    const domestic = oceania.filter(result => matchesDestinationScope(result.city.country, boston.country, 'domestic'));
    const global = oceania.filter(result => matchesDestinationScope(result.city.country, boston.country, 'international'));
    expect(domestic.map(result => result.city.name)).toEqual(['Honolulu']);
    expect(global.some(result => result.city.name === 'Tahiti')).toBe(true);
    expect(global.some(result => result.city.name === 'Honolulu')).toBe(false);
    expect(nonstopFlightMaps(domestic).map(map => map.label)).toEqual(['BOS → HNL']);
    expect(CITIES.filter(destination => matchesDestinationRegion(destination, 'europe')
      && matchesDestinationScope(destination.country, boston.country, 'domestic'))).toHaveLength(0);
  });
});
