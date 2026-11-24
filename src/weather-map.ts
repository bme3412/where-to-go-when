import { primaryWeatherFlag } from './weather';
import type { CityScore, Unit, WeatherKind, WeatherLayer } from './types';

// Fixed Celsius boundaries keep the map comparable across dates and display units.
export const TEMPERATURE_COLORS = [
  { min: -Infinity, max: 0, color: '#7462b6' },
  { min: 0, max: 10, color: '#4389c4' },
  { min: 10, max: 20, color: '#369b94' },
  { min: 20, max: 30, color: '#d7ae47' },
  { min: 30, max: 35, color: '#df813c' },
  { min: 35, max: Infinity, color: '#c94f4c' },
] as const;
// Mean daily precipitation, including snow water equivalent; not rain probability.
export const RAIN_COLORS = [
  { min: 0, max: 1, color: '#e7d7af' },
  { min: 1, max: 2, color: '#c7ddc8' },
  { min: 2, max: 4, color: '#87c4c4' },
  { min: 4, max: 8, color: '#4c9dbd' },
  { min: 8, max: 12, color: '#326da4' },
  { min: 12, max: Infinity, color: '#4c4489' },
] as const;
export const WEATHER_KINDS = ['wet', 'heat', 'cold', 'storm'] as const;
export const SEASON_COLORS: Record<WeatherKind, { color: string; label: string }> = {
  wet: { color: '#2997b7', label: 'Wet season / rain' },
  heat: { color: '#dc7140', label: 'Heat' },
  cold: { color: '#7774c4', label: 'Freezing nights' },
  storm: { color: '#c18b24', label: 'Storm season' },
};

export function temperatureColor(high: number): string | null {
  if (!Number.isFinite(high)) return null;
  return TEMPERATURE_COLORS.find(band => high >= band.min && high < band.max)!.color;
}

export function weatherMapColor(result: Pick<CityScore, 'high' | 'weatherFlags'>, layer: WeatherLayer, kinds?: ReadonlySet<WeatherKind>): string | null {
  if (layer === 'off') return null;
  if (layer === 'temperature') return temperatureColor(result.high);
  const flag = primaryWeatherFlag(result.weatherFlags, layer, kinds);
  return flag ? SEASON_COLORS[flag.kind].color : null;
}

export function weatherLegend(layer: WeatherLayer, unit: Unit, enabledKinds?: ReadonlySet<WeatherKind>): { title: string; items: { color: string; label: string }[]; note: string } {
  if (layer === 'temperature') {
    const degrees = (value: number) => `${Math.round(unit === 'F' ? value * 9 / 5 + 32 : value)}°`;
    return { title: `Average daytime high · °${unit}`, items: TEMPERATURE_COLORS.map(band => ({
      color: band.color,
      label: !Number.isFinite(band.min) ? `< ${degrees(band.max)}` : !Number.isFinite(band.max) ? `${degrees(band.min)}+` : `${degrees(band.min)}–${degrees(band.max)}`,
    })), note: 'Land shows estimated highs · dots show destination match' };
  }
  if (layer === 'off') return { title: '', items: [], note: '' };
  if (layer === 'wet') return {
    title: 'Average precipitation · mm/day',
    items: RAIN_COLORS.map(band => ({ color: band.color,
      label: band.min === 0 ? '< 1' : !Number.isFinite(band.max) ? `${band.min}+` : `${band.min}–${band.max}`,
    })),
    note: !enabledKinds || enabledKinds.has('wet') ? 'Rain + snow equivalent · icons flag wet periods' : 'Rain + snow equivalent',
  };
  const kinds = layer === 'all' ? WEATHER_KINDS.filter(kind => !enabledKinds || enabledKinds.has(kind)) : [layer];
  return { title: 'Seasonal weather for your dates', items: kinds.map(kind => SEASON_COLORS[kind]), note: 'Unshaded = no flag in this layer' };
}
