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
interface Task { lookup: Lookup; item: HTMLElement; label: string; settled?: boolean }
const visible = new Set<HTMLElement>();
const firstSeen = new WeakMap<HTMLElement, number>();
const tasks = new Map<HTMLElement, Task[]>();
interface Lane { starts: number[]; pause: number; active: Set<string> }
const lanes = new Map<string, Lane>();
// Retry a transient fare failure once promptly, then return to the normal cooldown.
const fareLimitedUntil = new Map<string, number>();
const retryAt = new Map<string, number>();
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(pump, 50);
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
      const url = lookup.url;
      const entry = cache.get(url);
      if (entry && entry.until > now) {
        item.textContent = label + ' ' + entry.text;
        item.title = 'Nuitée estimate in USD';
        task.settled = entry.text !== 'unavailable';
        next = Math.min(next, entry.until);
        continue;
      }
      if (task.settled) {
        item.textContent = label + ' expired';
        continue;
      }
      const fare = url.startsWith(AIRFARE_ENDPOINT + '?');
      const dwell = fare && container !== cards[0] ? 1000 : 150;
      const stableAt = Math.max(firstSeen.get(container) ?? now, fare ? lastScroll : 0) + dwell;
      if (stableAt > now) {
        next = Math.min(next, stableAt);
        continue;
      }
      const endpoint = url.split('?')[0];
      const lane: Lane = lanes.get(endpoint) ?? { starts: [], pause: 0, active: new Set() };
      lanes.set(endpoint, lane);
      // Let the stopped-on card reach the CDN even when background requests are queued.
      // The server still rate-limits provider lookups on a CDN miss.
      const focused = fare && container === cards[0] && !retryAt.has(url);
      if (lane.active.has(url) || lane.active.size >= (focused ? 3 : fare ? 2 : 1)) continue;
      const retry = retryAt.get(url);
      if (retry !== undefined && retry > now) {
        item.textContent = label + ' retrying…';
        next = Math.min(next, retry);
        continue;
      }
      lane.starts = lane.starts.filter(start => start + 3_600_000 > now);
      // Reserve the fifth minute slot while another visible fare could need a retry.
      const reserve = fare && retry === undefined && (lane.active.size > 0 ||
        cards.some(card => tasks.get(card)?.some(t => retryAt.has(t.lookup.url))));
      const ready = focused ? (fareLimitedUntil.get(url) ?? 0) : Math.max(lane.pause, (lane.starts.at(reserve ? -4 : -5) ?? 0) + 60_000, (lane.starts.at(-15) ?? 0) + 3_600_000);
      if (ready > now) {
        item.textContent = label + ' queued';
        item.title = 'Nuitée request limit. Next lookup can start at ' + new Date(ready).toLocaleTimeString();
        next = Math.min(next, ready);
        continue;
      }
      item.textContent = label + ' …';
      lane.active.add(url);
      lane.starts.push(now);
      void (async () => {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(fare ? 26_000 : 18_000) });
          if (response.status === 429) {
            const seconds = Number(response.headers.get('Retry-After'));
            lane.pause = Date.now() + Math.max(60, Number.isFinite(seconds) ? seconds : 0) * 1000;
            if (fare) fareLimitedUntil.set(url, lane.pause);
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
          if (fare && retry === undefined) retryAt.set(url, Date.now() + 1_500);
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
  if (Number.isFinite(next)) timer = setTimeout(pump, Math.max(50, next - Date.now()));
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
  const parts: { label: string; lookup: Lookup }[] = [];
  if (start >= today && end <= +fareLimit && flight && airfareAirports(origin, city, nonstop)) {
    const params = new URLSearchParams({ origin, city, ...trip, nonstop: String(nonstop) });
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
    item.textContent = label + ' …';
    item.title = 'Nuitée estimate in USD';
    container.append(item);
    return { label, lookup, item };
  }));
  observer.observe(container);
}
