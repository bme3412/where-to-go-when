import type { Origin } from '../types';
import { CITIES } from './cities';

// Group separately named territories with their country for this destination filter.
export const DOMESTIC_COUNTRY_GROUPS: Readonly<Record<string, string>> = {
  'Puerto Rico': 'United States of America',
};

export const ORIGINS: readonly Origin[] = [...CITIES].sort((a, b) => a.name.localeCompare(b.name));
