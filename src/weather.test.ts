import { describe, expect, it } from 'vitest';
import { ORIGINS } from './data/origins';
import { climateFor } from './climate';
import { scoreCities, sampleDays, shiftTripMonth } from './scoring';
import { primaryWeatherFlag, weatherFlagsFor } from './weather';
import { weatherDetails } from './format';
import { CITIES } from './data/cities';

const boston = ORIGINS.find(city => city.name === 'Boston')!;
const scores = (start: string, end = start) => scoreCities({ start, end }, boston);
const place = (name: string, start: string, end = start) => scores(start, end).find(result => result.city.name === name)!;
const has = (name: string, date: string, label: string) => place(name, date).weatherFlags.some(flag => flag.label === label);

describe('date-sensitive weather on the globe', () => {
  it('distinguishes local wet and dry periods, including southern-hemisphere winter rain', () => {
    expect(has('Bali', '2027-01-15', 'Wet-season pattern')).toBe(true);
    expect(has('Bali', '2027-08-15', 'Wet-season pattern')).toBe(false);
    expect(has('Phuket', '2027-09-15', 'Wet-season pattern')).toBe(true);
    expect(has('Phuket', '2027-02-15', 'Wet-season pattern')).toBe(false);
    expect(has('Cape Town', '2027-06-15', 'Wet-season pattern')).toBe(true);
    expect(has('Cape Town', '2027-01-15', 'Wet-season pattern')).toBe(false);
    expect(has('Dubai', '2027-01-15', 'Wet-season pattern')).toBe(false);
  });

  it('uses exact inclusive storm-season boundaries rather than a peak-month curve', () => {
    expect(has('Miami', '2027-05-31', 'Hurricane season')).toBe(false);
    expect(has('Miami', '2027-06-01', 'Hurricane season')).toBe(true);
    expect(has('Miami', '2027-11-30', 'Hurricane season')).toBe(true);
    expect(has('Miami', '2027-12-01', 'Hurricane season')).toBe(false);
    expect(has('Mauritius', '2027-05-15', 'Cyclone season')).toBe(true);
    expect(has('Mauritius', '2027-05-16', 'Cyclone season')).toBe(false);
    expect(place('Fiji', '2026-12-28', '2027-01-06').risks).toContain('Cyclone season');
  });

  it('checks the actual end of a long trip even when the scoring samples omit it', () => {
    const trip = { start: '2027-01-01', end: '2027-06-01' };
    const sample = sampleDays(trip);
    expect(sample.days.at(-1)!.timestamp).toBeLessThan(Date.parse(trip.end));
    expect(place('Miami', trip.start, trip.end).risks).toContain('Hurricane season');
  });

  it('flags heat and freezing nights independently of the preferred temperature range', () => {
    expect(has('Dubai', '2027-07-15', 'Hot daytime highs')).toBe(true);
    expect(has('Dubai', '2027-01-15', 'Hot daytime highs')).toBe(false);
    expect(has('Banff', '2027-01-15', 'Freezing nights')).toBe(true);
    expect(has('Banff', '2027-07-15', 'Freezing nights')).toBe(false);
    const dubai = place('Dubai', '2027-07-15');
    expect(weatherDetails(dubai, 'F')).toContain('°F');
    expect(weatherDetails(dubai, 'C')).toContain('°C');
  });

  it('keeps frequent precipitation distinct from a seasonal wet/dry cycle', () => {
    const city = CITIES.find(item => item.name === 'Lisbon')!;
    const climate = climateFor(city.name);
    const uniform = { ...climate, months: climate.months.map(month => ({ ...month, monthlyPrecip: 150, wetDays: .8 * month.precipitationDays })) };
    const flags = weatherFlagsFor(city, uniform, sampleDays({ start: '2027-06-01', end: '2027-06-14' }), { highs: [25], lows: [15], wet: [.8] });
    expect(flags.map(flag => flag.label)).toContain('Frequent wet days');
    expect(flags.map(flag => flag.label)).not.toContain('Wet-season pattern');
  });

  it('lets the wet overlay expose rain even when a destination also has a storm flag', () => {
    const result = place('Miami', '2027-09-15');
    expect(primaryWeatherFlag(result.weatherFlags, 'all')?.kind).toBe('storm');
    expect(primaryWeatherFlag(result.weatherFlags, 'wet')?.kind).toBe('wet');
    expect(primaryWeatherFlag(result.weatherFlags, 'off')).toBeUndefined();
    expect(result.weatherFlags.some(flag => flag.kind === 'storm')).toBe(true);
  });

  it('retains regional monsoon coverage and identifies estimated notes honestly', () => {
    for (const name of ['Goa', 'Panaji', 'Palolem']) {
      const flag = place(name, '2027-07-15').weatherFlags.find(item => item.label === 'Monsoon season')!;
      expect(flag.basis).toBe('calendar');
      expect(flag.sourceUrl).toBe('https://dip.goa.gov.in/climate/');
    }
    const seoul = place('Seoul', '2027-09-01');
    expect(seoul.weatherFlags.find(flag => flag.label === 'Typhoon season')?.basis).toBe('estimate');
    expect(weatherDetails(seoul, 'F')).toContain('Typhoon season (estimate)');
  });


});

describe('moving the travel dates', () => {
  it('preserves trip length at short month ends, leap years, and New Year', () => {
    expect(shiftTripMonth({ start: '2027-01-31', end: '2027-02-06' }, 1)).toEqual({ start: '2027-02-28', end: '2027-03-06' });
    expect(shiftTripMonth({ start: '2028-01-31', end: '2028-02-06' }, 1)).toEqual({ start: '2028-02-29', end: '2028-03-06' });
    expect(shiftTripMonth({ start: '2026-12-20', end: '2027-01-03' }, 1)).toEqual({ start: '2027-01-20', end: '2027-02-03' });
    expect(shiftTripMonth({ start: '2027-01-15', end: '2027-01-21' }, -1)).toEqual({ start: '2026-12-15', end: '2026-12-21' });
  });

  it('does not overwrite invalid or incomplete custom dates', () => {
    expect(shiftTripMonth({ start: '', end: '2027-01-01' }, 1)).toBeNull();
    expect(shiftTripMonth({ start: '2027-01-02', end: '2027-01-01' }, 1)).toBeNull();
  });
});
