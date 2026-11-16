import baseline from './data/climate.json';
import type { CityClimate, ClimateMonth, TemperatureRange } from './types';

export const CLIMATE_SOURCE = baseline;
const locations: Readonly<Record<string, CityClimate>> = baseline.locations;

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
  return count / month.days;
}
