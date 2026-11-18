import { DAY, parseDate } from './scoring';
import beachBases from "./data/beach-bases.json";
import type { DaylightHours, Place, Trip } from './types';

export const FORECAST_DAYS = 7;
export const FORECAST_SOURCE = 'https://open-meteo.com/en/docs';
export interface ForecastDay { daylight?: DaylightHours; high: number; low: number; precipitation: number; apparentHigh?: number }
export type DailyForecast = ReadonlyMap<number, ForecastDay>;
export type Forecasts = ReadonlyMap<string, DailyForecast>;

export function needsForecast(trip: Trip, now: Date): boolean {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const start = parseDate(trip.start), end = parseDate(trip.end);
  // Destination-local dates can be a day ahead of or behind the browser.
  return start !== null && end !== null && start <= end
    && start <= today + FORECAST_DAYS * DAY && end >= today - DAY;
}

// Use complete local days only. A missing hour must never count as dry.
function daylightByDate(payload: object): Map<string, DaylightHours> {
  const result = new Map<string, DaylightHours>();
  if (!('hourly' in payload) || !payload.hourly) return result;
  const { time, precipitation, is_day } = payload.hourly as Record<string, unknown>;
  if (!Array.isArray(time) || !Array.isArray(precipitation) || !Array.isArray(is_day)) return result;
  const days = new Map<string, Map<number, number>>();
  time.forEach((stamp, i) => {
    if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(stamp)) return;
    const hour = Number(stamp.slice(11, 13)), mm = precipitation[i], light = is_day[i];
    if (hour > 23 || !Number.isFinite(mm) || mm < 0 || (light !== 0 && light !== 1)) return;
    const date = stamp.slice(0, 10), hours = days.get(date) ?? new Map<number, number>();
    hours.set(hour, light ? Number(mm < 0.1) : -1);
    days.set(date, hours);
  });
  for (const [date, hours] of days) {
    const daylight = [...hours.values()].filter(value => value >= 0);
    if (hours.size === 24 && daylight.length) result.set(date, { dry: daylight.filter(Boolean).length, light: daylight.length });
  }
  return result;
}

function readDaily(payload: unknown): DailyForecast {
  const forecast = new Map<number, ForecastDay>();
  if (!payload || typeof payload !== 'object' || !('daily' in payload)) return forecast;
  const daily = payload.daily as Record<string, unknown> | null;
  const dates = daily?.time, highs = daily?.temperature_2m_max, lows = daily?.temperature_2m_min, rain = daily?.precipitation_sum;
  const apparentHighs = Array.isArray(daily?.apparent_temperature_max) ? daily.apparent_temperature_max : [];
  if (!Array.isArray(dates) || !Array.isArray(highs) || !Array.isArray(lows) || !Array.isArray(rain)) return forecast;
  const hours = daylightByDate(payload);
  dates.slice(0, FORECAST_DAYS).forEach((date, index) => {
    const day = typeof date === 'string' ? parseDate(date) : null;
    const high = highs[index], low = lows[index], precipitation = rain[index];
    if (day !== null && Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(precipitation)
      && low <= high && precipitation >= 0) {
      const apparentHigh = apparentHighs[index];
      forecast.set(day, { ...(hours.has(date) ? { daylight: hours.get(date) } : {}), high, low, precipitation, ...(Number.isFinite(apparentHigh) ? { apparentHigh } : {}) });
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
    if (batch.some(p => beachBases.includes(p.name))) params.set('hourly', 'precipitation,is_day');
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
