import type { City } from './types';

// Broad destination groups and their camera presets, separate from local comparison areas.
export const GLOBE_REGIONS = [
  { id: 'europe', name: 'Europe', lon: 15, lat: 51, zoom: 2.4 },
  { id: 'north-america', name: 'North America', lon: -105, lat: 44, zoom: 1.6 },
  { id: 'central-america', name: 'Central America & Caribbean', lon: -80, lat: 18, zoom: 2.5 },
  { id: 'south-america', name: 'South America', lon: -60, lat: -18, zoom: 1.55 },
  { id: 'africa', name: 'Africa', lon: 20, lat: 3, zoom: 1.5 },
  { id: 'asia', name: 'Asia', lon: 100, lat: 32, zoom: 1.45 },
  { id: 'middle-east', name: 'Middle East', lon: 45, lat: 29, zoom: 2.8 },
  { id: 'oceania', name: 'Oceania', lon: 158, lat: -23, zoom: 1.65 },
] as const;
export type DestinationRegionId = typeof GLOBE_REGIONS[number]['id'];
export type DestinationRegionFilter = DestinationRegionId | 'all';

const COUNTRY_REGIONS: Readonly<Record<string, DestinationRegionId>> = {
  France: 'europe', 'United Kingdom': 'europe', Italy: 'europe', Spain: 'europe',
  Portugal: 'europe', Greece: 'europe', Croatia: 'europe', Netherlands: 'europe',
  Poland: 'europe', Hungary: 'europe', Austria: 'europe', Belgium: 'europe', Germany: 'europe', Ireland: 'europe', Sweden: 'europe',
  Czechia: 'europe', Denmark: 'europe', Switzerland: 'europe', Iceland: 'europe',
  'United States of America': 'north-america', Canada: 'north-america', Mexico: 'north-america',
  'El Salvador': 'central-america', Panama: 'central-america', 'Costa Rica': 'central-america', Cuba: 'central-america', 'Puerto Rico': 'central-america', Aruba: 'central-america',
  Colombia: 'south-america', Ecuador: 'south-america', Peru: 'south-america', Brazil: 'south-america',
  Argentina: 'south-america', Uruguay: 'south-america', Chile: 'south-america',
  Nigeria: 'africa', "Côte d'Ivoire": 'africa', Algeria: 'africa', Tunisia: 'africa',
  Rwanda: 'africa', Uganda: 'africa', Angola: 'africa', Kenya: 'africa', Ethiopia: 'africa', Ghana: 'africa', Senegal: 'africa', Morocco: 'africa', Egypt: 'africa', 'South Africa': 'africa', Tanzania: 'africa', Zimbabwe: 'africa', Mauritius: 'africa',
  Philippines: 'asia', Malaysia: 'asia', Taiwan: 'asia', Japan: 'asia', 'South Korea': 'asia', China: 'asia', Thailand: 'asia', Vietnam: 'asia', Cambodia: 'asia',
  Indonesia: 'asia', Singapore: 'asia', Maldives: 'asia', India: 'asia', Nepal: 'asia', 'Sri Lanka': 'asia',
  Oman: 'middle-east', Qatar: 'middle-east', Turkey: 'middle-east', Jordan: 'middle-east', 'United Arab Emirates': 'middle-east',
  Australia: 'oceania', 'New Zealand': 'oceania', Fiji: 'oceania',
};
// Group overseas locations by their location, while domestic/global scope still uses country.
// Istanbul is included in Europe as an explicit travel-region convention.
const PLACE_REGIONS: Readonly<Record<string, DestinationRegionId>> = {
  Tahiti: 'oceania', Honolulu: 'oceania', Istanbul: 'europe',
  Tenerife: 'africa', 'Puerto de la Cruz': 'africa', 'La Orotava': 'africa',
};

export function destinationRegion(city: Pick<City, 'name' | 'country'>): DestinationRegionId | undefined {
  return PLACE_REGIONS[city.name] ?? COUNTRY_REGIONS[city.country];
}

export function matchesDestinationRegion(city: Pick<City, 'name' | 'country'>, region: DestinationRegionFilter): boolean {
  return region === 'all' || destinationRegion(city) === region;
}

export const REGIONS = ['Galápagos', 'Goa', 'Patagonia', 'Bali', 'Tenerife', 'Maldives'] as const;
export const REGION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'Galápagos': 'Santa Cruz · San Cristóbal · Isabela',
  Goa: 'Panaji · Palolem · inland Bandoli',
  Patagonia: 'El Calafate · El Chaltén · Puerto Natales',
  Bali: 'Denpasar · coastal Sanur · inland Ubud',
  Tenerife: 'El Médano · Puerto de la Cruz · inland La Orotava',
  Maldives: 'Malé · Maafushi · Dhigurah islands',
};
const MEMBERS: Readonly<Record<string, { region: string; displayName?: string }>> = {
  'Galápagos': { region: 'Galápagos', displayName: 'Puerto Ayora' },
  'Puerto Baquerizo Moreno': { region: 'Galápagos' },
  'Puerto Villamil': { region: 'Galápagos' },
  'Goa': { region: 'Goa', displayName: 'Bandoli area' },
  'Panaji': { region: 'Goa' },
  'Palolem': { region: 'Goa' },
  'Patagonia': { region: 'Patagonia', displayName: 'El Calafate' },
  'El Chaltén': { region: 'Patagonia' },
  'Puerto Natales': { region: 'Patagonia' },
  Bali: { region: 'Bali', displayName: 'Denpasar' },
  Sanur: { region: 'Bali' },
  Ubud: { region: 'Bali' },
  Tenerife: { region: 'Tenerife', displayName: 'El Médano' },
  'Puerto de la Cruz': { region: 'Tenerife' },
  'La Orotava': { region: 'Tenerife' },
  Maldives: { region: 'Maldives', displayName: 'Malé' },
  Maafushi: { region: 'Maldives' },
  Dhigurah: { region: 'Maldives' },
};
// Stable keys preserve each original record and its agency provenance.
export const regionMetadata = (name: string) => MEMBERS[name] ?? {};
export const destinationName = (city: Pick<City, 'name' | 'displayName'>): string => city.displayName ?? city.name;
