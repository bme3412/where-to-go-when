import { describe, expect, it } from 'vitest';
import { CITIES } from './data/cities';
import { ORIGINS } from './data/origins';
import { TZ } from './data/timezones';
import { DAY, DEFAULT_WEIGHTS, defaultTrip, easter, geometricMean, interp, matchesDestinationScope, rankCities, sampleDays, scoreCities, scoreCountry, thanksgiving, travel, tripEvents, validateTrip, weatherFit } from './scoring';

const boston = ORIGINS.find(city => city.name === 'Boston')!;
const london = ORIGINS.find(city => city.name === 'London')!;
const destination = (name: string) => CITIES.find(city => city.name === name)!;
const results = (start: string, end: string, home = boston) => scoreCities({ start, end }, home, DEFAULT_WEIGHTS);
const topFive = (start: string, end: string, home = boston) => rankCities(results(start, end, home)).slice(0, 5).map(result => result.city.name);

describe('reference data', () => {
  it('contains all 71 destinations, 24 origins, and timezone offsets', () => {
    expect(CITIES).toHaveLength(71);
    expect(ORIGINS).toHaveLength(24);
    expect(CITIES.every(city => Number.isFinite(TZ[city.name]) && city.high.length === 12 && city.rain.length === 12)).toBe(true);
  });
});

