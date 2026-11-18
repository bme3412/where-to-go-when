import { ONWARD_TRANSFERS } from './data/onward-transfers';
import type { DailyForecast, Forecasts } from './forecast';
import { CITIES } from './data/cities';
import { DOMESTIC_COUNTRY_GROUPS } from './data/origins';
import { eventsForYear } from './data/events';
import { weatherFlagsFor } from './weather';
import { climateFor, temperatureFrequency, wetDayFrequency } from './climate';
import { bostonTrip } from './flights';
import type { City, CityScore, Dealbreaker, DestinationScope, Origin, Place, RankedCity, SampledTrip, ScoreFactors, TemperatureRange, Travel, Trip, TripEvent, TripPriceEstimate, WeatherPeriod, Weights } from './types';

export { easter, thanksgiving, eventsForYear } from './data/events';
export const DAY = 86_400_000;
export const TRAVEL_HOURS_PER_USABLE_DAY = 14;
export const DEFAULT_WEIGHTS: Readonly<Weights> = { weather: 40, dry: 25, crowds: 10, travel: 25 };
export const DEFAULT_TEMPERATURE: Readonly<TemperatureRange> = { min: 20, max: 30 };
export const WEIGHT_KEYS = ['weather', 'dry', 'crowds', 'travel'] as const;
const BASE_SCORE_KEYS = ['weather', 'dry', 'reliability', 'crowds', 'travel'] as const;
export const SCORE_KEYS = [...BASE_SCORE_KEYS, 'cost'] as const;
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

