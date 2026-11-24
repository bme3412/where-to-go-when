import { AIRFARE_ENDPOINT, airfareAirports, type AirfareOption } from './airfare';
import { LODGING_ENDPOINT, lodgingCountryCode, type LodgingQuote } from './lodging';
import { tripPrice } from './format';
import type { Trip } from './types';

interface Estimate { text: string; until: number }
interface Lookup { url: string; read: (data: unknown) => Estimate }
const cache = new Map<string, Estimate>();
const fareStorageKey = 'recent-airfares-v1';
const recentFares = new Map<string, Estimate>();
try {
  const saved = JSON.parse(localStorage.getItem(fareStorageKey) ?? '[]');
  for (const [url, fare] of saved) {
    if (typeof url === 'string' && url.startsWith(AIRFARE_ENDPOINT + '?') &&
        typeof fare?.text === 'string' && /^\$[\d,]+$/.test(fare.text) &&
        Number.isFinite(fare.until) && fare.until > Date.now()) {
      recentFares.set(url, fare);
      cache.set(url, fare);
    }
  }
} catch { /* Storage can be unavailable in private browsing. */ }

function saveFare(url: string, fare: Estimate) {
  recentFares.set(url, fare);
  for (const [key, entry] of recentFares) {
    if (entry.until <= Date.now() || recentFares.size > 100) recentFares.delete(key);
  }
  try { localStorage.setItem(fareStorageKey, JSON.stringify([...recentFares])); } catch { /* Memory cache still works. */ }
}

let lastScroll = 0;
export function pricesScrolled() {
  lastScroll = Date.now();
  schedule();
}
const priceNames = { 'Round trip': 'Airfare', Stay: 'Lodging' } as const;
type PriceLabel = keyof typeof priceNames;
interface Task { lookup: Lookup; item: HTMLElement; label: PriceLabel; settled?: boolean }
const visible = new Set<HTMLElement>();
const firstSeen = new WeakMap<HTMLElement, number>();
const tasks = new Map<HTMLElement, Task[]>();
interface Lane { starts: number[]; pause: number; active: Set<string>; unavailableUntil?: number }
const lanes = new Map<string, Lane>();
// Retry transient failures once promptly, then return to the normal cooldown.
const fareLimitedUntil = new Map<string, number>();
const retryAt = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(pump, 50);
}

function showStatus(item: HTMLElement, text: string, title = '') {
  if (item.textContent !== text) item.textContent = text;
  item.title = title;
}

function rateLimitDelay(response: Response): number {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value) return 60_000;
  const delay = /^\d+$/.test(value) ? Number(value) * 1_000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(1_000, delay) : 60_000;
}

function pump() {
  let next = Infinity;
  const now = Date.now();
  // A visible fare that has already waited for the provider gets the next free slot.
  const due = (card: HTMLElement) => (tasks.get(card) ?? []).some(t => (retryAt.get(t.lookup.url) ?? Infinity) <= now);
  // Start with the first fully visible destination where the reader stopped.
  function position(card: HTMLElement) {
    const row = card.parentElement;
    if (!row) return 0;
    const top = row.getBoundingClientRect().top - Math.max(0, row.closest('.panel-scroll')?.getBoundingClientRect().top ?? 0);
    return top >= -2 ? top : Infinity;
  }
  const cards = [...visible].sort((a, b) => position(a) - position(b) || Number(due(b)) - Number(due(a)));
  for (const container of cards) {
    for (const task of tasks.get(container) ?? []) {
      const { lookup, item, label } = task;
      const name = priceNames[label];
      const url = lookup.url;
      const entry = cache.get(url);
      if (entry && entry.until > now) {
        if (entry.text === 'no estimate') showStatus(item, `No ${name.toLowerCase()} estimate`);
        else if (entry.text === 'unavailable') showStatus(item, `${name} temporarily unavailable`);
        else showStatus(item, `${label} ${entry.text}`, 'Nuitée estimate in USD');
        task.settled = entry.text !== 'unavailable';
        next = Math.min(next, entry.until);
        continue;
      }
      if (task.settled) {
        showStatus(item, `${name} estimate expired`);
        continue;
      }
      const fare = label === 'Round trip';
      const dwell = fare && container !== cards[0] ? 1000 : 150;
      const stableAt = Math.max(firstSeen.get(container) ?? now, fare ? lastScroll : 0) + dwell;
      if (stableAt > now) {
        next = Math.min(next, stableAt);
        continue;
      }
      const endpoint = fare ? AIRFARE_ENDPOINT : LODGING_ENDPOINT;
      const lane: Lane = lanes.get(endpoint) ?? { starts: [], pause: 0, active: new Set() };
      lanes.set(endpoint, lane);
      const unavailableUntil = lane.unavailableUntil ?? 0;
      if (unavailableUntil > now) {
        showStatus(item, `${name} service unavailable`);
        next = Math.min(next, unavailableUntil);
        continue;
      }
      // Let the stopped-on card reach the CDN even when background requests are queued.
      // The server still rate-limits provider lookups on a CDN miss.
      const focused = fare && container === cards[0];
      if (lane.active.has(url)) continue;
      const retry = retryAt.get(url);
      if (retry !== undefined && retry > now) {
        showStatus(item, `Retrying ${name.toLowerCase()}…`);
        next = Math.min(next, retry);
        continue;
      }
      lane.starts = lane.starts.filter(start => start + 3_600_000 > now);
      // Keep the last minute slot open for a visible lookup waiting to retry.
      const reserve = retry === undefined && ((fare && lane.active.size > 0) ||
        cards.some(card => tasks.get(card)?.some(t => t.label === label && retryAt.has(t.lookup.url))));
      const ready = focused ? (fareLimitedUntil.get(url) ?? 0) : Math.max(lane.pause, (lane.starts.at(reserve ? -4 : -5) ?? 0) + 60_000, (lane.starts.at(-15) ?? 0) + 3_600_000);
      if (ready > now) {
        showStatus(item, `${name} busy · will retry`, 'Price lookup limit. Next attempt after ' + new Date(ready).toLocaleTimeString());
        next = Math.min(next, ready);
        continue;
      }
      if (lane.active.size >= (focused ? 3 : fare ? 2 : 1)) continue;
      showStatus(item, `Checking ${name.toLowerCase()}…`);
      lane.active.add(url);
      lane.starts.push(now);
      void (async () => {
        try {
          // Live first-offer streams can take 30s including edge processing.
          // Keep the original request alive long enough to receive that quote.
          const response = await fetch(url, { signal: AbortSignal.timeout(fare ? 45_000 : 18_000) });
          if (response.status === 429) {
            const until = Date.now() + rateLimitDelay(response);
            lane.pause = Math.max(lane.pause, until);
            if (fare) fareLimitedUntil.set(url, until);
          } else if (response.status === 503 || (response.ok && response.headers.get('Content-Type')?.includes('text/html'))) {
            // An unconfigured service or a static preview's HTML fallback affects every card.
            retryAt.delete(url);
            lane.unavailableUntil = Date.now() + 300_000;
          } else if (response.status === 404 || response.status === 400) {
            retryAt.delete(url);
            cache.set(url, { text: 'no estimate', until: Date.now() + 300_000 });
          } else if (response.ok) {
            const estimate = lookup.read(await response.json());
            cache.set(url, estimate);
            if (fare) saveFare(url, estimate);
            retryAt.delete(url);
          }
          else throw new Error('Unavailable');
        } catch {
          if (retry === undefined) retryAt.set(url, Date.now() + 1_500);
          else {
            retryAt.delete(url);
            cache.set(url, { text: 'unavailable', until: Date.now() + 60_000 });
          }
        } finally {
          lane.active.delete(url);
          schedule();
        }
      })();
    }
  }
  if (Number.isFinite(next)) timer = setTimeout(pump, Math.min(2_147_483_647, Math.max(50, next - Date.now())));
}

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const container = entry.target as HTMLElement;
    if (entry.isIntersecting && tasks.has(container)) {
      if (!visible.has(container)) firstSeen.set(container, Date.now());
      visible.add(container);
    }
    else {
      visible.delete(container);
      for (const task of tasks.get(container) ?? []) task.settled = false;
    }
  }
  schedule();
});

