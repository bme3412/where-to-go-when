import { CITIES } from './data/cities';
import { DOMESTIC_COUNTRY_GROUPS } from './data/origins';
import { eventsForYear } from './data/events';
import { RISKS } from './data/risks';
import { climateFor, temperatureFrequency, wetDayFrequency } from './climate';
import type { City, CityScore, Dealbreaker, DestinationScope, Origin, Place, RankedCity, SampledTrip, TemperatureRange, Travel, Trip, TripEvent, Weights } from './types';

export { easter, thanksgiving, eventsForYear } from './data/events';
export const DAY = 86_400_000;
export const DEFAULT_WEIGHTS: Readonly<Weights> = { weather: 40, dry: 25, crowds: 10, travel: 25 };
export const DEFAULT_TEMPERATURE: Readonly<TemperatureRange> = { min: 20, max: 30 };
export const WEIGHT_KEYS = ['weather', 'dry', 'crowds', 'travel'] as const;
export const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const mod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

export function parseDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

export function validateTrip(trip: Trip): string | null {
  const start = parseDate(trip.start);
  const end = parseDate(trip.end);
  if (start === null || end === null) return 'Pick both dates';
  if (end < start) return 'End date must be after the start date';
  return null;
}

/** The next December 20 that has not passed, evaluated in the visitor's local calendar. */
export function defaultTrip(today: Date): Trip {
  const year = today.getFullYear() + (today.getMonth() === 11 && today.getDate() > 20 ? 1 : 0);
  return { start: `${year}-12-20`, end: `${year + 1}-01-03` };
}

export function fractionalMonth(timestamp: number): number {
  const date = new Date(timestamp);
  const month = date.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return month + (date.getUTCDate() - 1) / daysInMonth;
}

export function sampleDays(trip: Trip): SampledTrip {
  const error = validateTrip(trip);
  if (error) throw new RangeError(error);
  const start = parseDate(trip.start)!;
  const tripDays = (parseDate(trip.end)! - start) / DAY + 1;
  const step = Math.max(1, Math.ceil(tripDays / 90));
  const days = [];
  for (let offset = 0; offset < tripDays; offset += step) {
    const timestamp = start + offset * DAY;
    days.push({ timestamp, month: fractionalMonth(timestamp) });
  }
  return { tripDays, step, days };
}

export function interp(values: readonly number[], month: number): number {
  const position = month - 0.5;
  const index = Math.floor(position);
  const fraction = position - index;
  return values[mod(index, 12)] + (values[mod(index + 1, 12)] - values[mod(index, 12)]) * fraction;
}

export function bump(month: number, center: number, width: number): number {
  const distance = Math.abs(mod(month, 12) - mod(center, 12));
  return Math.exp(-((Math.min(distance, 12 - distance) / width) ** 2));
}

/** Integer percentage allocation with stable largest-remainder rounding. */
function allocate(total: number, keys: readonly (keyof Weights)[], shares: Weights): Partial<Weights> {
  const sum = keys.reduce((value, key) => value + Math.max(0, shares[key]), 0);
  const portions = keys.map((key, index) => {
    const exact = total * (sum ? Math.max(0, shares[key]) / sum : 1 / keys.length);
    return { key, index, exact, value: Math.floor(exact) };
  });
  const remaining = total - portions.reduce((sum, item) => sum + item.value, 0);
  [...portions].sort((a, b) => (b.exact - b.value) - (a.exact - a.value) || a.index - b.index)
    .slice(0, remaining).forEach(item => item.value++);
  return Object.fromEntries(portions.map(item => [item.key, item.value]));
}

export function normalizeWeights(weights: Weights): Weights {
  if (WEIGHT_KEYS.some(key => !Number.isFinite(weights[key]) || weights[key] < 0)) throw new RangeError('Weights must be nonnegative finite numbers');
  if (WEIGHT_KEYS.every(key => weights[key] === 0)) return { ...DEFAULT_WEIGHTS };
  return allocate(100, WEIGHT_KEYS, weights) as Weights;
}

export function setWeight(weights: Weights, key: keyof Weights, value: number): Weights {
  if (!Number.isFinite(value)) throw new RangeError('Weight must be finite');
  const selected = clamp(Math.round(value), 0, 100);
  const others = WEIGHT_KEYS.filter(item => item !== key);
  return { ...weights, ...allocate(100 - selected, others, weights), [key]: selected };
}

export function validateTemperature(range: TemperatureRange): string | null {
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) return 'Enter both preferred temperatures.';
  if (range.min < -40 || range.max > 50) return 'Choose temperatures between −40°C and 50°C (−40°F and 122°F).';
  if (range.min >= range.max) return 'The upper temperature must be above the lower temperature.';
  return null;
}

export function distance(from: Pick<Place, 'lat' | 'lon'>, to: Pick<Place, 'lat' | 'lon'>): number {
  const radians = Math.PI / 180;
  const a = Math.sin((to.lat - from.lat) * radians / 2) ** 2
    + Math.cos(from.lat * radians) * Math.cos(to.lat * radians) * Math.sin((to.lon - from.lon) * radians / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(clamp(a, 0, 1)));
}

export function travel(home: Place, destination: Place, tripDays: number): Travel {
  const km = distance(home, destination);
  const mode = km < 450 ? 'drive' : 'flight';
  const hours = mode === 'drive' ? km / 75 : km / 780 + 0.6 + 2 + (km > 7000 ? 2 : 0) + (km > 12500 ? 2 : 0);
  const difference = Math.abs(home.tz - destination.tz);
  const timeShift = Math.min(difference, 24 - difference);
  const lost = Math.min(tripDays, 2 * hours / 14 + Math.min(1.2, 0.1 * timeShift));
  const usable = tripDays - lost;
  return { km, mode, hours, timeShift, lost, usable, factor: usable / tripDays };
}

