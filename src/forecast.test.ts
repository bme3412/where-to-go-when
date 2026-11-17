import { describe, expect, it, vi } from 'vitest';
import { CITIES } from './data/cities';
import { ORIGINS } from './data/origins';
import { loadForecast, needsForecast } from './forecast';
import { scoreBreakdown, weatherDetails, weatherSourceSummary } from './format';
import { parseDate, rankCities, sampleDays, scoreCities } from './scoring';

const boston = ORIGINS.find(origin => origin.name === 'Boston')!;
const miami = CITIES.find(city => city.name === 'Miami')!;
const trip = { start: '2026-11-21', end: '2026-11-26' };
const dates = ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'];

describe('near-term weather', () => {
  it('uses Boston-to-Miami forecast days through Nov 23 and historical days after that', async () => {
    const request = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => Response.json([
      { daily: { time: dates, temperature_2m_max: [10, 9, 8, 9], temperature_2m_min: [5, 4, 3, 4], precipitation_sum: [0, 0, 2, 0] } },
      { daily: { time: dates, temperature_2m_max: [25, 25, 35, 25], temperature_2m_min: [19, 23, 25, 19], precipitation_sum: [0, 0, 1, 2] } },
    ]));
    expect(needsForecast(trip, new Date(2026, 10, 17))).toBe(true);
    const snapshot = await loadForecast([boston, miami], request);
    const params = new URL(String(request.mock.calls[0][0])).searchParams;
    expect(params.get('forecast_days')).toBe('7');
    expect(params.get('timezone')).toBe('auto,auto');
    expect(snapshot.get('Miami')?.get(parseDate('2026-11-23')!)).toEqual({ high: 25, low: 19, precipitation: 2 });

    const rank = (forecasts?: typeof snapshot) => rankCities(scoreCities(trip, boston, undefined, undefined, false, forecasts));
    const forecastRank = rank(snapshot).find(result => result.city.name === 'Miami')!;
    const historicalRank = rank().find(result => result.city.name === 'Miami')!;
    expect(forecastRank.rank).toBeGreaterThan(historicalRank.rank);
    expect(forecastRank.comfortableDryDays).toBeLessThan(historicalRank.comfortableDryDays);
    expect(forecastRank.comfortableDryDays).toBeGreaterThan(0);
    expect(forecastRank.weatherDates.forecast).toEqual(dates.slice(1));
    const coverage = weatherSourceSummary(forecastRank);
    expect(coverage).toMatch(/Forecast Nov 21.*23 · Historical climate Nov 24.*26/);
    const periods = forecastRank.weatherPeriods;
    expect(periods).toHaveLength(6);
    expect(periods.map(period => period.rain.source)).toEqual([
      'forecast', 'forecast', 'forecast', 'historical', 'historical', 'historical',
    ]);
    expect(periods[0]).toMatchObject({ high: 25, rain: { source: 'forecast', millimeters: 0 } });
    expect(periods[0].comfortableDryDays).toBeGreaterThan(0);
    expect(periods[0].comfortableDryDays).toBeLessThan(1);
    expect(periods.slice(1, 3).map(period => period.comfortableDryDays)).toEqual([0, 0]);
    expect(periods.reduce((sum, period) => sum + period.comfortableDryDays, 0)).toBeCloseTo(forecastRank.comfortableDryDays, 12);
    const details = weatherDetails(forecastRank, 'F');
    expect(details).toContain('Weather data by Open-Meteo');
    expect(details).toContain('<caption>Day-by-day weather</caption>');
    expect(details).toMatch(/Nov 21<.th><td>77°F<.td>\s*<td>0 mm<.td>\s*<td>Forecast/);
    expect(details).toMatch(/Nov 24<.th><td>\d+°F<.td>\s*<td>\d+% wet-day chance<.td>\s*<td>Historical climate/);
    expect(details).toContain(`Total after travel</th><td>${forecastRank.comfortableDryDays.toFixed(2)}`);
    expect(weatherSourceSummary(historicalRank)).toBe('Historical climate for all selected dates');
    expect(forecastRank.weatherFlags).toEqual(historicalRank.weatherFlags);
  });

  it('uses climate for a missing forecast day and splits long-trip samples at forecast dates', async () => {
    const snapshot = await loadForecast([miami], async () => Response.json({
      daily: { time: dates, temperature_2m_max: [25, 25, null, 25], temperature_2m_min: [19, 19, 19, 19], precipitation_sum: [0, 0, 0, 0] },
    }));
    expect(snapshot.get('Miami')?.size).toBe(3);
    const longTrip = { start: trip.start, end: '2027-05-30' };
    const result = scoreCities(longTrip, boston, undefined, undefined, false, snapshot).find(pick => pick.city.name === 'Miami')!;
    expect(result.weatherDates.forecast).toEqual(['2026-11-21', '2026-11-23']);
    expect(weatherSourceSummary(result)).toContain('Forecast Nov 21 · Historical climate Nov 22 · Forecast Nov 23');
    expect(result.comfortableDryDays).toBeLessThanOrEqual(result.travel.usable);
    expect(sampleDays(longTrip).step).toBeGreaterThan(1);
    expect(result.weatherPeriods.filter(period => period.rain.source === 'forecast').every(period => period.days === 1)).toBe(true);
    expect(weatherDetails(result, 'C')).toContain('Their contribution covers the full range shown.');
  });

  it('uses feels-like highs where supplied and scores warm nights separately', async () => {
    const comfortDates = dates.slice(1);
    const comfortTrip = { start: comfortDates[0], end: comfortDates[2] };
    const score = async (apparentHigh: number | null, low: number) => {
      const snapshot = await loadForecast([miami], async () => Response.json({
        daily: { time: comfortDates, temperature_2m_max: [28, 28, 28], temperature_2m_min: [low, low, low],
          precipitation_sum: [0, 0, 0], apparent_temperature_max: [apparentHigh, apparentHigh, apparentHigh] },
      }));
      return scoreCities(comfortTrip, boston, undefined, undefined, false, snapshot).find(result => result.city.name === 'Miami')!;
    };
    const fallback = await score(null, 20);
    const warmNight = await score(null, 26);
    const humid = await score(34, 20);
    expect(fallback.temperatureComfort).toEqual({ daytimeFit: 1, apparentDays: 0 });
    expect(warmNight.breakdown.fits.weather).toBeCloseTo(0.8);
    expect(fallback.comfortableDryDays).toBeGreaterThan(1);
    expect(warmNight.comfortableDryDays).toBe(fallback.comfortableDryDays);
    expect(scoreBreakdown(warmNight, 'F')).toContain('Warm nights reduce the match score by 6.4 points.');
    expect(humid.breakdown.fits.weather).toBe(0);
    expect(humid.comfortableDryDays).toBe(0);
    expect(weatherDetails(humid, 'F')).toContain('Feels like 93°F');
  });

  it('keeps distant trips historical and handles a failed forecast request', async () => {
    const now = new Date(2026, 10, 17);
    expect(needsForecast({ start: '2026-12-18', end: '2026-12-20' }, now)).toBe(false);
    const result = await loadForecast([boston], async () => new Response(null, { status: 503 }));
    expect(result.size).toBe(0);
  });
});
