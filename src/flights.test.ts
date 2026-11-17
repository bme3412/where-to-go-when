import { describe, expect, it } from 'vitest';
import { CITIES } from './data/cities';
import { ORIGINS } from './data/origins';
import { BOSTON_FLIGHTS, bostonTrip, isNonstopBostonTrip } from './flights';
import { flightDetails, flightLabel, flightRouteDetails, cityTooltip, scoreBreakdown } from './format';
import { distance, matchesDestinationScope, scoreCities, travel } from './scoring';

const boston = ORIGINS.find(origin => origin.name === 'Boston')!;
const london = ORIGINS.find(origin => origin.name === 'London')!;
const destination = (name: string) => CITIES.find(city => city.name === name)!;

describe('offline Boston flights', () => {
  it('covers every destination, with directed BOS paths and auditable leg totals', () => {
    expect(Object.keys(BOSTON_FLIGHTS.destinations).sort()).toEqual(CITIES.filter(city => city.name !== 'Boston').map(city => city.name).sort());
    expect(BOSTON_FLIGHTS.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(BOSTON_FLIGHTS.source.snapshotDate).toBeNull();
    for (const entry of Object.values(BOSTON_FLIGHTS.destinations)) {
      for (const direction of ['outbound', 'inbound', 'nonstopOutbound', 'nonstopInbound'] as const) {
        const route = entry[direction];
        if (!route) continue;
        expect(route.path[direction === 'outbound' || direction === 'nonstopOutbound' ? 0 : route.path.length - 1]).toBe('BOS');
        expect(route.path.length).toBeGreaterThanOrEqual(2);
        expect(route.path.length).toBeLessThanOrEqual(3);
        if (direction.startsWith('nonstop')) expect(route.legs).toHaveLength(1);
        expect(new Set(route.path).size).toBe(route.path.length);
        expect(route.legs.length).toBe(route.path.length - 1);
        expect(route.flightMinutes).toBe(route.legs.reduce((sum, leg) => sum + leg.minutes, 0));
        route.legs.forEach((leg, i) => {
          expect([leg.from, leg.to]).toEqual(route.path.slice(i, i + 2));
          expect(leg.minutes).toBeGreaterThan(0);
          expect(leg.airlines.length).toBeGreaterThan(0);
          expect(leg.airlines.every(code => BOSTON_FLIGHTS.airlines[code])).toBe(true);
        });
      }
    }
  });

  it('uses different outbound and return times in the usable-days score', () => {
    const result = travel(boston, destination('Lisbon'), 7);
    expect(result.flights!.outbound!.route.flightMinutes).toBe(395);
    expect(result.flights!.inbound!.route.flightMinutes).toBe(465);
    // 45 min Boston transfer + 120 before departure + 45 after arrival + 30 in Lisbon.
    expect(result.hours).toBeCloseTo((395 + 240) / 60);
    expect(result.returnHours).toBeCloseTo((465 + 240) / 60);
    expect(result.lost).toBeCloseTo((635 + 705) / 60 / 14 + 0.5);
    expect(result.factor).toBeCloseTo((7 - result.lost) / 7);
    expect(result.basis).toBe('routes');
  });

  it('adds a connection allowance in each direction for Bali', () => {
    const trip = bostonTrip('Bali');
    expect(trip.outbound!.route.path).toEqual(['BOS', 'HKG', 'DPS']);
    expect(trip.inbound!.route.path).toEqual(['DPS', 'NRT', 'BOS']);
    for (const journey of [trip.outbound!, trip.inbound!]) {
      expect(journey.connectionMinutes).toBe(150);
      expect(journey.totalMinutes).toBe(journey.route.flightMinutes + 150 + 210 + journey.gateway.minutes!);
    }
    expect(flightLabel(travel(boston, destination('Bali'), 7))).toBe('1 connection via HKG');
  });

  it('includes reviewed regional gateways and their onward transfers', () => {
    expect(bostonTrip('Banff').outbound!.gateway).toMatchObject({ iata: 'YYC', minutes: 120, basis: 'reviewed' });
    expect(bostonTrip('Interlaken').outbound!.gateway).toMatchObject({ iata: 'ZRH', minutes: 150, mode: 'train' });
    expect(travel(boston, destination('Banff'), 7).basis).toBe('routes');
  });

  it('keeps nearby destinations as driving trips', () => {
    for (const name of ['Cape Cod', 'New York']) {
      const result = travel(boston, destination(name), 7);
      expect(result.mode).toBe('drive');
      expect(result.flights).toBeUndefined();
      expect(result.returnHours).toBe(result.hours);
      expect(flightDetails(result)).toBe('');
    }
    expect(travel(boston, destination('Cape Cod'), 7).hours).toBeLessThan(2);
  });

  it('does not apply BOS routes to another home city', () => {
    const result = travel(london, destination('Lisbon'), 7);
    expect(result.flights).toBeUndefined();
    expect(result.basis).toBe('distance');
    expect(result.hours).toBeCloseTo(distance(london, destination('Lisbon')) / 780 + 2.6);
    expect(result.returnHours).toBe(result.hours);
  });

  it('keeps destinations with no route or airport mapping and labels the fallback', () => {
    for (const name of ['Queenstown', 'Petra']) {
      const result = travel(boston, destination(name), 7);
      expect(result.basis).toBe('distance');
      expect(result.hours).toBeGreaterThan(0);
      expect(Number.isFinite(result.factor)).toBe(true);
      expect(flightLabel(result)).toBe('Route coverage incomplete');
      expect(flightDetails(result)).toContain('The score uses a distance estimate');
    }
    expect(flightDetails(travel(boston, destination('Queenstown'), 7))).toContain('Longer routes may exist');
    expect(flightDetails(travel(boston, destination('Petra'), 7))).toContain('No gateway airport');
    expect(bostonTrip('Unlisted destination').hasGateway).toBe(false);
  });

  it('does not invent a return leg when only the outbound route exists', () => {
    const result = travel(boston, destination('Patagonia'), 7);
    expect(result.basis).toBe('mixed');
    expect(result.flights!.outbound!.route.path).toEqual(['BOS', 'GRU', 'FTE']);
    expect(result.flights!.inbound).toBeNull();
    expect(result.hours).toBe(result.flights!.outbound!.totalMinutes! / 60);
    expect(result.returnHours).toBeCloseTo(result.km / 780 + 4.6);
    expect(flightLabel(result)).toContain('return incomplete');
  });

  it('does not treat an unknown island transfer as zero minutes', () => {
    const result = travel(boston, destination('Maafushi'), 7);
    expect(result.flights!.outbound!.route.path).toContain('MLE');
    expect(result.flights!.outbound!.totalMinutes).toBeNull();
    expect(result.flights!.inbound!.totalMinutes).toBeNull();
    expect(result.basis).toBe('distance');
    expect(flightDetails(result)).toContain('Onward transfer unverified');
  });

  it('explains the data limits and actual scoring basis in destination details', () => {
    const result = scoreCities({ start: '2027-06-01', end: '2027-06-08' }, boston).find(city => city.city.name === 'Lisbon')!;
    const html = cityTooltip(result, 'F') + flightDetails(result.travel) + scoreBreakdown(result, 'F');
    expect(html).toContain('Nonstop listed');
    expect(html).toContain('Source snapshot date unknown');
    expect(html).toContain('seasonal service');
    expect(html).toContain('through-ticket availability are unverified');
    expect(html).toContain('Stored flight time');
    expect(html).toContain('7h 45m');
    expect(html).toContain('Uses saved BOS routes in both directions');
    expect(html).not.toContain('Routes and schedules are not checked.');
  });

  it('filters to nonstop flights in both directions, excluding drives and missing returns', () => {
    const candidates = scoreCities({ start: '2027-06-01', end: '2027-06-08' }, boston, undefined, undefined, true);
    const selected = candidates.filter(result => isNonstopBostonTrip(result.travel));
    const names = selected.map(result => result.city.name);
    expect(names).toEqual(expect.arrayContaining(['Lisbon', 'Miami', 'Banff', 'Interlaken']));
    for (const name of ['Bali', 'Cape Cod', 'New York', 'Patagonia', 'Maafushi', 'Queenstown']) expect(names).not.toContain(name);
    for (const result of selected) {
      expect(result.travel.flights!.outbound!.route.path).toHaveLength(2);
      expect(result.travel.flights!.inbound!.route.path).toHaveLength(2);
      expect(result.travel.flights!.outbound!.connectionMinutes).toBe(0);
      expect(result.travel.flights!.inbound!.connectionMinutes).toBe(0);
    }
    const partial = travel(boston, destination('Lisbon'), 7, true);
    expect(isNonstopBostonTrip({ ...partial, flights: { ...partial.flights!, inbound: null } })).toBe(false);
  });

  it('combines nonstop routes with the existing domestic and international filters', () => {
    const nonstop = scoreCities({ start: '2027-06-01', end: '2027-06-08' }, boston, undefined, undefined, true).filter(result => isNonstopBostonTrip(result.travel));
    const domestic = nonstop.filter(result => matchesDestinationScope(result.city.country, boston.country, 'domestic')).map(result => result.city.name);
    const international = nonstop.filter(result => matchesDestinationScope(result.city.country, boston.country, 'international')).map(result => result.city.name);
    expect(domestic).toContain('San Juan');
    expect(domestic).not.toContain('Lisbon');
    expect(international).toContain('Lisbon');
    expect(international).not.toContain('San Juan');
    expect(domestic.length + international.length).toBe(nonstop.length);
  });

  it('ignores the Boston route preference for other home cities', () => {
    expect(travel(london, destination('Lisbon'), 7, true)).toEqual(travel(london, destination('Lisbon'), 7));
  });

  it('shows flight-only times and airlines for the selected direction', () => {
    const trip = bostonTrip('Lisbon', true);
    const out = flightRouteDetails(trip.outbound!.route), back = flightRouteDetails(trip.inbound!.route);
    expect(out).toContain('Flight time: ~6h 35m');
    expect(out).toContain('Delta Air Lines, TAP Portugal');
    expect(back).toContain('Flight time: ~7h 45m');
    expect(out).toContain('excludes transfers');
    const banff = flightRouteDetails(bostonTrip('Banff', true).outbound!.route);
    expect(banff).toContain('Flight time: ~5h 25m');
    expect(banff).toContain('WestJet');
    expect(flightRouteDetails(null)).toBe('');
  });

  it('keeps carriers attached to their own connection leg', () => {
    const html = flightRouteDetails({ path: ['BOS', 'LHR', 'LIS'], flightMinutes: 520, legs: [
      { from: 'BOS', to: 'LHR', minutes: 400, airlines: ['BOS carrier'] },
      { from: 'LHR', to: 'LIS', minutes: 120, airlines: ['<unlisted>'] },
    ] });
    expect(html).toContain('Flight time: ~8h 40m');
    expect(html).toContain('excludes transfers and layovers');
    expect(html).toContain('BOS → LHR</strong> · 6h 40m · Airlines: BOS carrier');
    expect(html).toContain('LHR → LIS</strong> · 2h · Airlines: &lt;unlisted&gt;');
  });
});
