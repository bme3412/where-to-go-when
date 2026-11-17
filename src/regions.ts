import type { City } from './types';

export const REGIONS = ['Galápagos', 'Goa', 'Patagonia'] as const;
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
};
// Stable keys preserve each original record and its agency provenance.
export const regionMetadata = (name: string) => MEMBERS[name] ?? {};
export const destinationName = (city: Pick<City, 'name' | 'displayName'>): string => city.displayName ?? city.name;
