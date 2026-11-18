import { expect, it } from 'vitest';
import { ORIGINS } from './data/origins';
import { rankCities, scoreCities } from './scoring';
import { rankSeasonalAreas, seasonalScore, seasonalTitle } from './seasonal';

const trip = { start: '2026-12-20', end: '2027-01-03' };
const scores = scoreCities(trip, ORIGINS.find(o => o.name === 'Boston')!).map(seasonalScore);

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
