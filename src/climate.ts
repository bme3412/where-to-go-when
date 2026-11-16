import baseline from './data/climate.json';
import type { CityClimate, ClimateMonth, TemperatureRange } from './types';

export const CLIMATE_SOURCE = baseline;
const locations = baseline.locations as Readonly<Record<string, CityClimate>>;

export function climateFor(name: string): CityClimate {
  const climate = locations[name];
  // The import and build tests require complete coverage; never use invented fallback weather.
  if (!climate) throw new Error(`No sourced climate baseline for ${name}`);
  return climate;
}

/** Fraction of historical daily highs within the chosen inclusive range, at 0.1°C precision. */
export function temperatureFrequency(month: ClimateMonth, range: TemperatureRange): number {
  const lower = Math.ceil(range.min * 10 - 1e-8);
  const upper = Math.floor(range.max * 10 + 1e-8);
  let count = 0;
  for (let index = 0; index < month.highHistogram.length; index++) {
    const temperature = month.histogramStart + index;
    if (temperature >= lower && temperature <= upper) count += month.highHistogram[index];
  }
  return count / month.temperatureDays;
}

export function wetDayFrequency(month: ClimateMonth): number {
  return month.wetDays / month.precipitationDays;
}

/** A data-source label, separate from the preference-match color. */
export function climateLabel(climate: CityClimate): string {
  const { temperature, precipitation } = climate.sources;
  if (temperature.kind === 'station' && precipitation.kind === 'station') return 'Nearby station data';
  if (temperature.kind === 'grid' && precipitation.kind === 'grid') return 'Regional grid estimate';
  return temperature.kind === 'station' ? 'Station temp · grid precipitation' : 'Grid temp · station precipitation';
}

export function climateSourceKind(climate: CityClimate): 'station' | 'mixed' | 'grid' {
  const kinds = Object.values(climate.sources).map(source => source.kind);
  return kinds.every(kind => kind === 'station') ? 'station' : kinds.every(kind => kind === 'grid') ? 'grid' : 'mixed';
}
