import { AIRFARE_ENDPOINT, airfareAirports, type AirfareOption } from './airfare';
import { LODGING_ENDPOINT, lodgingCountryCode, type LodgingQuote } from './lodging';
import { tripPrice } from './format';
import type { Trip } from './types';

interface Estimate { text: string; until: number }
interface Lookup { url: string; read: (data: unknown) => Estimate }
const cache = new Map<string, Estimate>();
interface Task { lookup: Lookup; item: HTMLElement; label: string; settled?: boolean }
const visible = new Set<HTMLElement>();
const tasks = new Map<HTMLElement, Task[]>();
const lanes = new Map<string, { starts: number[]; pause: number; busy: boolean }>();
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(pump, 50);
}

function pump() {
  let next = Infinity;
  const now = Date.now();
  for (const container of visible) {
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
      const endpoint = url.split('?')[0];
      const lane = lanes.get(endpoint) ?? { starts: [], pause: 0, busy: false };
      lanes.set(endpoint, lane);
      if (lane.busy) continue;
      lane.starts = lane.starts.filter(start => start + 3_600_000 > now);
      const ready = Math.max(lane.pause, (lane.starts.at(-5) ?? 0) + 60_000, (lane.starts.at(-15) ?? 0) + 3_600_000);
      if (ready > now) {
        item.textContent = label + ' queued';
        item.title = 'Nuitée request limit. Next lookup can start at ' + new Date(ready).toLocaleTimeString();
        next = Math.min(next, ready);
        continue;
      }
      item.textContent = label + ' …';
      lane.busy = true;
      lane.starts.push(now);
      void (async () => {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(18_000) });
          if (response.status === 429) {
            const seconds = Number(response.headers.get('Retry-After'));
            lane.pause = Date.now() + Math.max(60, Number.isFinite(seconds) ? seconds : 0) * 1000;
          } else if (response.status === 404 || response.status === 400) {
            cache.set(url, { text: 'no estimate', until: Date.now() + 300_000 });
          } else if (response.ok) cache.set(url, lookup.read(await response.json()));
          else throw new Error('Unavailable');
        } catch {
          cache.set(url, { text: 'unavailable', until: Date.now() + 60_000 });
        } finally {
          lane.busy = false;
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
    if (entry.isIntersecting && tasks.has(container)) visible.add(container);
    else {
      visible.delete(container);
      for (const task of tasks.get(container) ?? []) task.settled = false;
    }
  }
  schedule();
});

export function resetCardPrices() {
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
      const { options } = data as { options: AirfareOption[] };
      const fare = options.filter(o => Number.isFinite(o.total) && o.total > 0 &&
        (!nonstop || (o.outboundStops === 0 && o.returnStops === 0)) &&
        (!o.expiresAt || Date.parse(o.expiresAt) > Date.now())).sort((a,b) => a.total-b.total)[0];
      if (!fare) throw new Error('Missing fare');
      return { text: tripPrice(fare.total), until: Math.min(Date.now()+300_000, fare.expiresAt ? Date.parse(fare.expiresAt) : Infinity) };
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