describe('calendar and interpolation', () => {
  const series = Array.from({ length: 12 }, (_, month) => month * 10);
  it('hits the exact monthly value at every midpoint', () => {
    for (let month = 0; month < 12; month++) expect(interp(series, month + 0.5)).toBe(series[month]);
  });
  it('blends across December and January in both directions', () => {
    expect(interp(series, 0)).toBe(55);
    expect(interp(series, 12)).toBe(55);
    expect(interp(series, 11.75)).toBe(82.5);
    expect(interp(series, 0.25)).toBe(27.5);
  });
  it('computes Gregorian Easter and Thanksgiving', () => {
    expect(easter(2027).toISOString().slice(0, 10)).toBe('2027-03-28');
    expect(easter(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(thanksgiving(2026).toISOString().slice(0, 10)).toBe('2026-11-26');
  });
  it('counts both ends, leap days, and DST boundaries as calendar days', () => {
    expect(sampleDays({ start: '2026-12-20', end: '2027-01-03' }).tripDays).toBe(15);
    expect(sampleDays({ start: '2028-02-28', end: '2028-03-01' }).tripDays).toBe(3);
    expect(sampleDays({ start: '2027-03-13', end: '2027-03-15' }).tripDays).toBe(3);
    expect(sampleDays({ start: '2027-04-01', end: '2027-04-01' }).tripDays).toBe(1);
  });
  it('bounds sampling to 90 days for long ranges', () => {
    const sample = sampleDays({ start: '2027-01-01', end: '2027-12-31' });
    expect(sample.step).toBe(5);
    expect(sample.days).toHaveLength(73);
    expect(sample.days[1].timestamp - sample.days[0].timestamp).toBe(5 * DAY);
  });
  it('validates missing, invalid, and reversed dates', () => {
    expect(validateTrip({ start: '', end: '2027-01-03' })).toBe('Pick both dates');
    expect(validateTrip({ start: '2027-02-30', end: '2027-03-05' })).toBe('Pick both dates');
    expect(validateTrip({ start: '2027-04-12', end: '2027-04-03' })).toBe('End date must be after the start date');
  });
  it('selects the next upcoming holiday season', () => {
    expect(defaultTrip(new Date(2026, 10, 16))).toEqual({ start: '2026-12-20', end: '2027-01-03' });
    expect(defaultTrip(new Date(2026, 11, 21))).toEqual({ start: '2027-12-20', end: '2028-01-03' });
  });
  it('includes events spilling over from the previous year', () => {
    const events = tripEvents({ start: '2027-01-01', end: '2027-01-03' });
    expect(events.some(event => event.name === "New Year's Eve" && event.start < Date.parse('2027-01-01') && event.end >= Date.parse('2027-01-01'))).toBe(true);
    expect(results('2027-01-01', '2027-01-01').find(result => result.city.name === 'Sydney')!.events).toContain("New Year's Eve");
  });
});

describe('travel and scoring', () => {
  it('treats Boston to Cape Cod as a drive under 2 hours', () => {
    const result = travel(boston, destination('Cape Cod'), 7);
    expect(result.mode).toBe('drive');
    expect(result.hours).toBeLessThan(2);
  });
  it('accounts for long-haul travel and lost usable days', () => {
    const result = travel(boston, destination('Bali'), 7);
    expect(result.hours).toBeGreaterThanOrEqual(20);
    expect(result.factor).toBeLessThan(0.4);
    expect(result.timeShift).toBe(11);
  });
  it('uses a geometric mean and a neutral fallback when all climate weights are zero', () => {
    expect(geometricMean([[1, 1], [0.25, 1]])).toBeCloseTo(0.5);
    expect(geometricMean([[0, 0], [1, 0]])).toBe(0.5);
    expect(weatherFit(19, 3)).toBe(1);
  });
  it('recommends San Diego and Mexico City for the holidays', () => {
    expect(topFive('2026-12-20', '2027-01-03')).toEqual(expect.arrayContaining(['San Diego', 'Mexico City']));
  });
  it('ranks San Diego first, with Cusco and Lisbon for April from Boston', () => {
    const picks = topFive('2027-04-03', '2027-04-12');
    expect(picks[0]).toBe('San Diego');
    expect(picks).toEqual(expect.arrayContaining(['Cusco', 'Lisbon']));
  });
  it('recommends the Mediterranean and Cairo for April from London', () => {
    expect(topFive('2027-04-01', '2027-04-14', london)).toEqual(expect.arrayContaining(['Santorini', 'Athens', 'Cairo', 'Lisbon', 'Barcelona']));
  });
  it('flags July monsoon rain in Goa and September hurricanes in Miami', () => {
    expect(results('2027-07-10', '2027-07-20').find(result => result.city.name === 'Goa')!.dealbreakers).toContain('Very rainy');
    expect(results('2027-09-12', '2027-09-18').find(result => result.city.name === 'Miami')!.risks).toContain('Hurricane season');
  });
  it('excludes home from ranking and keeps scores and good days bounded', () => {
    const scores = results('2027-01-01', '2027-12-31');
    expect(rankCities(scores).some(result => result.city.name === 'Boston')).toBe(false);
    expect(scores.every(result => result.score >= 0 && result.score <= 100 && result.goodDays <= result.tripDays && result.travel.usable >= 0)).toBe(true);
  });
  it('leaves Antarctica unscored', () => {
    expect(scoreCountry({ name: 'Antarctica', lat: -90, lon: 0, tz: 0 }, boston, sampleDays({ start: '2027-01-01', end: '2027-01-07' }), DEFAULT_WEIGHTS)).toBeNull();
  });
});

describe('domestic and international destinations', () => {
  const trip = { start: '2026-12-20', end: '2027-01-03' };
  const scoped = (originName: string, scope: 'all' | 'domestic' | 'international') => {
    const home = ORIGINS.find(origin => origin.name === originName)!;
    return rankCities(scoreCities(trip, home).filter(result => matchesDestinationScope(result.city.country, home.country, scope)));
  };
  it('keeps the original ranking when All is selected', () => {
    expect(scoped('Boston', 'all')).toEqual(rankCities(scoreCities(trip, boston)));
  });
  it('includes US destinations and Puerto Rico in domestic picks from Boston', () => {
    const names = scoped('Boston', 'domestic').map(result => result.city.name);
    expect(names).toEqual(expect.arrayContaining(['San Diego', 'Honolulu', 'San Juan']));
    expect(names).not.toEqual(expect.arrayContaining(['Mexico City']));
    expect(names).not.toContain('Boston');
    expect(scoped('Boston', 'international').map(result => result.city.name)).not.toContain('San Juan');
  });
  it('uses the selected home country rather than always treating the US as domestic', () => {
    expect(scoped('Toronto', 'domestic').map(result => result.city.name).sort()).toEqual(['Banff', 'Vancouver']);
    expect(scoped('Tokyo', 'domestic').map(result => result.city.name)).toEqual(['Kyoto']);
    expect(scoped('Tokyo', 'international').map(result => result.city.name)).toContain('San Diego');
  });
  it('returns no picks when the dataset has no domestic destinations beyond home', () => {
    for (const home of ['London', 'Frankfurt', 'Singapore', 'Dubai']) expect(scoped(home, 'domestic')).toEqual([]);
  });
  it('partitions all destinations without omissions or overlaps for every home city', () => {
    for (const home of ORIGINS) {
      expect(home.country.length).toBeGreaterThan(0);
      const all = rankCities(scoreCities(trip, home));
      const domestic = all.filter(result => matchesDestinationScope(result.city.country, home.country, 'domestic'));
      const international = all.filter(result => matchesDestinationScope(result.city.country, home.country, 'international'));
      expect(domestic.length + international.length).toBe(all.length);
      expect(domestic.some(result => international.includes(result))).toBe(false);
    }
  });
});
