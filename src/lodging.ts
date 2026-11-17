import { CITIES } from './data/cities';
import { countryFlag } from './data/destination-tips';

export const LODGING_ENDPOINT = '/api/lodging-estimate';

const countryCodes = new Map(CITIES.flatMap(city => {
  const flag = Array.from(countryFlag(city.country), character => character.codePointAt(0)!);
  const regionalIndicatorA = 0x1f1e6;
  if (flag.length !== 2 || flag.some(code => code < regionalIndicatorA || code > regionalIndicatorA + 25)) return [];
  return [[city.name, String.fromCharCode(...flag.map(code => code - regionalIndicatorA + 65))] as const];
}));

export function lodgingCountryCode(city: string): string | undefined {
  return countryCodes.get(city);
}

export interface LodgingQuote {
  total: number;
  nights: number;
  nightlyAverage: number;
  retrievedAt: string;
}