export function tripEvents(trip: Trip): TripEvent[] {
  const events: TripEvent[] = [];
  for (let year = Number(trip.start.slice(0, 4)) - 1; year <= Number(trip.end.slice(0, 4)); year++) events.push(...eventsForYear(year));
  return events;
}

export function scoreCity(city: City, home: Origin, samples: SampledTrip, weights: Weights, events: readonly TripEvent[], temperatureRange: TemperatureRange = DEFAULT_TEMPERATURE): CityScore {
  const temperatureError = validateTemperature(temperatureRange);
  if (temperatureError) throw new RangeError(temperatureError);
  const shares = normalizeWeights(weights);
  const climate = climateFor(city.name), homeClimate = climateFor(home.name);
  const monthlyFits = climate.months.map(month => temperatureFrequency(month, temperatureRange));
  const monthlyHighs = climate.months.map(month => month.meanHigh);
  const monthlyLows = climate.months.map(month => month.meanLow);
  const monthlyRain = climate.months.map(month => month.monthlyPrecip);
  const monthlyWet = climate.months.map(wetDayFrequency);
  const monthlyHome = homeClimate.months.map(month => month.meanHigh);
  const relevantEvents = events.filter(event => event.cities.has(city.name));
  const relevantRisks = RISKS.filter(([cities]) => cities.has(city.name));
  const crowds = Array.from({ length: 12 }, (_, month) => city.peak.includes(month + 1) ? 0.8 : city.shoulder.includes(month + 1) ? 0.5 : 0.2);
  const eventNames = new Set<string>();
  const riskNames = new Set<string>();
  const dealbreakers = new Set<Dealbreaker>();
  const highs: number[] = [], lows: number[] = [], homeHighs: number[] = [], rains: number[] = [], crowdLevels: number[] = [], wetLevels: number[] = [], weatherFits: number[] = [];
  for (const { timestamp, month } of samples.days) {
    const high = interp(monthlyHighs, month);
    const rain = interp(monthlyRain, month);
    const homeHigh = interp(monthlyHome, month);
    const fit = interp(monthlyFits, month);
    const wetFrequency = interp(monthlyWet, month);
    let crowd = interp(crowds, month);
    for (const event of relevantEvents) {
      if (timestamp >= event.start && timestamp <= event.end) {
        crowd += event.crowd;
        eventNames.add(event.name);
      }
    }
    crowd = clamp(crowd, 0.05, 0.92);
    for (const [, peak, width, penalty, label] of relevantRisks) {
      const contribution = penalty * bump(month, peak, width);
      if (contribution > 0.04) riskNames.add(label);
    }
    if (fit < 0.25 && high < temperatureRange.min) dealbreakers.add('Too cold');
    if (fit < 0.25 && high > temperatureRange.max) dealbreakers.add('Too hot');
    if (wetFrequency > 0.65) dealbreakers.add('Frequent precipitation');
    if (crowd > 0.86) dealbreakers.add('Packed');
    weatherFits.push(fit); wetLevels.push(wetFrequency);
    highs.push(high); lows.push(interp(monthlyLows, month)); homeHighs.push(homeHigh); rains.push(rain); crowdLevels.push(crowd);
  }
  const journey = travel(home, city, samples.tripDays);
  const fits: Weights = { weather: mean(weatherFits), dry: 1 - mean(wetLevels), crowds: 1 - mean(crowdLevels), travel: journey.factor };
  const contributions = Object.fromEntries(WEIGHT_KEYS.map(key => [key, fits[key] * shares[key]])) as unknown as Weights;
  const score = WEIGHT_KEYS.reduce((sum, key) => sum + contributions[key], 0);
  return {
    city, climate, score,
    high: mean(highs), low: mean(lows), homeHigh: mean(homeHighs), rain: mean(rains), wetFrequency: mean(wetLevels), crowd: mean(crowdLevels),
    tripDays: samples.tripDays, travel: journey,
    breakdown: {
      fits, weights: shares, contributions, temperatureRange: { ...temperatureRange },
    },
    events: [...eventNames], risks: [...riskNames], dealbreakers: [...dealbreakers],
  };
}

export function scoreCities(trip: Trip, home: Origin, weights: Weights = DEFAULT_WEIGHTS, temperatureRange: TemperatureRange = DEFAULT_TEMPERATURE): CityScore[] {
  const samples = sampleDays(trip), events = tripEvents(trip);
  return CITIES.map(city => scoreCity(city, home, samples, weights, events, temperatureRange));
}

export function rankCities(scores: readonly CityScore[]): RankedCity[] {
  return scores.filter(result => result.travel.km >= 40)
    .sort((a, b) => b.score - a.score || a.city.name.localeCompare(b.city.name))
    .map((result, index) => ({ ...result, rank: index + 1 }));
}

export function matchesDestinationScope(destinationCountry: string, homeCountry: string, scope: DestinationScope): boolean {
  if (scope === 'all') return true;
  const country = (name: string) => DOMESTIC_COUNTRY_GROUPS[name] ?? name;
  const domestic = country(destinationCountry) === country(homeCountry);
  return scope === 'domestic' ? domestic : !domestic;
}
