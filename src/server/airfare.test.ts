import { expect, it, vi } from 'vitest';
import { createAirfareHandler } from './airfare';
import { airfareAirports } from '../airfare';
import type { AirfareOption } from '../airfare';
import { ORIGINS } from '../data/origins';
import { rankCities, scoreCities } from '../scoring';
import type { TripPriceEstimate } from '../types';

const clock = () => Date.parse('2026-11-17T22:00:00Z');
const boston = ORIGINS.find(city => city.name === 'Boston')!;

function journey(from: string, to: string, fare: number, minutes: number, kind: 'nonstop' | 'connection' | 'technical') {
  const outbound = { direction: 'OUTBOUND', originCode: from, destinationCode: to, stopCount: Number(kind === 'technical') };
  return {
    segments: [
      ...(kind === 'connection' ? [{ ...outbound, destinationCode: 'ATL' }, { ...outbound, originCode: 'ATL' }] : [outbound]),
      { direction: 'INBOUND', originCode: to, destinationCode: from, stopCount: 0 },
    ],
    legDurations: [
      { direction: 'OUTBOUND', duration: { minutes } },
      { direction: 'INBOUND', duration: { minutes } },
    ],
    offers: [{ pricing: { display: { total: fare, currency: 'USD' } } }],
  };
}

it.each([
  ['2026-12-18', '2026-12-20', 'Miami', 'MIA', 380, 225, 830, 'Mexico City'],
  ['2026-12-20', '2027-01-03', 'Lima', 'LIM', 620, 85, 1810, 'Tenerife'],
] as const)('looks up and applies a Boston round trip for %s through %s', async (start, end, city, airport, fare, lodging, total, first) => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [
    { journeys: [journey('BOS', airport, fare, 250, 'connection'), journey('BOS', airport, fare + 150, 170, 'nonstop')] },
    { journeys: [journey('BOS', airport, fare + 10, 190, 'technical'), journey('BOS', airport, fare + 120, 205, 'nonstop')] },
  ] }));
  const handler = createAirfareHandler(fetcher, clock);
  const lookup = (nonstop: boolean) => handler(new Request(`https://site.test/api/airfare-estimate?${new URLSearchParams({ origin: 'Boston', city, start, end, nonstop: String(nonstop) })}`), 'fixture');

  const regular = await lookup(false);
  expect(regular.status).toBe(200);
  const { options } = await regular.json() as { options: AirfareOption[] };
  expect(options).toEqual([
    { kind: 'lowest', total: fare, minutes: 500, outboundStops: 1, returnStops: 0 },
    { kind: 'shortest', total: fare + 150, minutes: 340, outboundStops: 0, returnStops: 0 },
  ]);
  const nonstopResult = await (await lookup(true)).json();
  expect(nonstopResult.options.map((item: AirfareOption) => [item.kind, item.total, item.outboundStops, item.returnStops]))
    .toEqual([['lowest', fare + 120, 0, 0], ['shortest', fare + 150, 0, 0]]);
  const request = JSON.parse(String(fetcher.mock.lastCall?.[1]?.body));
  expect(request).toMatchObject({
    legs: [
      { origin: 'BOS', destination: airport, date: start, direction: 'OUTBOUND' },
      { origin: airport, destination: 'BOS', date: end, direction: 'INBOUND' },
    ],
    filters: { maxStops: 0 }, currency: 'USD', adults: 1,
  });

  const trip = { start, end };
  const prices = new Map<string, TripPriceEstimate>([[city, { airfare: options[0].total, airfareSource: 'nuitee' }]]);
  const score = () => scoreCities(trip, boston, undefined, undefined, false, undefined, prices);
  expect(score().find(item => item.city.name === city)?.score).toBe(scoreCities(trip, boston).find(item => item.city.name === city)?.score);
  prices.set(city, { ...prices.get(city), nightlyLodging: lodging });
  prices.set('Mexico City', { airfare: 330, nightlyLodging: 75 });
  const ranked = rankCities(score());
  expect(ranked.find(item => item.city.name === city)?.tripCost).toMatchObject({ total, airfareSource: 'nuitee' });
  expect(ranked[0].city.name).toBe(first);
});

it('handles another origin, empty results, and unavailable provider access', async () => {
  expect(airfareAirports('London', 'Miami', false)).toEqual({ from: 'LHR', to: 'MIA' });
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: [{ journeys: [journey('LHR', 'MIA', 100, 300, 'technical')] }] }))
    .mockResolvedValueOnce(new Response(null, { status: 429 }));
  const handler = createAirfareHandler(fetcher, clock);
  const request = new Request('https://site.test/api/airfare-estimate?origin=London&city=Miami&start=2026-12-18&end=2026-12-20&nonstop=true');
  expect((await handler(request)).status).toBe(503);
  expect((await handler(request, 'fixture')).status).toBe(404);
  expect((await handler(request, 'fixture')).status).toBe(429);
});

it('recognizes a confirmed nonstop outside the displayed offers and requires evidence on both legs', async () => {
  const cheap = journey('BOS', 'LIM', 400, 300, 'connection');
  const fast = journey('BOS', 'LIM', 900, 200, 'technical');
  const direct = journey('BOS', 'LIM', 700, 250, 'nonstop');
  const handler = createAirfareHandler(async () => Response.json({ data: [{ journeys: [cheap, fast, direct] }] }), clock);
  const request = new Request('https://site.test/api/airfare-estimate?origin=Boston&city=Lima&start=2026-12-20&end=2027-01-03');
  const first = await (await handler(request, 'fixture')).json();
  expect(first.options.map((option: AirfareOption) => option.total)).toEqual([400, 900]);
  expect(first.nonstopValidUntil).toBeGreaterThan(clock());
  direct.segments[1].stopCount = 1;
  expect((await (await handler(request, 'fixture')).json()).nonstopValidUntil).toBe(0);
  Reflect.deleteProperty(direct.segments[1], 'stopCount');
  expect((await (await handler(request, 'fixture')).json()).nonstopValidUntil).toBe(0);
});
