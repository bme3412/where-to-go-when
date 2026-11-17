import { describe, expect, it, vi } from 'vitest';
import { createLodgingHandler } from './lodging';
import { ORIGINS } from '../data/origins';
import { rankCities, scoreCities } from '../scoring';
import type { TripPriceEstimate } from '../types';
import type { LodgingQuote } from '../lodging';

const day = 86_400_000;
const clock = () => Date.parse('2026-11-17T22:00:00Z');
const boston = ORIGINS.find(origin => origin.name === 'Boston')!;

function lookup(city: string, checkin: string, checkout: string) {
  return new Request(`https://local.test/api/lodging-estimate?${new URLSearchParams({ city, checkin, checkout })}`);
}

describe('Nuitée lodging estimates', () => {
  it.each([
    ['2026-12-18', '2026-12-20', 2, [['Miami', 'US', 225], ['Mexico City', 'MX', 75]]],
    ['2026-12-20', '2027-01-03', 14, [['Lima', 'PE', 85], ['Miami', 'US', 225], ['Mexico City', 'MX', 75]]],
  ] as const)('prices the Boston trip %s to %s', async (start, end, nights, destinations) => {
    const provider = vi.fn<typeof fetch>();
    const lodging = createLodgingHandler(provider, clock);
    const trip = { start, end };
    const baseline = scoreCities(trip, boston);
    const prices = new Map<string, TripPriceEstimate>();
    const fares: Record<string, number> = { Lima: 620, Miami: 380, 'Mexico City': 330 };
    for (const [city, country, nightly] of destinations) {
      provider.mockResolvedValueOnce(Response.json({
        prices: Array.from({ length: nights + 1 }, (_, index) => ({
          day: new Date(Date.parse(start) + index * day).toISOString().slice(0, 10),
          avgPriceUsd: index === nights ? 10000 : nightly,
        })),
      }));
      const response = await lodging(lookup(city, start, end), 'fixture-key', true);
      expect(response.status).toBe(200);
      const quote = await response.json() as LodgingQuote;
      expect(quote).toMatchObject({ total: nights * nightly, nightlyAverage: nightly, nights });
      const [url, options] = provider.mock.lastCall!;
      expect(new URL(String(url)).searchParams.get('countryCode')).toBe(country);
      expect(new URL(String(url)).searchParams.get('toDate')).toBe(new Date(Date.parse(end) - day).toISOString().slice(0, 10));
      expect(new Headers(options?.headers).get('X-API-Key')).toBe('fixture-key');
      const partial = new Map([[city, { nightlyLodging: quote.nightlyAverage, lodgingSource: 'nuitee' as const }]]);
      const lodgingOnly = scoreCities(trip, boston, undefined, undefined, false, undefined, partial).find(result => result.city.name === city)!;
      expect(lodgingOnly.score).toBe(baseline.find(result => result.city.name === city)!.score);
      prices.set(city, { airfare: fares[city], nightlyLodging: quote.nightlyAverage, lodgingSource: 'nuitee' });
    }
    const ranked = rankCities(scoreCities(trip, boston, undefined, undefined, false, undefined, prices));
    expect(ranked[0].city.name).toBe(nights === 2 ? 'Mexico City' : 'Tenerife');
    expect(ranked.find(result => result.city.name === 'Miami')?.tripCost?.lodgingSource).toBe('nuitee');
    const callCount = provider.mock.calls.length;
    await lodging(lookup(destinations[0][0], start, end), 'fixture-key', true);
    expect(provider).toHaveBeenCalledTimes(callCount);
  });

  it('rejects incomplete and rate-limited results and disables unconfigured lookups', async () => {
    const provider = vi.fn()
      .mockResolvedValueOnce(Response.json({ prices: [{ day: '2026-12-18', avgPriceUsd: 120 }] }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    const lodging = createLodgingHandler(provider, clock);
    const request = lookup('Miami', '2026-12-18', '2026-12-20');
    expect((await lodging(request)).status).toBe(503);
    expect((await lodging(lookup('Unknown city', '2026-12-18', '2026-12-20'), 'fixture-key')).status).toBe(400);
    expect(provider).not.toHaveBeenCalled();
    expect((await lodging(request, 'fixture-key', true)).status).toBe(404);
    expect((await lodging(request, 'fixture-key', true)).status).toBe(429);
  });
});
