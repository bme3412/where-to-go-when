import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('prices visible cards, pauses limited fares, and reuses lodging across origins', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
  let visibility!: (entries: { target: unknown; isIntersecting: boolean }[]) => void;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof visibility) { visibility = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('document', { createElement: () => ({ textContent: '' }) });
  const fetchPrice = vi.fn(async (url: string) => {
    if (url.includes('lodging')) return Response.json({ nights: 14, total: 1703 });
    if (fetchPrice.mock.calls.length === 1) return new Response(null, { status: 429 });
    return Response.json({ options: [{ total: url.includes('London') ? 1190 : 1323 }] });
  });
  vi.stubGlobal('fetch', fetchPrice);
  const { observeCardPrices, resetCardPrices } = await import('./card-prices');
  const trip = { start: '2026-12-20', end: '2027-01-03' };
  const items: { textContent: string }[] = [];
  const card = { replaceChildren() { items.length = 0; }, append(item: typeof items[number]) { items.push(item); } } as unknown as HTMLElement;
  const show = () => visibility([{ target: card, isIntersecting: true }]);
  observeCardPrices(card, 'Boston', 'Phuket', trip, true, false);
  await vi.advanceTimersByTimeAsync(100);
  expect(fetchPrice).not.toHaveBeenCalled();
  show();
  await vi.advanceTimersByTimeAsync(150);
  expect(items.map(i => i.textContent)).toEqual(['Round trip queued', 'Stay $1,703 / 14 nights']);
  visibility([{ target: card, isIntersecting: false }]);
  await vi.advanceTimersByTimeAsync(61_000);
  expect(fetchPrice).toHaveBeenCalledTimes(2);
  show();
  await vi.advanceTimersByTimeAsync(150);
  expect(items[0].textContent).toBe('Round trip $1,323');
  resetCardPrices();
  observeCardPrices(card, 'London', 'Phuket', trip, true, false);
  show();
  await vi.advanceTimersByTimeAsync(150);
  expect(items.map(i => i.textContent)).toEqual(['Round trip $1,190', 'Stay $1,703 / 14 nights']);
  expect(fetchPrice.mock.calls.filter(([url]) => url.includes('lodging'))).toHaveLength(1);
  resetCardPrices();
});
