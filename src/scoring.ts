import { CITIES } from './data/cities';
import { DOMESTIC_COUNTRY_GROUPS } from './data/origins';
import { eventsForYear } from './data/events';
import { RISKS } from './data/risks';
import type { City, CityScore, Dealbreaker, DestinationScope, Origin, Place, RankedCity, SampledTrip, Travel, Trip, TripEvent, Weights } from './types';

export { easter, thanksgiving, eventsForYear } from './data/events';
export const DAY = 86_400_000;
export const DEFAULT_WEIGHTS: Readonly<Weights> = { weather: 6, dry: 5, crowds: 3, travel: 5 };
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

export function tempFit(temperature: number): number {
  if (temperature < 20) return Math.max(0, 1 - (20 - temperature) / 13);
  if (temperature > 29) return Math.max(0, 1 - (temperature - 29) / 8);
  return 1;
}

export function weatherFit(temperature: number, homeTemperature: number): number {
  let fit = tempFit(temperature);
  if (homeTemperature < 12 && temperature > homeTemperature) fit += 0.15 * clamp((temperature - homeTemperature) / 15, 0, 1);
  if (homeTemperature > 31 && temperature < homeTemperature) fit += 0.15 * clamp((homeTemperature - temperature) / 10, 0, 1);
  return Math.min(1, fit);
}

export function geometricMean(factors: readonly (readonly [number, number])[]): number {
  const weight = factors.reduce((sum, [, w]) => sum + w, 0);
  if (weight === 0) return 0.5;
  return Math.exp(factors.reduce((sum, [value, w]) => sum + w * Math.log(Math.max(0.03, value)), 0) / weight);
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
  return { km, mode, hours, timeShift, lost, usable, factor: Math.max(0.03, usable / tripDays) };
}

export function tripEvents(trip: Trip): TripEvent[] {
  const events: TripEvent[] = [];
  for (let year = Number(trip.start.slice(0, 4)) - 1; year <= Number(trip.end.slice(0, 4)); year++) events.push(...eventsForYear(year));
  return events;
}

export function scoreCity(city: City, home: Origin, samples: SampledTrip, weights: Weights, events: readonly TripEvent[]): CityScore {
  const relevantEvents = events.filter(event => event.cities.has(city.name));
  const relevantRisks = RISKS.filter(([cities]) => cities.has(city.name));
  const crowds = Array.from({ length: 12 }, (_, month) => city.peak.includes(month + 1) ? 0.8 : city.shoulder.includes(month + 1) ? 0.5 : 0.2);
  const eventNames = new Set<string>();
  const riskNames = new Set<string>();
  const dealbreakers = new Set<Dealbreaker>();
  const highs: number[] = [], homeHighs: number[] = [], rains: number[] = [], crowdLevels: number[] = [], scores: number[] = [];
  const weatherFits: number[] = [], dryFits: number[] = [], baseScores: number[] = [];
  for (const { timestamp, month } of samples.days) {
    const high = interp(city.high, month);
    const rain = interp(city.rain, month);
    const homeHigh = interp(home.high, month);
    const fit = weatherFit(high, homeHigh);
    const dry = clamp(1 - rain / 240, 0, 1);
    let crowd = interp(crowds, month);
    for (const event of relevantEvents) {
      if (timestamp >= event.start && timestamp <= event.end) {
        crowd += event.crowd;
        eventNames.add(event.name);
      }
    }
    crowd = clamp(crowd, 0.05, 0.92);
    let risk = 0;
    for (const [, peak, width, penalty, label] of relevantRisks) {
      const contribution = penalty * bump(month, peak, width);
      risk += contribution;
      if (contribution > 0.04) riskNames.add(label);
    }
    const baseScore = geometricMean([[fit, weights.weather], [dry, weights.dry], [1 - crowd, weights.crowds]]);
    const dayScore = baseScore * (1 - risk);
    if (fit < 0.25) dealbreakers.add(high < 20 ? 'Too cold' : 'Too hot');
    if (dry < 0.2) dealbreakers.add('Very rainy');
    if (crowd > 0.86) dealbreakers.add('Packed');
    weatherFits.push(fit); dryFits.push(dry); baseScores.push(baseScore);
    highs.push(high); homeHighs.push(homeHigh); rains.push(rain); crowdLevels.push(crowd); scores.push(dayScore);
  }
  const journey = travel(home, city, samples.tripDays);
  const baseScore = 100 * mean(baseScores);
  const afterRisk = 100 * mean(scores);
  const travelMultiplier = journey.factor ** (weights.travel / 7);
  const score = afterRisk * travelMultiplier;
  return {
    city, score,
    high: mean(highs), homeHigh: mean(homeHighs), rain: mean(rains), crowd: mean(crowdLevels),
    tripDays: samples.tripDays, travel: journey,
    breakdown: {
      weatherFit: mean(weatherFits), dryFit: mean(dryFits), crowdFit: 1 - mean(crowdLevels),
      weights: { ...weights }, baseScore, riskDeduction: baseScore - afterRisk,
      travelMultiplier, travelDeduction: afterRisk - score,
    },
    events: [...eventNames], risks: [...riskNames], dealbreakers: [...dealbreakers],
  };
}

export function scoreCities(trip: Trip, home: Origin, weights: Weights = DEFAULT_WEIGHTS): CityScore[] {
  const samples = sampleDays(trip), events = tripEvents(trip);
  return CITIES.map(city => scoreCity(city, home, samples, weights, events));
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
