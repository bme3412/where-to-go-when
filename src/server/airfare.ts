import { airfareAirports } from '../airfare';
import type { AirfareOption } from '../airfare';

type Direction = 'OUTBOUND' | 'INBOUND';
interface Segment { direction: Direction; originCode: string; destinationCode: string; stopCount?: number; stops?: unknown[] }
interface Journey {
  segments?: Segment[];
  legDurations?: { direction: Direction; duration?: { minutes?: number } }[];
  offers?: { expiration?: string; pricing?: { display?: { total?: number; currency?: string } } }[];
}

function optionsFrom(body: unknown, from: string, to: string, nonstop: boolean, now: number) {
  const data = (body as { data?: { journeys?: Journey[] }[] } | null)?.data;
  let nonstopValidUntil = 0;
  const candidates: Omit<AirfareOption, 'kind'>[] = [];
  for (const batch of Array.isArray(data) ? data : []) {
    for (const journey of Array.isArray(batch?.journeys) ? batch.journeys : []) {
      if (!Array.isArray(journey?.segments) || !Array.isArray(journey.legDurations) || !Array.isArray(journey.offers)) continue;
      const leg = (direction: Direction, origin: string, destination: string) => {
        const segments = journey.segments!.filter(segment => segment?.direction === direction);
        if (segments[0]?.originCode !== origin || segments.at(-1)?.destinationCode !== destination) return;
        const knownStops = segments.every(segment => (Number.isInteger(segment.stopCount) && segment.stopCount! >= 0) || Array.isArray(segment.stops));
        if (nonstop && !knownStops) return;
        const stops = segments.length - 1 + segments.reduce((count, segment) =>
          count + (Number.isInteger(segment.stopCount) && segment.stopCount! >= 0 ? segment.stopCount! : segment.stops?.length ?? 0), 0);
        const minutes = journey.legDurations!.find(item => item?.direction === direction)?.duration?.minutes;
        if (typeof minutes === 'number' && Number.isInteger(minutes) && minutes > 0) return { stops, minutes, knownStops };
      };
      const outbound = leg('OUTBOUND', from, to), inbound = leg('INBOUND', to, from);
      if (!outbound || !inbound || (nonstop && (outbound.stops || inbound.stops))) continue;
      for (const offer of journey.offers) {
        const price = offer?.pricing?.display;
        if (price?.currency !== 'USD' || typeof price.total !== 'number' || !Number.isFinite(price.total) || price.total <= 0) continue;
        const expiry = offer.expiration ? Date.parse(offer.expiration) : NaN;
        if (Number.isFinite(expiry) && expiry <= now) continue;
        if (outbound.knownStops && inbound.knownStops && outbound.stops === 0 && inbound.stops === 0) {
          nonstopValidUntil = Math.max(nonstopValidUntil, Math.min(Number.isFinite(expiry) ? expiry : Infinity, now + 600_000));
        }
        candidates.push({ total: price.total, minutes: outbound.minutes + inbound.minutes, outboundStops: outbound.stops,
          returnStops: inbound.stops, expiresAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : undefined });
      }
    }
  }
  const lowest = [...candidates].sort((a, b) => a.total - b.total || a.minutes - b.minutes)[0];
  const shortest = candidates.sort((a, b) => a.minutes - b.minutes || a.total - b.total)[0];
  if (!lowest || !shortest) return { options: [], nonstopValidUntil };
  const options: AirfareOption[] = lowest === shortest
    ? [{ ...lowest, kind: 'both' }]
    : [{ ...lowest, kind: 'lowest' }, { ...shortest, kind: 'shortest' }];
  return { options, nonstopValidUntil };
}

