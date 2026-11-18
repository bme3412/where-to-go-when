import { AIRFARE_ENDPOINT, airfareAirports, type AirfareOption } from './airfare';
import { LODGING_ENDPOINT, lodgingCountryCode, type LodgingQuote } from './lodging';
import { tripPrice } from './format';
import type { Trip } from './types';

interface Estimate { text: string; until: number }
interface Lookup { url: string; read: (data: unknown) => Estimate }
const cache = new Map<string, Promise<Estimate>>();

function estimate(lookup: Lookup): Promise<Estimate> {
  const existing = cache.get(lookup.url);
  if (existing) return existing.then(value => {
    if (value.until > Date.now()) return value;
    if (cache.get(lookup.url) === existing) cache.delete(lookup.url);
    return estimate(lookup);
  });
  const pending = (async () => {
    try {
      const response = await fetch(lookup.url, { signal: AbortSignal.timeout(18_000) });
      if (response.ok) return lookup.read(await response.json());
      if (response.status === 429) return { text: 'rate limited', until: Date.now() + 60_000 };
    } catch { /* A failed component leaves the other estimate visible. */ }
    return { text: 'unavailable', until: Date.now() + 15_000 };
  })();
  cache.set(lookup.url, pending);
  return pending;
}

export function showCardPrices(container: HTMLElement, origin: string, city: string, trip: Trip, flight: boolean, nonstop: boolean) {
  const nights = (Date.parse(trip.end) - Date.parse(trip.start)) / 86_400_000;
  const parts: { label: string; lookup: Lookup }[] = [];
  if (flight && airfareAirports(origin, city, nonstop)) {
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
  if (nights >= 1 && nights <= 30 && lodgingCountryCode(city)) {
    const params = new URLSearchParams({ city, checkin: trip.start, checkout: trip.end });
    parts.push({ label: 'Stay', lookup: { url: LODGING_ENDPOINT + '?' + params, read(data) {
      const quote = data as LodgingQuote;
      if (quote.nights !== nights || !Number.isFinite(quote.total) || quote.total <= 0) throw new Error('Missing lodging');
      return { text: tripPrice(quote.total) + ' / ' + nights + (nights === 1 ? ' night' : ' nights'), until: Date.now()+300_000 };
    } } });
  }
  container.replaceChildren();
  if (!parts.length) { container.textContent = 'No price lookup for this trip'; return; }
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Refresh';
  button.setAttribute('aria-label', 'Refresh estimates for ' + city);
  button.disabled = true;
  button.onclick = () => {
    for (const { lookup } of parts) cache.delete(lookup.url);
    showCardPrices(container, origin, city, trip, flight, nonstop);
  };
  const pending = parts.map(async ({ label, lookup }) => {
    const item = document.createElement('span');
    item.textContent = label + ' …';
    container.append(item);
    const value = await estimate(lookup);
    item.textContent = label + ' ' + value.text;
    item.title = 'Nuitée estimate in USD';
  });
  container.append(button);
  void Promise.all(pending).then(() => { button.disabled = false; });
}
