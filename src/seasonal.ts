import beachHours from './data/beach-hours.json';
import beachBases from './data/beach-bases.json';
import { fractionalMonth, interp, rankCities } from './scoring';
import { destinationName } from './regions';
import { wetDayFrequency } from './climate';
import type { CityScore, CityClimate } from './types';

type Experience = 'coast' | 'nature' | 'sightseeing';
const coastal = new Set(beachBases);
const nature = new Set(['Serengeti', 'Victoria Falls', 'Queenstown', 'Galápagos', 'Patagonia', 'Banff', 'Interlaken', 'Puerto Villamil', 'Puerto Baquerizo Moreno', 'El Chaltén', 'Puerto Natales', 'Ubud']);
const areas: Record<string, string> = { 'El Nido': 'Palawan', Balabag: 'Boracay', Tamarindo: 'Guanacaste Coast', Galle: 'Sri Lanka South Coast', Phuket: 'Andaman Coast', 'Cancún': 'Mexican Caribbean' };
export function seasonalArea(r: CityScore) { return r.city.region || areas[r.city.name]; }
export function seasonalTitle(r: CityScore) { return seasonalArea(r) || destinationName(r.city); }

// Plateau and taper widths are product assumptions, in Celsius.
const bands = { coast: [24, 32, 10], nature: [14, 26, 12], sightseeing: [17, 28, 12] };
function comfort(high: number, experience: Experience) {
  const [low, upper, taper] = bands[experience];
  return Math.max(0, 1 - Math.max(0, low - high, high - upper) / taper);
}
const hourly: Record<string, { months: { dry: number; light: number; days: number }[] }> = beachHours;
const cache = new WeakMap<CityClimate, number[]>();
export function seasonalScore(r: CityScore): CityScore {
  const experience = coastal.has(r.city.name) ? 'coast' : nature.has(r.city.name) ? 'nature' : 'sightseeing';
  const record = hourly[r.city.name];
  let months = cache.get(r.climate);
  if (!months) {
    months = r.climate.months.map((m, i) => {
      const fit = m.highHistogram.reduce((sum, n, i) => sum + n * comfort((m.histogramStart + i) / 10, experience), 0) / m.temperatureDays;
      const hours = record?.months[i];
      return fit * (hours ? hours.dry / hours.light : 1 - wetDayFrequency(m));
    });
    cache.set(r.climate, months);
  }
  let quality = 0, historical = 0, days = 0;
  let dryHours = 0, hourlyDays = 0;
  const monthlyHours = record?.months.map(m => m.dry / m.days);
  for (const period of r.weatherPeriods) {
    const baseline = interp(months, fractionalMonth(period.start));
    const forecastHours = experience === 'coast' ? period.daylight : undefined;
    const fit = period.rain.source === 'forecast' ? comfort(period.apparentHigh ?? period.high, experience) * (forecastHours ? forecastHours.dry / forecastHours.light : Number(period.rain.millimeters < 1)) : baseline;
    const weight = period.usableDays ?? period.days;
    const hours = period.rain.source === 'forecast' ? forecastHours?.dry : monthlyHours && interp(monthlyHours, fractionalMonth(period.start));
    if (hours !== undefined) {
      dryHours += hours * weight;
      hourlyDays += weight;
    }
    quality += fit * weight;
    historical += baseline * weight;
    days += weight;
  }
  quality /= days || 1;
  historical /= days || 1;
  // A nearly flat annual climate earns a neutral timing fit. Smooth ties over ten percentage points.
  const timing = months.reduce((sum, month) => sum + Math.max(0, Math.min(1, 0.5 + (historical - month) / 0.1)), 0) / 12;
  const scale = r.tripCost ? 0.9 : 1;
  const points = { experience: 45 * quality * scale, timing: 25 * timing * quality * scale,
    travel: 20 * r.breakdown.fits.travel * scale, crowds: 10 * r.breakdown.fits.crowds * scale,
    cost: r.tripCost ? 10 * r.breakdown.fits.cost : 0 };
  const assessment = timing >= 0.7 ? 'Among the better times of year' : timing <= 0.3 ? 'A less favorable time of year' : 'Typical seasonal conditions';
  return { ...r, score: Object.values(points).reduce((a, b) => a + b, 0), seasonal: { experience, assessment, points, dryDaylightHours: hourlyDays ? dryHours / hourlyDays : undefined } };
}

export function rankSeasonalAreas(scores: CityScore[]) {
  const seen = new Set<string>();
  return rankCities(scores).filter(r => {
    const key = seasonalTitle(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((r, index) => ({ ...r, rank: index + 1 }));
}