export function resetCardPrices() {
  for (const [url, until] of fareLimitedUntil) if (until <= Date.now()) fareLimitedUntil.delete(url);
  observer.disconnect();
  visible.clear();
  tasks.clear();
  clearTimeout(timer);
  for (const [url, estimate] of cache) if (estimate.until <= Date.now()) cache.delete(url);
}

export function observeCardPrices(container: HTMLElement, origin: string, city: string, trip: Trip, flight: boolean, nonstop: boolean) {
  const start = Date.parse(trip.start), end = Date.parse(trip.end);
  const day = 86_400_000;
  const nights = (end - start) / day;
  const today = Math.floor(Date.now() / day) * day;
  const fareLimit = new Date(today);
  fareLimit.setUTCMonth(fareLimit.getUTCMonth() + 11);
  if (fareLimit.getUTCDate() < new Date(today).getUTCDate()) fareLimit.setUTCDate(0);
  const parts: { label: PriceLabel; lookup: Lookup }[] = [];
  if (start >= today && end <= +fareLimit && flight && airfareAirports(origin, city, nonstop)) {
    const params = new URLSearchParams({ origin, city, ...trip, nonstop: String(nonstop), view: 'first' });
    parts.push({ label: 'Round trip', lookup: { url: AIRFARE_ENDPOINT + '?' + params, read(data) {
      const { options, validUntil } = data as { options: AirfareOption[]; validUntil?: number };
      const fare = options.filter(o => Number.isFinite(o.total) && o.total > 0 &&
        (!nonstop || (o.outboundStops === 0 && o.returnStops === 0)) &&
        (!o.expiresAt || Date.parse(o.expiresAt) > Date.now())).sort((a,b) => a.total-b.total)[0];
      if (!fare) throw new Error('Missing fare');
      return { text: tripPrice(fare.total), until: Math.min(validUntil ?? Infinity, Date.now()+900_000, fare.expiresAt ? Date.parse(fare.expiresAt) : Infinity) };
    } } });
  }
  if (start >= today && end <= today + 365 * day && nights >= 1 && nights <= 30 && lodgingCountryCode(city)) {
    const params = new URLSearchParams({ city, checkin: trip.start, checkout: trip.end });
    parts.push({ label: 'Stay', lookup: { url: LODGING_ENDPOINT + '?' + params, read(data) {
      const quote = data as LodgingQuote;
      if (quote.nights !== nights || !Number.isFinite(quote.total) || quote.total <= 0) throw new Error('Missing lodging');
      return { text: tripPrice(quote.total) + ' / ' + nights + (nights === 1 ? ' night' : ' nights'), until: Date.now()+300_000 };
    } } });
  }
  container.replaceChildren();
  if (!parts.length) { container.textContent = 'No price lookup for this trip'; return; }
  tasks.set(container, parts.map(({ label, lookup }) => {
    const item = document.createElement('span');
    item.textContent = `Checking ${priceNames[label].toLowerCase()}…`;
    container.append(item);
    return { label, lookup, item };
  }));
  observer.observe(container);
}
