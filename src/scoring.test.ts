import { describe, expect, it } from 'vitest';
import { CITIES } from './data/cities';
import { ORIGINS } from './data/origins';
import { TZ } from './data/timezones';
import { DAY, DEFAULT_WEIGHTS, DEFAULT_TEMPERATURE, WEIGHT_KEYS, defaultTrip, easter, interp, matchesDestinationScope, normalizeWeights, rankCities, sampleDays, scoreCities, setWeight, thanksgiving, travel, tripEvents, validateTemperature, validateTrip } from './scoring';
import { band, displayedContributions, climateProvenance, scoreBreakdown } from './format';
import { climateFor, climateLabel, climateSourceKind, CLIMATE_SOURCE, temperatureFrequency, wetDayFrequency, gridElevationMismatch } from './climate';
import { auditDestinations, auditRows, sourceCounts } from './audit';
import type { ClimateMonth, Weights } from './types';

const boston = ORIGINS.find(city => city.name === 'Boston')!;
const london = ORIGINS.find(city => city.name === 'London')!;
const destination = (name: string) => CITIES.find(city => city.name === name)!;
const results = (start: string, end: string, home = boston) => scoreCities({ start, end }, home, DEFAULT_WEIGHTS);

describe('reference data', () => {
  it('contains all 71 destinations, 24 origins, and timezone offsets', () => {
    expect(CITIES).toHaveLength(71);
    expect(ORIGINS).toHaveLength(24);
    expect(CITIES.every(city => Number.isFinite(TZ[city.name]))).toBe(true);
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
  it('flags July monsoon rain in Goa and September hurricanes in Miami', () => {
    expect(results('2027-07-10', '2027-07-20').find(result => result.city.name === 'Goa')!.dealbreakers).toContain('Frequent precipitation');
    expect(results('2027-09-12', '2027-09-18').find(result => result.city.name === 'Miami')!.risks).toContain('Hurricane season');
  });
  it('excludes home from ranking and keeps scores and usable days bounded', () => {
    const scores = results('2027-01-01', '2027-12-31');
    expect(rankCities(scores).some(result => result.city.name === 'Boston')).toBe(false);
    expect(scores.every(result => result.score >= 0 && result.score <= 100 && result.travel.usable >= 0)).toBe(true);
  });
});

describe('sourced climate baseline', () => {
  it('covers every destination and home city with auditable sources in the same baseline', () => {
    expect(CLIMATE_SOURCE.start).toBe('1991-01-01');
    expect(CLIMATE_SOURCE.end).toBe('2020-12-31');
    const expected = [930, 848, 930, 900, 930, 900, 930, 930, 900, 930, 900, 930];
    for (const place of [...CITIES, ...ORIGINS]) {
      const climate = climateFor(place.name);
      for (const variable of ['temperature', 'precipitation'] as const) {
        const source = climate.sources[variable];
        expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(source.coverage).toHaveLength(12);
        source.coverage.forEach((coverage, month) => {
          expect(coverage.expectedDays).toBe(expected[month]);
          expect(coverage.days).toBe(climate.months[month][variable === 'temperature' ? 'temperatureDays' : 'precipitationDays']);
          expect(coverage.days).toBeGreaterThanOrEqual(expected[month] * .8);
          expect(coverage.days).toBeLessThanOrEqual(expected[month]);
          expect(coverage.years).toBeGreaterThanOrEqual(20);
          expect(Math.min(...coverage.decadeYears)).toBeGreaterThanOrEqual(5);
        });
        if (source.kind === 'station') {
          expect(source.distanceKm).toBeLessThanOrEqual(15);
          expect(Math.abs(source.elevationDifferenceM)).toBeLessThanOrEqual(150);
          expect(source.stationId.length).toBeGreaterThan(0);
          expect(new URL(source.sourceUrl).hostname).toMatch(/^(www\.ncei\.noaa\.gov|data\.geo\.admin\.ch|meteofrance\.s3\.sbg\.io\.cloud\.ovh\.net|data\.weather\.gov\.hk|api\.weather\.gc\.ca|www\.weather\.gov\.sg)$/);
        } else {
          expect(source.reason.length).toBeGreaterThan(20);
          expect(source.coverage.map(c => c.days)).toEqual(expected);
        }
      }
      expect(climate.sha256).toMatch(/^[a-f0-9]{64}$/);
      const url = new URL(climate.sourceUrl);
      expect(url.hostname).toBe('power.larc.nasa.gov');
      expect(url.searchParams.get('start')).toBe('19910101');
      expect(url.searchParams.get('end')).toBe('20201231');
      expect(Number(url.searchParams.get('latitude'))).toBe(climate.lat);
      expect(Number(url.searchParams.get('longitude'))).toBe(climate.lon);
    }
  });
  it('has complete temperature distributions and valid wet-day counts', () => {
    for (const climate of Object.values(CLIMATE_SOURCE.locations)) for (const month of climate.months) {
      expect(month.highHistogram.reduce((a, b) => a + b, 0)).toBe(month.temperatureDays);
      expect(month.highHistogram.every(n => Number.isInteger(n) && n >= 0)).toBe(true);
      expect(month.wetDays).toBeGreaterThanOrEqual(0);
      expect(month.wetDays).toBeLessThanOrEqual(month.precipitationDays);
      expect(month.monthlyPrecip).toBeGreaterThanOrEqual(0);
      expect(month.meanHigh).toBeGreaterThanOrEqual(month.meanLow);
      expect(month.highP90).toBeGreaterThanOrEqual(month.highP10);
    }
  });
  it('clearly identifies station, mixed and grid data without changing match colors', () => {
    const station = climateFor('San Diego'), grid = climateFor('Kathmandu'), mixed = climateFor('Reykjavik');
    expect(climateSourceKind(station)).toBe('station');
    expect(climateLabel(grid)).toBe('Regional grid estimate');
    expect(climateLabel(mixed)).toBe('Station temp · grid precipitation');
    expect(climateProvenance(station)).toContain('SAN DIEGO INTL AP');
    expect(climateProvenance(grid)).toContain('Why a grid estimate?');
    expect(climateProvenance(mixed)).toContain('Regional grid estimate');
    const result = results('2027-07-01', '2027-07-15').find(r => r.city.name === 'Reykjavik')!;
    expect(scoreBreakdown(result, 'C')).toContain('Nearby station observations');
    expect(scoreBreakdown(result, 'C')).toContain('Regional grid estimate');
  });
  it('uses a local valley station for Interlaken and flags unqualified mountain data', () => {
    const local = climateFor('Interlaken');
    expect(climateSourceKind(local)).toBe('station');
    const source = local.sources.temperature;
    expect(source.kind).toBe('station');
    if (source.kind === 'station') {
      expect(source.stationId).toBe('INT');
      expect(source.distanceKm).toBeLessThan(3);
      expect(Math.abs(source.elevationDifferenceM)).toBeLessThan(5);
    }
    expect(climateSourceKind(climateFor('Banff'))).toBe('mixed');
    expect(climateProvenance(climateFor('Banff'))).toContain('coverage requirements');
  });
  it('uses precipitation coverage rather than temperature coverage for wet-day frequency', () => {
    const month = { ...climateFor('San Diego').months[0], temperatureDays: 100, precipitationDays: 80, wetDays: 40 };
    expect(wetDayFrequency(month)).toBe(.5);
  });
  it('preserves agency lineage, all source inputs and honest mixed labels', () => {
    const banff = climateFor('Banff');
    expect(banff.sources.temperature.kind).toBe('station');
    if (banff.sources.temperature.kind === 'station') {
      expect(banff.sources.temperature.stationMembers?.map(m => m.stationId)).toEqual(['3050520', '3050519']);
      expect(banff.sources.temperature.rawInputs).toHaveLength(3);
      expect(banff.sources.temperature.hashScope).toBe('input manifest');
    }
    expect(banff.sources.precipitation.kind).toBe('grid');
    const html = climateProvenance(banff);
    expect(html).toContain('1995-04-01');
    expect(html).toContain('3050519');
    expect(html).toContain('Agency station history');
    expect(climateFor('Hong Kong').sources.temperature.rawInputs).toHaveLength(2);
    expect(climateFor('Singapore').sources.temperature.rawInputs).toHaveLength(360);
  });
  it('corrects Tenerife to its named coast and flags unresolved mountain grid elevation', () => {
    const tenerife = climateFor('Tenerife');
    expect(tenerife.referenceLabel).toBe('El Médano · south coast');
    expect(tenerife.lat).toBe(destination('Tenerife').lat);
    expect(tenerife.lon).toBe(destination('Tenerife').lon);
    expect(tenerife.elevation).toBeLessThan(100);
    expect(climateSourceKind(tenerife)).toBe('station');
    expect(gridElevationMismatch(tenerife)).toBeNull();
    expect(Math.abs(gridElevationMismatch(climateFor('Queenstown'))!)).toBeGreaterThan(600);
    expect(climateProvenance(climateFor('Queenstown'))).toContain('Grid terrain mismatch');
  });
  it('makes all destinations searchable independently of rankings and source type', () => {
    expect(auditDestinations('', 'all')).toHaveLength(71);
    expect(Object.values(sourceCounts).reduce((a, b) => a + b, 0)).toBe(71);
    expect(sourceCounts).toEqual({station:22,mixed:4,grid:45});
    expect(auditDestinations('Queenstown', 'grid').map(c => c.name)).toEqual(['Queenstown']);
    expect(auditDestinations('El Médano', 'station').map(c => c.name)).toEqual(['Tenerife']);
    expect(auditDestinations('Banff', 'mixed').map(c => c.name)).toEqual(['Banff']);
    expect(auditRows('Queenstown', 'all')).toContain('data-audit-city="Queenstown"');
    expect(auditRows('missing place', 'all')).toContain('No destinations match');
  });
  it('retains different local climates inside the same country', () => {
    expect(climateFor('Miami').months[0].meanHigh - climateFor('New York').months[0].meanHigh).toBeGreaterThan(10);
    expect(climateFor('San Diego').months[6].wetDays / 930).toBeLessThan(climateFor('San Diego').months[0].wetDays / 930);
  });
  it('does not substitute unsourced values for an unknown place', () => {
    expect(() => climateFor('Unknown destination')).toThrow('No sourced climate baseline');
  });
  it('counts inclusive temperature bounds against the full historical distribution', () => {
    const histogram = Array(201).fill(0); histogram[0] = 25; histogram[100] = 50; histogram[200] = 25;
    const month: ClimateMonth = { temperatureDays: 100, precipitationDays: 100, meanHigh: 20, meanLow: 10, highP10: 10, highP90: 30, monthlyPrecip: 20, wetDays: 20, histogramStart: 100, highHistogram: histogram };
    expect(temperatureFrequency(month, { min: 15, max: 25 })).toBe(0.5);
    expect(temperatureFrequency(month, { min: 10, max: 20 })).toBe(0.75);
    expect(temperatureFrequency(month, { min: 10, max: 30 })).toBe(1);
    expect(temperatureFrequency(month, { min: 31, max: 35 })).toBe(0);
    expect(temperatureFrequency(month, { min: 20 + 1e-12, max: 30 })).toBe(0.75);
  });
});

describe('percentage priorities', () => {
  it('keeps each requested slider value and exactly 100% at every setting', () => {
    for (const key of WEIGHT_KEYS) for (let value = 0; value <= 100; value++) {
      const weights = setWeight({ ...DEFAULT_WEIGHTS }, key, value);
      expect(weights[key]).toBe(value);
      expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBe(100);
      expect(Object.values(weights).every(n => Number.isInteger(n) && n >= 0 && n <= 100)).toBe(true);
    }
  });
  it('preserves proportions of the other factors within a percentage point', () => {
    const weights = setWeight({ ...DEFAULT_WEIGHTS }, 'weather', 37);
    expect(weights).toEqual({ weather: 37, dry: 26, crowds: 11, travel: 26 });
  });
  it('recovers from 100% on one factor without all-zero or NaN weights', () => {
    const single: Weights = { weather: 100, dry: 0, crowds: 0, travel: 0 };
    expect(setWeight(single, 'weather', 0)).toEqual({ weather: 0, dry: 34, crowds: 33, travel: 33 });
    let weights = { ...DEFAULT_WEIGHTS };
    for (let i = 0; i < 400; i++) weights = setWeight(weights, WEIGHT_KEYS[i % 4], (i * 23) % 101);
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('normalizes arbitrary positive ratios and handles invalid input explicitly', () => {
    expect(normalizeWeights({ weather: 4, dry: 3, crowds: 2, travel: 1 })).toEqual({ weather: 40, dry: 30, crowds: 20, travel: 10 });
    expect(normalizeWeights({ weather: 0, dry: 0, crowds: 0, travel: 0 })).toEqual(DEFAULT_WEIGHTS);
    expect(() => normalizeWeights({ ...DEFAULT_WEIGHTS, dry: NaN })).toThrow();
    expect(() => setWeight({ ...DEFAULT_WEIGHTS }, 'dry', NaN)).toThrow();
  });
});

describe('personalized additive score', () => {
  const trip = { start: '2027-01-01', end: '2027-01-14' };
  it('sums the four contributions exactly with no extra penalties or bonuses', () => {
    for (const result of results('2027-09-12', '2027-09-18')) {
      const b = result.breakdown;
      expect(Object.values(b.contributions).reduce((a, b) => a + b, 0)).toBeCloseTo(result.score, 10);
      expect(Object.values(b.weights).reduce((a, b) => a + b, 0)).toBe(100);
      expect(Object.values(b.fits).every(fit => fit >= 0 && fit <= 1)).toBe(true);
      expect(Object.values(displayedContributions(result)).reduce((a, b) => a + b, 0)).toBeCloseTo(Number(result.score.toFixed(1)), 10);
    }
  });
  it('gives a zero-weight factor zero contribution', () => {
    const weights: Weights = { weather: 50, dry: 50, crowds: 0, travel: 0 };
    for (const r of scoreCities(trip, boston, weights)) {
      expect(r.breakdown.contributions.crowds).toBe(0);
      expect(r.breakdown.contributions.travel).toBe(0);
    }
  });
  it('uses dry-day frequency alone when that is the only priority, even in storm season', () => {
    const r = scoreCities({ start: '2027-09-12', end: '2027-09-18' }, boston, { weather: 0, dry: 100, crowds: 0, travel: 0 }).find(r => r.city.name === 'Miami')!;
    expect(r.risks).toContain('Hurricane season');
    expect(r.score).toBeCloseTo(100 * (1 - r.wetFrequency), 10);
  });
  it('changes the preferred city when the user changes from cool to warm temperatures', () => {
    const weights: Weights = { weather: 100, dry: 0, crowds: 0, travel: 0 };
    const cool = scoreCities(trip, boston, weights, { min: 0, max: 15 });
    const warm = scoreCities(trip, boston, weights, { min: 22, max: 32 });
    const score = (rows: typeof cool, name: string) => rows.find(r => r.city.name === name)!.score;
    expect(score(cool, 'London')).toBeGreaterThan(score(cool, 'Miami'));
    expect(score(warm, 'Miami')).toBeGreaterThan(score(warm, 'London'));
  });
  it('never lowers temperature fit when the preferred range expands', () => {
    const weights: Weights = { weather: 100, dry: 0, crowds: 0, travel: 0 };
    const narrow = scoreCities(trip, boston, weights, { min: 20, max: 25 });
    const wide = scoreCities(trip, boston, weights, { min: 15, max: 30 });
    narrow.forEach((r, i) => expect(wide[i].score).toBeGreaterThanOrEqual(r.score));
  });
  it('keeps climate fit independent of home city and snapshots preferences', () => {
    const weights: Weights = { weather: 100, dry: 0, crowds: 0, travel: 0 }, range = { ...DEFAULT_TEMPERATURE };
    const first = scoreCities(trip, boston, weights, range), second = scoreCities(trip, london, weights, range);
    first.forEach((r, i) => expect(r.score).toBe(second[i].score));
    weights.weather = 0; range.min = 10;
    expect(first[0].breakdown.weights.weather).toBe(100);
    expect(first[0].breakdown.temperatureRange.min).toBe(20);
  });
  it('validates empty, inverted and out-of-bounds preferred ranges', () => {
    for (const range of [{ min: NaN, max: 30 }, { min: 30, max: 20 }, { min: 20, max: 20 }, { min: -41, max: 10 }, { min: 20, max: 51 }]) expect(validateTemperature(range)).not.toBeNull();
    expect(validateTemperature({ min: -10, max: 5 })).toBeNull();
    expect(() => scoreCities(trip, boston, DEFAULT_WEIGHTS, { min: 30, max: 20 })).toThrow();
  });
  it('keeps colors consistent with printed threshold ranges', () => {
    for (const threshold of [48, 62, 75]) {
      expect(band(threshold - 0.49)).toBe(band(threshold));
      expect(band(threshold - 0.51)).not.toBe(band(threshold));
    }
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
