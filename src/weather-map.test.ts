import { describe, expect, it } from 'vitest';
import { ORIGINS } from './data/origins';
import { scoreCities } from './scoring';
import { SEASON_COLORS, TEMPERATURE_COLORS, weatherLegend, weatherMapColor } from './weather-map';

const boston = ORIGINS.find(city => city.name === 'Boston')!;
const scores = (date: string) => scoreCities({ start: date, end: date }, boston);

describe('weather colors on the globe', () => {
  it('uses the same physical temperature boundaries in the map and both unit legends', () => {
    const fahrenheit = weatherLegend('temperature', 'F').items;
    const celsius = weatherLegend('temperature', 'C').items;
    expect(fahrenheit.map(item => item.color)).toEqual(celsius.map(item => item.color));
    expect(celsius.map(item => item.label)).toEqual(['< 0°', '0°–10°', '10°–20°', '20°–30°', '30°–35°', '35°+']);
    expect(fahrenheit.map(item => item.label)).toEqual(['< 32°', '32°–50°', '50°–68°', '68°–86°', '86°–95°', '95°+']);
    for (const [index, high] of [-.001, 0, 10, 20, 30, 35].entries()) {
      expect(weatherMapColor({ high, weatherFlags: [] }, 'temperature')).toBe(celsius[index].color);
    }
    expect(weatherMapColor({ high: NaN, weatherFlags: [] }, 'temperature')).toBeNull();
  });

  it('changes local temperature colors with travel dates rather than recommendation score', () => {
    const january = scores('2027-01-15').find(result => result.city.name === 'Dubai')!;
    const july = scores('2027-07-15').find(result => result.city.name === 'Dubai')!;
    expect(weatherMapColor(january, 'temperature')).toBe(TEMPERATURE_COLORS[3].color);
    expect(weatherMapColor(july, 'temperature')).toBe(TEMPERATURE_COLORS[5].color);
    const differentMatch = { ...july, score: 100 };
    expect(weatherMapColor(differentMatch, 'temperature')).toBe(weatherMapColor(july, 'temperature'));
  });

  it('allows the chosen seasonal layer to expose rain beneath a higher-priority storm flag', () => {
    const miami = scores('2027-09-15').find(result => result.city.name === 'Miami')!;
    expect(weatherMapColor(miami, 'all')).toBe(SEASON_COLORS.storm.color);
    expect(weatherMapColor(miami, 'wet')).toBe(SEASON_COLORS.wet.color);
    expect(weatherMapColor(miami, 'cold')).toBeNull();
    expect(weatherMapColor(miami, 'off')).toBeNull();
    expect(weatherLegend('off', 'F').items).toEqual([]);
    expect(miami.weatherFlags.some(flag => flag.kind === 'storm')).toBe(true);
  });
});
