import { expect, it } from 'vitest';
import { ORIGINS } from './data/origins';
import { DAY, DEFAULT_WEIGHTS, rankCities, sampleDays, scoreCities, scoreCity, tripEvents } from './scoring';
import { monthlySeasonalScores, rankSeasonalAreas, seasonalScore, seasonalTitle } from './seasonal';

const trip = { start: '2026-12-20', end: '2027-01-03' };
const scores = scoreCities(trip, ORIGINS.find(o => o.name === 'Boston')!).map(seasonalScore);

it('scores January through December with the same trip duration and scoring model', () => {
  const city = scores.find(result => result.city.name === 'Paris')!.city;
  const home = ORIGINS.find(origin => origin.name === 'Boston')!;
  const dates = { start: '2027-10-31', end: '2027-11-14' };
  const monthly = monthlySeasonalScores(city, home, dates, true);
  expect(monthly.map(point => point?.dates.start.slice(0, 7))).toEqual(
    Array.from({ length: 12 }, (_, month) => `2027-${String(month + 1).padStart(2, '0')}`),
  );
  expect(monthly.map(point => (Date.parse(point!.dates.end) - Date.parse(point!.dates.start)) / DAY)).toEqual(Array(12).fill(14));
  expect(monthly[1]?.dates).toEqual({ start: '2027-02-28', end: '2027-03-14' });
  expect(monthly[9]?.dates).toEqual(dates);
  expect(monthly[11]?.dates).toEqual({ start: '2027-12-31', end: '2028-01-14' });
  const direct = seasonalScore(scoreCity(city, home, sampleDays(dates), DEFAULT_WEIGHTS, tripEvents(dates), undefined, true));
  expect(monthly[9]?.score).toBeCloseTo(direct.score);
  expect(monthly[1]?.score).not.toBeCloseTo(monthly[7]!.score);
});

it('ranks each area once using its best remaining eligible base', () => {
  const bases = scores.filter(r => r.city.region === 'Galápagos');
  const [first, second] = rankCities(bases);
  expect(rankSeasonalAreas(bases).map(r => r.city.name)).toEqual([first.city.name]);
  expect(rankSeasonalAreas(bases.filter(r => r.city.name !== first.city.name))[0].city.name).toBe(second.city.name);
  const areas = rankSeasonalAreas(scores).map(seasonalTitle);
  expect(areas).toContain('Palawan');
  expect(areas).toContain('Boracay');
  expect(new Set(areas).size).toBe(areas.length);
});

it('uses a single bounded score whose contributions add up', () => {
  for (const r of scores) {
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(Object.values(r.seasonal!.points).reduce((a,b) => a+b)).toBeCloseTo(r.score);
  }
});

it('uses the forecast on covered usable days and gates timing on absolute suitability', () => {
  const r = scores.find(r => seasonalTitle(r) === 'Palawan')!;
  const forecast = (rain: number, usableDays: number) => ({ ...r.weatherPeriods[0], usableDays, high: 29, rain: { source: 'forecast' as const, millimeters: rain } });
  const wet = seasonalScore({ ...r, weatherPeriods: [forecast(4, 1), forecast(0, 0)] });
  const dry = seasonalScore({ ...r, weatherPeriods: [forecast(0, 1), forecast(4, 0)] });
  expect(wet.seasonal!.points.experience).toBe(0);
  expect(wet.seasonal!.points.timing).toBe(0);
  expect(dry.seasonal!.points.experience).toBe(45);
});

it('gives partial credit for a brief daytime shower on a wet beach forecast day', () => {
  const beach = scores.find(r => r.city.name === 'Phuket')!;
  const period = { ...beach.weatherPeriods[0], high: 29, usableDays: 1,
    rain: { source: 'forecast' as const, millimeters: 7 }, daylight: { dry: 11, light: 12 } };
  const result = seasonalScore({ ...beach, weatherPeriods: [period] });
  expect(result.seasonal!.points.experience).toBeCloseTo(45 * 11 / 12);
  expect(result.seasonal!.dryDaylightHours).toBe(11);
  const urban = scores.find(r => r.city.name === 'London')!;
  expect(seasonalScore({ ...urban, weatherPeriods: [period] }).seasonal!.points.experience).toBe(0);
});
