import { DAY, parseDate } from './scoring';
import type { Place, Trip } from './types';

export const FORECAST_DAYS = 7;
export const FORECAST_SOURCE = 'https://open-meteo.com/en/docs';
export interface ForecastDay { high: number; low: number; precipitation: number; apparentHigh?: number }
export type DailyForecast = ReadonlyMap<number, ForecastDay>;
export type Forecasts = ReadonlyMap<string, DailyForecast>;

export function needsForecast(trip: Trip, now: Date): boolean {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const start = parseDate(trip.start), end = parseDate(trip.end);
  // Destination-local dates can be a day ahead of or behind the browser.
  return start !== null && end !== null && start <= end
    && start <= today + FORECAST_DAYS * DAY && end >= today - DAY;
}

function readDaily(payload: unknown): DailyForecast {
  const forecast = new Map<number, ForecastDay>();
  if (!payload || typeof payload !== 'object' || !('daily' in payload)) return forecast;
  const daily = payload.daily as Record<string, unknown> | null;
  const dates = daily?.time, highs = daily?.temperature_2m_max, lows = daily?.temperature_2m_min, rain = daily?.precipitation_sum;
  const apparentHighs = Array.isArray(daily?.apparent_temperature_max) ? daily.apparent_temperature_max : [];
  if (!Array.isArray(dates) || !Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(rain)) return forecast;
  dates.slice(0, FORECAST_DAYS).forEach((date, index) => {
    const day = typeof date === 'string' ? parseDate(date) : null;
    const high = highs[index], low = lows[index], precipitation = rain[index];
    if (day !== null && Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(precipitation)
      && low <= high && precipitation >= 0) {
      const apparentHigh = apparentHighs[index];
      forecast.set(day, { high, low, precipitation, ...(Number.isFinite(apparentHigh) ? { apparentHigh } : {}) });
    }
  });
  return forecast;
}

export async function loadForecast(places: readonly Place[], request: typeof fetch = fetch): Promise<Forecasts> {
  const placesByName = [...new Map(places.map(place => [place.name, place])).values()];
  const forecasts = new Map<string, DailyForecast>();
  // Keep URLs short and allow a failed batch to fall back independently.
  const batchSize = 25;
  const batches = Array.from({ length: Math.ceil(placesByName.length / batchSize) }, (_, i) =>
    placesByName.slice(i * batchSize, (i + 1) * batchSize));
  const results = await Promise.allSettled(batches.map(async batch => {
    const params = new URLSearchParams({
      latitude: batch.map(place => place.lat).join(','),
      longitude: batch.map(place => place.lon).join(','),
      daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum',
      timezone: batch.map(() => 'auto').join(','),
      forecast_days: String(FORECAST_DAYS),
    });
    const response = await request(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Forecast request failed');
    const payload: unknown = await response.json();
    const locations = Array.isArray(payload) ? payload : [payload];
    if (locations.length !== batch.length) throw new Error('Forecast locations did not match request');
    return batch.map((place, index) => [place.name, readDaily(locations[index])] as const);
  }));
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const [name, daily] of result.value) if (daily.size) forecasts.set(name, daily);
  }
  return forecasts;
}
