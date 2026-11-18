import { validateTrip } from './scoring';
import type { Trip } from './types';

export function tripFromUrl(url: URL, fallback: Trip): Trip {
  const trip = { start: url.searchParams.get('start') ?? '', end: url.searchParams.get('end') ?? '' };
  return validateTrip(trip) ? fallback : trip;
}