/** Shift the departure month, clamp month-end dates, and retain inclusive trip length. */
export function shiftTripMonth(trip: Trip, offset: number): Trip | null {
  if (validateTrip(trip) || !Number.isInteger(offset)) return null;
  const first = parseDate(trip.start)!, duration = parseDate(trip.end)! - first;
  const shifted = new Date(first), day = shifted.getUTCDate();
  shifted.setUTCDate(1); shifted.setUTCMonth(shifted.getUTCMonth() + offset);
  const lastDay = new Date(shifted); lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  shifted.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  const finish = new Date(shifted.getTime() + duration);
  if (!Number.isFinite(shifted.getTime()) || !Number.isFinite(finish.getTime())) return null;
  const result = { start: shifted.toISOString().slice(0, 10), end: finish.toISOString().slice(0, 10) };
  return validateTrip(result) ? null : result;
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

export function travel(home: Place, destination: Place, tripDays: number, nonstopOnly = false): Travel {
  const km = distance(home, destination);
  const mode = km < 450 ? 'drive' : 'flight';
  const estimate = mode === 'drive' ? km / 75 : km / 780 + 0.6 + 2 + (km > 7000 ? 2 : 0) + (km > 12500 ? 2 : 0);
  const flights = home.name === 'Boston' && mode === 'flight' ? bostonTrip(destination.name, nonstopOnly) : undefined;
  const outMinutes = flights?.outbound?.totalMinutes, backMinutes = flights?.inbound?.totalMinutes;
  const hasOutbound = outMinutes != null, hasReturn = backMinutes != null;
  const onwardTransfer = mode === 'flight' ? ONWARD_TRANSFERS[destination.name] : undefined;
  const fallbackHours = estimate + (onwardTransfer?.minutes ?? 0) / 60;
  const hours = hasOutbound ? outMinutes / 60 : fallbackHours;
  const returnHours = hasReturn ? backMinutes / 60 : fallbackHours;
  const basis = hasOutbound && hasReturn ? 'routes' : hasOutbound || hasReturn ? 'mixed' : 'distance';
  const difference = Math.abs(home.tz - destination.tz);
  const timeShift = Math.min(difference, 24 - difference);
  const lost = Math.min(tripDays, (hours + returnHours) / TRAVEL_HOURS_PER_USABLE_DAY + Math.min(1.2, 0.1 * timeShift));
  const usable = tripDays - lost;
  return { km, mode, hours, returnHours, timeShift, lost, usable, factor: usable / tripDays, basis, flights, onwardTransfer };
}

/** Count the friction of a known connection separately from time spent traveling. */
export function connectionFitPenalty(journey: Travel, tripDays: number): number {
  const connections = [journey.flights?.outbound, journey.flights?.inbound]
    .reduce((sum, direction) => sum + (!direction ? 0 : Math.max(0, direction.route.legs.length - 1)), 0);
  const shortTripWeight = clamp((14 - tripDays) / 11, 0, 1);
  return connections * 1.5 / (TRAVEL_HOURS_PER_USABLE_DAY * tripDays) * shortTripWeight;
}

export function tripEvents(trip: Trip): TripEvent[] {
  const events: TripEvent[] = [];
  for (let year = Number(trip.start.slice(0, 4)) - 1; year <= Number(trip.end.slice(0, 4)); year++) events.push(...eventsForYear(year));
  return events;
}

/** Probability that successful days cover at least the target amount of usable time. */
export function comfortableDryChance(periods: readonly { days: number; chance: number }[], target: number): number {
  if (target <= 0) return 0;
  const wholeDays = periods.reduce((sum, period) => sum + Math.floor(period.days + 1e-9), 0);
  if (wholeDays > 90) {
    let expected = 0, variance = 0;
    for (const { days, chance } of periods) {
      const whole = Math.floor(days + 1e-9);
      expected += days * chance;
      variance += (whole + (days - whole) ** 2) * chance * (1 - chance);
    }
    if (!variance) return Number(expected + 1e-9 >= target);
    // Approximate the normal CDF for long trips, where an exact count grows quadratically.
    const z = (expected - target) / Math.sqrt(variance);
    return 1 / (1 + Math.exp(-1.5976 * z - 0.07056 * z ** 3));
  }

  const counts = new Float64Array(wholeDays + 1);
  counts[0] = 1;
  let processed = 0;
  let edges = [{ days: 0, chance: 1 }];
  for (const { days, chance } of periods) {
    const whole = Math.floor(days + 1e-9);
    for (let day = 0; day < whole; day++) {
      for (let count = ++processed; count > 0; count--) {
        counts[count] = counts[count] * (1 - chance) + counts[count - 1] * chance;
      }
      counts[0] *= 1 - chance;
    }
    const fraction = days - whole;
    if (fraction > 1e-9) {
      edges = edges.flatMap(edge => [
        { days: edge.days, chance: edge.chance * (1 - chance) },
        { days: edge.days + fraction, chance: edge.chance * chance },
      ]);
    }
  }
  return clamp(edges.reduce((sum, edge) => sum + edge.chance * counts
    .subarray(Math.max(0, Math.ceil(target - edge.days - 1e-9)))
    .reduce((tail, chance) => tail + chance, 0), 0), 0, 1);
}

export function scoreCity(city: City, home: Origin, samples: SampledTrip, weights: Weights, events: readonly TripEvent[], temperatureRange: TemperatureRange = DEFAULT_TEMPERATURE, nonstopOnly = false, forecast?: DailyForecast, homeForecast?: DailyForecast): CityScore {
  const temperatureError = validateTemperature(temperatureRange);
  if (temperatureError) throw new RangeError(temperatureError);
  const base = normalizeWeights(weights);
  const move = base.weather && base.dry ? 0.2 : 0;
  const shares: ScoreFactors = {
    ...base, cost: 0, weather: base.weather * (1 - move), dry: base.dry * (1 - move),
    reliability: (base.weather + base.dry) * move,
  };
  const climate = climateFor(city.name), homeClimate = climateFor(home.name);
  const monthlyFits = climate.months.map(month => temperatureFrequency(month, temperatureRange));
  const monthlyHighs = climate.months.map(month => month.meanHigh);
  const monthlyLows = climate.months.map(month => month.meanLow);
  const monthlyRain = climate.months.map(month => month.monthlyPrecip);
  const monthlyWet = climate.months.map(wetDayFrequency);
  const monthlyHome = homeClimate.months.map(month => month.meanHigh);
  const relevantEvents = events.filter(event => event.cities.has(city.name) || Boolean(city.region && event.cities.has(city.region)));
  const hasCrowdSeasons = city.peak.length > 0 || city.shoulder.length > 0;
  const crowds = Array.from({ length: 12 }, (_, month) => city.peak.includes(month + 1) ? 0.8 : city.shoulder.includes(month + 1) || !hasCrowdSeasons ? 0.5 : 0.2);
  const eventNames = new Set<string>();
  const dealbreakers = new Set<Dealbreaker>();
  const highs: number[] = [], lows: number[] = [], homeHighs: number[] = [], rains: number[] = [], crowdLevels: number[] = [], wetLevels: number[] = [], weatherFits: number[] = [], comfortFits: number[] = [];
  let apparentDays = 0;
  const start = samples.days[0].timestamp, end = start + (samples.tripDays - 1) * DAY;
  const forecastDates = [...(forecast?.keys() ?? [])].filter(day => day >= start && day <= end).sort((a, b) => a - b);
  const originDates = [...(homeForecast?.keys() ?? [])].filter(day => day >= start && day <= end);
  const exactDates = [...forecastDates, ...originDates];
  const days = samples.days;
  // Forecast days get individual buckets even in trips with spaced climate samples.
  const weatherSamples = exactDates.length ? [...new Set([...days.map(day => day.timestamp),
    ...exactDates.flatMap(day => day < end ? [day, day + DAY] : [day])])].sort((a, b) => a - b) : days.map(day => day.timestamp);
  const widths: number[] = [], historicalHighs: number[] = [], historicalLows: number[] = [], historicalWet: number[] = [];
  for (const [index, timestamp] of weatherSamples.entries()) {
    const month = fractionalMonth(timestamp);
    const forecastDay = forecast?.get(timestamp);
    const width = ((weatherSamples[index + 1] ?? end + DAY) - timestamp) / DAY;
    const historicalHigh = interp(monthlyHighs, month), historicalLow = interp(monthlyLows, month);
    const baselineWet = interp(monthlyWet, month);
    const high = forecastDay?.high ?? historicalHigh;
    const rain = interp(monthlyRain, month);
    const homeHigh = homeForecast?.get(timestamp)?.high ?? interp(monthlyHome, month);
    const apparentHigh = forecastDay?.apparentHigh;
    if (apparentHigh !== undefined) apparentDays++;
    const daytimeHigh = apparentHigh ?? high;
    const fit = forecastDay ? Number(daytimeHigh >= temperatureRange.min - 1e-8 && daytimeHigh <= temperatureRange.max + 1e-8) : interp(monthlyFits, month);
    const low = forecastDay?.low ?? historicalLow;
    // Warm nights reduce temperature points gradually. Keep the daytime estimate separate.
    const nightHeat = clamp((low - 20) / 6, 0, 1);
    comfortFits.push(fit * (1 - 0.2 * nightHeat));
    const wetFrequency = forecastDay ? Number(forecastDay.precipitation >= 1) : baselineWet;
    let crowd = interp(crowds, month);
    if ((timestamp - start) % (samples.step * DAY) === 0) {
      for (const event of relevantEvents) {
        if (timestamp >= event.start && timestamp <= event.end) {
          crowd += event.crowd;
          eventNames.add(event.name);
        }
      }
      crowd = clamp(crowd, 0.05, 0.92);
      if (crowd > 0.86) dealbreakers.add('Packed');
      crowdLevels.push(crowd); rains.push(rain);
      historicalHighs.push(historicalHigh); historicalLows.push(historicalLow); historicalWet.push(baselineWet);
    }
    if (fit < 0.25 && daytimeHigh < temperatureRange.min) dealbreakers.add('Too cold');
    if (fit < 0.25 && daytimeHigh > temperatureRange.max) dealbreakers.add('Too hot');
    if (wetFrequency > 0.65) dealbreakers.add('Frequent precipitation');
    weatherFits.push(fit); wetLevels.push(wetFrequency);
    highs.push(high); lows.push(low); homeHighs.push(homeHigh);
    widths.push(width);
  }
  const journey = travel(home, city, samples.tripDays, nonstopOnly);
  // Place travel loss at the trip boundaries. Recovery is charged on arrival.
  const usableEnd = samples.tripDays - journey.returnHours / TRAVEL_HOURS_PER_USABLE_DAY;
  const usableStart = usableEnd - journey.usable;
  let comfortableDays = 0, comfortableDryDays = 0;
  const weatherPeriods: WeatherPeriod[] = [];
  const reliabilityPeriods: { days: number; chance: number }[] = [];
  for (let index = 0; index < weatherSamples.length; index++) {
    const offset = (weatherSamples[index] - start) / DAY;
    const usableDays = Math.max(0, Math.min(offset + widths[index], usableEnd) - Math.max(offset, usableStart));
    const comfortable = usableDays * weatherFits[index];
    comfortableDays += comfortable;
    const chance = weatherFits[index] * (1 - wetLevels[index]);
    const contribution = usableDays * chance;
    if (usableDays > 0) {
      // A sampled bucket may contain both partial boundary days and whole days.
      const from = Math.max(offset, usableStart);
      const to = Math.min(offset + widths[index], usableEnd);
      const first = Math.min(to, Math.ceil(from)) - from;
      const rest = to - from - first;
      if (first > 0) reliabilityPeriods.push({ days: first, chance });
      if (rest > 0) reliabilityPeriods.push({ days: rest, chance });
    }
    comfortableDryDays += contribution;
    const timestamp = weatherSamples[index], forecastDay = forecast?.get(timestamp);
    weatherPeriods.push({
      start: timestamp,
      days: widths[index],
      high: highs[index],
      apparentHigh: forecastDay?.apparentHigh,
      rain: forecastDay ? { source: 'forecast', millimeters: forecastDay.precipitation }
        : { source: 'historical', wetFrequency: wetLevels[index] },
      comfortableDryDays: contribution,
    });
  }
  const usableTemperatureFit = journey.usable > 0 ? clamp(comfortableDays / journey.usable, 0, 1) : 0;
  const weatherMean = (values: number[]) => exactDates.length
    ? values.reduce((sum, value, index) => sum + value * widths[index], 0) / samples.tripDays : mean(values);
  const targetDays = journey.usable / 2;
  const weatherReliability = { targetDays, chance: comfortableDryChance(reliabilityPeriods, targetDays) };
  const crowd = mean(crowdLevels);
  const fits: ScoreFactors = { cost: 0, reliability: weatherReliability.chance, weather: weatherMean(comfortFits), dry: 1 - weatherMean(wetLevels), crowds: 1 - crowd, travel: Math.max(0, journey.factor - connectionFitPenalty(journey, samples.tripDays)) };
  const contributions = Object.fromEntries(SCORE_KEYS.map(key => [key, fits[key] * shares[key]])) as unknown as ScoreFactors;
  const score = SCORE_KEYS.reduce((sum, key) => sum + contributions[key], 0);
  const weatherFlags = weatherFlagsFor(city, climate, samples, { highs: historicalHighs, lows: historicalLows, wet: historicalWet });
  const iso = (day: number) => new Date(day).toISOString().slice(0, 10);
  return {
    city, climate, score, comfortableDryDays, weatherReliability, usableTemperatureFit,
    temperatureComfort: { daytimeFit: weatherMean(weatherFits), apparentDays },
    weatherPeriods,
    weatherDates: { start: iso(start), end: iso(end), forecast: forecastDates.map(iso) },
    high: weatherMean(highs), low: weatherMean(lows), homeHigh: weatherMean(homeHighs), rain: mean(rains), wetFrequency: weatherMean(wetLevels), crowd,
    tripDays: samples.tripDays, travel: journey,
    breakdown: {
      fits, weights: shares, contributions, temperatureRange: { ...temperatureRange },
    },
    events: [...eventNames], risks: weatherFlags.filter(flag => flag.basis !== 'climate').map(flag => flag.label), dealbreakers: [...dealbreakers], weatherFlags,
  };
}

/** Use an optional USD estimate for one traveler. Unpriced trips retain the original score. */
function applyTripCost(result: CityScore, estimate?: TripPriceEstimate): CityScore {
  const nights = result.tripDays - 1;
  const airfare = estimate?.airfare;
  const nightlyLodging = nights === 0 ? 0 : estimate?.nightlyLodging;
  if (airfare === undefined || nightlyLodging === undefined || !Number.isFinite(airfare)
    || !Number.isFinite(nightlyLodging) || airfare < 0 || nightlyLodging < 0) return result;
  const total = airfare + nights * nightlyLodging;
  if (!Number.isFinite(total)) return result;
  const low = 250 + nights * 75, high = 1200 + nights * 250;
  const cost = clamp((high - total) / (high - low), 0, 1);
  const { breakdown } = result;
  const weights = { ...breakdown.weights, cost: 10 };
  const contributions = { ...breakdown.contributions, cost: cost * weights.cost };
  for (const key of BASE_SCORE_KEYS) {
    weights[key] *= 0.9;
    contributions[key] = breakdown.fits[key] * weights[key];
  }
  return {
    ...result,
    tripCost: { airfare, nightlyLodging, nights, total, lodgingSource: estimate?.lodgingSource, airfareSource: estimate?.airfareSource },
    score: SCORE_KEYS.reduce((sum, key) => sum + contributions[key], 0),
    breakdown: { ...breakdown, weights, contributions, fits: { ...breakdown.fits, cost } },
  };
}

export function scoreCities(trip: Trip, home: Origin, weights: Weights = DEFAULT_WEIGHTS, temperatureRange: TemperatureRange = DEFAULT_TEMPERATURE, nonstopOnly = false, forecasts?: Forecasts, prices?: ReadonlyMap<string, TripPriceEstimate>): CityScore[] {
  const samples = sampleDays(trip), events = tripEvents(trip);
  return CITIES.map(city => {
    const result = scoreCity(city, home, samples, weights, events, temperatureRange, nonstopOnly, forecasts?.get(city.name), forecasts?.get(home.name));
    return applyTripCost(result, prices?.get(city.name));
  });
}

export function minimumUsableStay(tripDays: number): number {
  if (tripDays === 1) return 0.5;
  return tripDays <= 3 ? 1 : 0;
}

export function isRankableCity(result: CityScore): boolean {
  const { travel, tripDays } = result;
  return travel.km >= 40 && travel.usable > 0 && travel.usable >= minimumUsableStay(tripDays);
}

export function rankCities(scores: readonly CityScore[]): RankedCity[] {
  return scores.filter(isRankableCity)
    .sort((a, b) => b.score - a.score || a.city.name.localeCompare(b.city.name))
    .map((result, index) => ({ ...result, rank: index + 1 }));
}

export function matchesDestinationScope(destinationCountry: string, homeCountry: string, scope: DestinationScope): boolean {
  if (scope === 'all') return true;
  const country = (name: string) => DOMESTIC_COUNTRY_GROUPS[name] ?? name;
  const domestic = country(destinationCountry) === country(homeCountry);
  return scope === 'domestic' ? domestic : !domestic;
}
