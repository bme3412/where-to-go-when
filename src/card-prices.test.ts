import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

it.each([429, 502])('lazily prices holiday cards and recovers from HTTP %i', async status => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
  let visibility!: (entries: { target: unknown; isIntersecting: boolean }[]) => void;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof visibility) { visibility = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('document', { createElement: () => ({ textContent: '' }) });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) });
  const fetchPrice = vi.fn(async (url: string) => {
    if (url.includes('lodging')) return Response.json({ nights: 14, total: 1703 });
    if (fetchPrice.mock.calls.length === 1) return new Response(null, { status });
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
  await vi.advanceTimersByTimeAsync(80);
  visibility([{target: card, isIntersecting: false}]);
  await vi.advanceTimersByTimeAsync(200);
  expect(fetchPrice).not.toHaveBeenCalled();
  show();
  await vi.advanceTimersByTimeAsync(300);
  expect(items.map(i => i.textContent)).toEqual([status === 429 ? 'Round trip queued' : 'Round trip retrying…', 'Stay $1,703 / 14 nights']);
  visibility([{ target: card, isIntersecting: false }]);
  await vi.advanceTimersByTimeAsync(status === 429 ? 61_000 : 1500);
  expect(fetchPrice).toHaveBeenCalledTimes(2);
  show();
  await vi.advanceTimersByTimeAsync(300);
  expect(items[0].textContent).toBe('Round trip $1,323');
  resetCardPrices();
  observeCardPrices(card, 'London', 'Phuket', trip, true, false);
  show();
  await vi.advanceTimersByTimeAsync(300);
  expect(items.map(i => i.textContent)).toEqual(['Round trip $1,190', 'Stay $1,703 / 14 nights']);
  expect(fetchPrice.mock.calls.filter(([url]) => url.includes('lodging'))).toHaveLength(1);
  resetCardPrices();
  vi.resetModules();
  const refreshed = await import('./card-prices');
  const airfareCalls = () => fetchPrice.mock.calls.filter(([url]) => url.includes('airfare')).length;
  const beforeReload = airfareCalls();
  refreshed.observeCardPrices(card, 'Boston', 'Phuket', trip, true, false);
  show();
  await vi.advanceTimersByTimeAsync(100);
  expect(items[0].textContent).toBe('Round trip $1,323');
  expect(airfareCalls()).toBe(beforeReload);
  refreshed.resetCardPrices();
});

it('starts the first fully visible fare after scrolling settles', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
  let visibility!: (entries: { target: HTMLElement; isIntersecting: boolean }[]) => void;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof visibility) { visibility = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('document', { createElement: () => ({}) });
  const fetchPrice = vi.fn(async (url: string) => url.includes('lodging')
    ? Response.json({ nights: 14, total: 1703 })
    : url.includes('city=Phuket') ? new Response(null, { status: 429 }) : Response.json({ options: [{ total: 1400 }] }));
  vi.stubGlobal('fetch', fetchPrice);
  const { observeCardPrices, pricesScrolled, resetCardPrices } = await import('./card-prices');
  const cards = [-30, 8, 110].map(top => ({
    replaceChildren() {}, append() {},
    parentElement: { getBoundingClientRect: () => ({ top }), closest: () => null },
  }) as unknown as HTMLElement);
  const cities = ['Miami', 'Phuket', 'Paris'];
  cards.forEach((card, i) => observeCardPrices(card, 'Boston', cities[i], { start: '2026-12-20', end: '2027-01-03' }, true, false));
  visibility(cards.map(target => ({ target, isIntersecting: true })));
  await vi.advanceTimersByTimeAsync(120);
  pricesScrolled();
  const fares = () => fetchPrice.mock.calls.map(([url]) => url).filter(url => url.includes('airfare'));
  await vi.advanceTimersByTimeAsync(100);
  expect(fares()).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(fares()).toHaveLength(1);
  expect(fares()[0]).toContain('city=Phuket');
  // The previous card's rate limit must not delay the next card's CDN hit.
  visibility([{ target: cards[1], isIntersecting: false }]);
  pricesScrolled();
  await vi.advanceTimersByTimeAsync(250);
  expect(fares()).toHaveLength(2);
  expect(fares()[1]).toContain('city=Paris');
  resetCardPrices();
});

it('shows a 30-second first offer on the original request', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
  let show!: (entries: { target: HTMLElement; isIntersecting: boolean }[]) => void;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof show) { show = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('document', { createElement: () => ({}) });
  // Drive the native fetch deadline with the same clock as the delayed response.
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  const fetchPrice = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes('lodging')) return Response.json({ nights: 14, total: 1703 });
    await new Promise<void>((resolve, reject) => {
      setTimeout(resolve, 30_000);
      init.signal!.addEventListener('abort', () => reject(new Error('Timeout')), { once: true });
    });
    return Response.json({ options: [{ total: 1328 }] });
  });
  vi.stubGlobal('fetch', fetchPrice);
  const items: { textContent: string }[] = [];
  const card = { replaceChildren() {}, append(item: typeof items[number]) { items.push(item); } } as unknown as HTMLElement;
  const { observeCardPrices, resetCardPrices } = await import('./card-prices');
  observeCardPrices(card, 'Rome', 'Phuket', { start: '2026-12-20', end: '2027-01-03' }, true, false);
  show([{ target: card, isIntersecting: true }]);
  await vi.advanceTimersByTimeAsync(30_500);
  expect(fetchPrice.mock.calls.filter(([url]) => url.includes('airfare'))).toHaveLength(1);
  expect(items[0].textContent).toBe('Round trip $1,328');
  resetCardPrices();
});