// Card estimates can use the first provider batch containing a valid round trip.
async function firstAvailable(response: Response, from: string, to: string, nonstop: boolean, now: () => number) {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += value ?? '';
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = done ? '' : frames.pop()!;
      for (const frame of frames) {
        const text = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!text || text === '[DONE]') continue;
        const event = JSON.parse(text);
        if (event.error || /^event: *error$/m.test(frame)) throw new Error('Provider search failed');
        const batch = event.data ?? event;
        const result = optionsFrom({ data: Array.isArray(batch) ? batch : [batch] }, from, to, nonstop, now());
        if (result.options.length) return result;
      }
      if (done) return { options: [], nonstopValidUntil: 0 };
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export function createAirfareHandler(provider: typeof fetch = fetch, now = Date.now) {
  let requests: number[] = [];
  return async (request: Request, apiKey?: string): Promise<Response> => {
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'GET') return json({ error: 'Lookup requires GET.' }, 405);
    if (!apiKey) return json({ error: 'Airfare lookup is unavailable.' }, 503);
    const params = new URL(request.url).searchParams;
    const first = params.get('view') === 'first';
    const nonstop = params.get('nonstop') === 'true';
    const airports = airfareAirports(params.get('origin') ?? '', params.get('city') ?? '', nonstop);
    const start = params.get('start') ?? '', end = params.get('end') ?? '';
    const date = (value: string) => {
      const parsed = new Date(value);
      return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value ? +parsed : NaN;
    };
    const time = now();
    const today = new Date(time);
    today.setUTCHours(0, 0, 0, 0);
    const limit = new Date(today);
    limit.setUTCMonth(limit.getUTCMonth() + 11);
    if (limit.getUTCDate() < today.getUTCDate()) limit.setUTCDate(0);
    if (!airports || !(date(start) >= +today && date(end) >= date(start) && date(end) <= +limit)) {
      return json({ error: 'Choose a mapped flight route and dates within 11 months.' }, 400);
    }
    requests = requests.filter(timestamp => timestamp > time - 3_600_000);
    if (requests.length >= 15 || requests.filter(timestamp => timestamp > time - 60_000).length >= 5) {
      return json({ error: 'Too many airfare lookups.' }, 429);
    }
    requests.push(time);
    const { from, to } = airports;
    try {
      const response = await provider('https://api.liteapi.travel/v3.0/flights/rates', {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', Accept: first ? 'text/event-stream' : 'application/json' },
        body: JSON.stringify({
          legs: [
            { origin: from, destination: to, date: start, direction: 'OUTBOUND' },
            { origin: to, destination: from, date: end, direction: 'INBOUND' },
          ],
          adults: 1, currency: 'USD', country: 'US', cabinClass: 'ECONOMY',
          ...(nonstop ? { filters: { maxStops: 0 } } : {}),
        }),
        signal: AbortSignal.timeout(22_000),
      });
      if (response.status === 429) return json({ error: 'Too many airfare lookups.' }, 429);
      if (!response.ok) return json({ error: 'Airfare lookup is unavailable.' }, 502);
      const { options, nonstopValidUntil } = first && response.headers.get('Content-Type')?.includes('text/event-stream')
        ? await firstAvailable(response, from, to, nonstop, now)
        : optionsFrom(await response.json(), from, to, nonstop, now());
      if (!options.length) return json({ error: 'No matching round-trip fares found.' }, 404);
      const quotedAt = now();
      const validUntil = Math.min(quotedAt + 900_000, ...options.map(option =>
        option.expiresAt ? Date.parse(option.expiresAt) : Infinity));
      const result = json({ from, to, options, nonstopValidUntil, validUntil });
      result.headers.set('Server-Timing', 'fare;dur=' + (quotedAt - time) + ';desc="' + (response.headers.get('Content-Type')?.includes('text/event-stream') ? 'stream' : 'json') + '"');
      // Public estimates vary by the full query string. Only Vercel may share them.
      result.headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=' + Math.max(0, Math.floor((validUntil - quotedAt) / 1000)));
      return result;
    } catch {
      return json({ error: 'Airfare lookup is unavailable.' }, 502);
    }
  };
}
