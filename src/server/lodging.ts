import { lodgingCountryCode } from '../lodging';
import type { LodgingQuote } from '../lodging';

const DAY = 86_400_000;
const HOUR = 3_600_000;

function dateValue(value: string): number {
  const day = Date.parse(value);
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value ? day : NaN;
}

export function createLodgingHandler(provider: typeof fetch = fetch, now = Date.now) {
  const cache = new Map<string, { expires: number; quote: Promise<LodgingQuote | null> }>();
  let requestTimes: number[] = [];

  return async (request: Request, apiKey?: string, cacheAllowed = false): Promise<Response> => {
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'GET') return json({ error: 'Lookup requires GET.' }, 405);
    if (!apiKey) return json({ error: 'Nuitée lodging estimates are currently unavailable.' }, 503);
    const { searchParams } = new URL(request.url);
    const city = searchParams.get('city') ?? '';
    const countryCode = lodgingCountryCode(city);
    const checkin = searchParams.get('checkin') ?? '';
    const checkout = searchParams.get('checkout') ?? '';
    const start = dateValue(checkin), end = dateValue(checkout);
    const time = now();
    const today = Math.floor(time / DAY) * DAY;
    const nights = (end - start) / DAY;
    if (!countryCode || !(start >= today && end <= today + 365 * DAY && nights >= 1 && nights <= 30)) {
      return json({ error: 'Lodging lookup supports future stays of 1–30 nights at supported destinations, within the next year.' }, 400);
    }

    const key = JSON.stringify([city, checkin, checkout]);
    let entry = cache.get(key);
    if (!entry || entry.expires <= time) {
      requestTimes = requestTimes.filter(timestamp => timestamp > time - HOUR);
      if (requestTimes.length >= 15 || requestTimes.filter(timestamp => timestamp > time - 60_000).length >= 5) {
        return json({ error: 'Too many lodging lookups. Try again later.' }, 429);
      }
      requestTimes.push(time);
      const lastNight = new Date(end - DAY).toISOString().slice(0, 10);
      const params = new URLSearchParams({ cityName: city, countryCode, fromDate: checkin, toDate: lastNight });
      const quote = (async (): Promise<LodgingQuote | null> => {
        const response = await provider(`https://api.liteapi.travel/v3.0/prices/city?${params}`, {
          headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (response.status === 429) throw new RangeError('rate limited');
        if (!response.ok) throw new Error('provider unavailable');
        const body = await response.json() as { prices?: { day?: string; avgPriceUsd?: number }[] } | null;
        if (!Array.isArray(body?.prices)) return null;
        const prices = new Map<string, number>();
        for (const row of body.prices) {
          if (typeof row?.day === 'string' && typeof row.avgPriceUsd === 'number'
            && Number.isFinite(row.avgPriceUsd) && row.avgPriceUsd > 0) prices.set(row.day, row.avgPriceUsd);
        }
        let total = 0;
        for (let day = start; day < end; day += DAY) {
          const price = prices.get(new Date(day).toISOString().slice(0, 10));
          if (price === undefined) return null;
          total += price;
        }
        if (!Number.isFinite(total)) return null;
        return { total, nights, nightlyAverage: total / nights, retrievedAt: new Date(now()).toISOString() };
      })();
      entry = { expires: time + HOUR, quote };
      cache.set(key, entry);
      for (const [otherKey, other] of cache) if (other.expires <= time) cache.delete(otherKey);
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
    }

    try {
      const quote = await entry.quote;
      if ((!quote || !cacheAllowed) && cache.get(key) === entry) cache.delete(key);
      return quote ? json(quote) : json({ error: 'Nuitée has no complete estimate for these dates.' }, 404);
    } catch (error) {
      if (cache.get(key) === entry) cache.delete(key);
      return error instanceof RangeError
        ? json({ error: 'Nuitée is rate-limiting lookups. Try again later.' }, 429)
        : json({ error: 'Nuitée lodging estimates are currently unavailable.' }, 502);
    }
  };
}
