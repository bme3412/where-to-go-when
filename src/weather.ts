import { wetDayFrequency } from './climate';
import { RISKS } from './data/risks';
import { WEATHER_SEASONS } from './data/weather-seasons';
import type { WeatherSeason } from './data/weather-seasons';
import type { City, CityClimate, SampledTrip, WeatherFlag, WeatherLayer } from './types';

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEATHER_SYMBOLS = {
  wet: 'M0,-6C-1,-4 -4,0 -4,2A4,4 0 0,0 4,2C4,0 1,-4 0,-6Z',
  heat: 'M-2,1V-4A2,2 0 0,1 2,-4V1A3.5,3.5 0 1,1 -2,1M0,-3V4',
  cold: 'M0,-6V6M-5,-3L5,3M-5,3L5,-3M-2,-5L0,-3L2,-5M-2,5L0,3L2,5',
  storm: 'M0,-6L6,5H-6ZM0,-2V1M0,3V3.2',
} as const;
export const weatherFlagLabel = (flag: WeatherFlag): string => `${flag.label}${flag.basis === 'estimate' ? ' (estimate)' : ''}`;
const applies = (cities: ReadonlySet<string>, city: City) => cities.has(city.name) || Boolean(city.region && cities.has(city.region));

/** Inclusive overlap, including seasons crossing New Year and a trip's unsampled final day. */
export function seasonOverlaps(season: Pick<WeatherSeason, 'from' | 'to'>, start: number, end: number): boolean {
  const wraps = season.to[0] * 100 + season.to[1] < season.from[0] * 100 + season.from[1];
  for (let year = new Date(start).getUTCFullYear() - 1; year <= new Date(end).getUTCFullYear(); year++) {
    const from = Date.UTC(year, season.from[0] - 1, season.from[1]);
    const to = Date.UTC(year + Number(wraps), season.to[0] - 1, season.to[1]);
    if (from <= end && to >= start) return true;
  }
  return false;
}

export function primaryWeatherFlag(flags: readonly WeatherFlag[], layer: WeatherLayer): WeatherFlag | undefined {
  if (layer === 'off') return undefined;
  return layer === 'all' || layer === 'temperature' ? flags[0] : flags.find(flag => flag.kind === layer);
}

export function weatherFlagsFor(city: City, climate: CityClimate, samples: SampledTrip,
  observations: { highs: readonly number[]; lows: readonly number[]; wet: readonly number[] }): WeatherFlag[] {
  const start = samples.days[0].timestamp, end = start + (samples.tripDays - 1) * DAY;
  const flags: WeatherFlag[] = [];
  const calendars = WEATHER_SEASONS.filter(season => applies(season.cities, city));
  for (const season of calendars) {
    if (seasonOverlaps(season, start, end)) flags.push({ kind: season.kind, label: season.label, detail: season.detail,
      basis: 'calendar', sourceLabel: season.sourceLabel, sourceUrl: season.sourceUrl });
  }
  // Preserve existing regional coverage where no sourced replacement is available,
  // but make its estimated status explicit instead of presenting it as an official calendar.
  for (const [cities, peak, width, strength, label] of RISKS) {
    if (!applies(cities, city) || calendars.some(season => season.label === label)) continue;
    const active = samples.days.some(({ month }) => {
      const distance = Math.abs(month - peak);
      return strength * Math.exp(-((Math.min(distance, 12 - distance) / width) ** 2)) > 0.04;
    });
    if (active) flags.push({ kind: label.includes('Monsoon') ? 'wet' : 'storm', label, basis: 'estimate',
      detail: 'A regional seasonal estimate, not a verified local season calendar or current warning.', sourceLabel: 'App regional estimate' });
  }

  const monthlyRain = climate.months.map(month => month.monthlyPrecip);
  const annualMean = monthlyRain.reduce((sum, value) => sum + value, 0) / 12;
  const driest = Math.min(...monthlyRain), wettest = Math.max(...monthlyRain);
  const selectedMonths = new Set<number>();
  const cursor = new Date(start); cursor.setUTCDate(1);
  while (cursor.getTime() <= end && selectedMonths.size < 12) {
    selectedMonths.add(cursor.getUTCMonth()); cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const wetterMonths = [...selectedMonths].filter(index => {
    const month = climate.months[index];
    return wettest >= 2 * Math.max(1, driest) && month.monthlyPrecip >= Math.max(60, annualMean)
      && wetDayFrequency(month) >= .3;
  });
  const precipitation = climate.sources.precipitation;
  const peakWet = Math.max(...observations.wet);
  if (wetterMonths.length) flags.push({ kind: 'wet', label: 'Wet-season pattern', basis: 'climate',
    detail: `Your dates overlap wetter months (${wetterMonths.map(index => MONTHS[index]).join(', ')}) at this location in the 1991–2020 baseline. This is a climate-based signal, not an official season boundary.`,
    sourceLabel: precipitation.provider, sourceUrl: precipitation.sourceUrl });
  else if (peakWet >= .6) flags.push({ kind: 'wet', label: 'Frequent wet days', basis: 'climate',
    detail: `Around ${Math.round(peakWet * 100)}% of historical days have at least 1 mm of precipitation in the wettest part of these dates. This includes the water equivalent of snow.`,
    sourceLabel: precipitation.provider, sourceUrl: precipitation.sourceUrl });
  const peakHigh = Math.max(...observations.highs), low = Math.min(...observations.lows);
  const temperature = climate.sources.temperature;
  if (peakHigh >= 35) flags.push({ kind: 'heat', label: 'Hot daytime highs', basis: 'climate', temperature: peakHigh,
    detail: 'Typical daytime highs reach this level during part of your dates.', sourceLabel: temperature.provider, sourceUrl: temperature.sourceUrl });
  if (low <= 0) flags.push({ kind: 'cold', label: 'Freezing nights', basis: 'climate', temperature: low,
    detail: 'Typical nighttime lows reach this level during part of your dates.', sourceLabel: temperature.provider, sourceUrl: temperature.sourceUrl });
  const order = { storm: 0, heat: 1, cold: 2, wet: 3 };
  return flags.sort((a, b) => order[a.kind] - order[b.kind]);
}
