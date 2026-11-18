import { validateTrip } from './scoring';
import type { Trip } from './types';

export function tripFromUrl(url: URL, fallback: Trip): Trip {
  const trip = { start: url.searchParams.get('start') ?? '', end: url.searchParams.get('end') ?? '' };
  return validateTrip(trip) ? fallback : trip;
}

export function topPickChange(previous: readonly string[], current: readonly string[]): string {
  if (!current.length) return 'No destinations match these dates.';
  const count = Math.min(3, current.length);
  const position = previous.indexOf(current[0]);
  if (position > 0) return `${current[0]} moved from #${position + 1} to #1.`;
  if (position < 0) return `${current[0]} is the new top pick.`;
  for (let i = 1; i < count; i++) {
    if (current[i] === previous[i]) continue;
    const from = previous.indexOf(current[i]);
    return from < 0 ? `${current[i]} entered at #${i + 1}.` : `${current[i]} moved from #${from + 1} to #${i + 1}.`;
  }
  if (count < 3) return count === 1 ? `${current[0]} is the only match.` : `Top picks: ${current.slice(0, count).join(' and ')}.`;
  return 'Same top three for these dates.';
}
