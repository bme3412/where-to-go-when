import type { City } from './types';

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
