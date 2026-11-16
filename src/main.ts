import './style.css';
import { ORIGINS } from './data/origins';
import { band, BANDS, cityTooltip, countryTooltip, crowdWord, difference, displayCountry, escapeHtml, hours, rainWord, temperature } from './format';
import { Globe, MAP_COUNTRIES } from './globe';
import { setupPanels } from './panels';
import { clamp, DEFAULT_WEIGHTS, defaultTrip, rankCities, sampleDays, scoreCities, scoreCountry, validateTrip } from './scoring';
import type { CityScore, CountryScore, RankedCity, Trip, Unit, Weights } from './types';

const app = document.querySelector<HTMLElement>('#app')!;
const initialTrip = defaultTrip(new Date());
const weights: Weights = { ...DEFAULT_WEIGHTS };
let home = ORIGINS[0];
let unit: Unit = 'F';
let cityScores: CityScore[] = [];
let ranked: RankedCity[] = [];
let selectedName: string | null = null;
let activeTip = '';
const icon = (content: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
const closeIcon = icon('<path d="m6 6 12 12M18 6 6 18"/>');
const globeIcon = icon('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4.5" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>');
const preferences: { key: keyof Weights; label: string; hint: string; paths: string }[] = [
  { key: 'weather', label: 'Weather fit', hint: 'Comfortably warm', paths: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>' },
  { key: 'dry', label: 'Dry', hint: 'Less rain, more exploring', paths: '<path d="M12 3C10 6 6 10 6 14a6 6 0 0 0 12 0c0-4-4-8-6-11Z"/>' },
  { key: 'crowds', label: 'Few crowds', hint: 'A little room to breathe', paths: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 4 5v2"/>' },
  { key: 'travel', label: 'Short travel', hint: 'More time on vacation', paths: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>' },
];

app.innerHTML = `
  <header class="app-header">
    <div class="brand"><span class="brand-icon">${globeIcon}</span><div><h1>Where to go, and when</h1><p>Your next getaway, in perspective.</p></div></div>
    <nav class="panel-toggles" aria-label="Explore controls">
      <button id="toggle-settings" class="panel-toggle" type="button" aria-controls="settings-panel" aria-expanded="true">${icon('<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>')}<span>Your trip</span></button>
      <button id="toggle-results" class="panel-toggle" type="button" aria-controls="results-panel" aria-expanded="true">${icon('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>')}<span>Your picks</span><span class="count-bubble">17</span></button>
    </nav>
  </header>
  <section id="globe-container" class="workspace" aria-label="Vacation explorer">
    <aside id="settings-panel" class="side-panel settings-panel" aria-labelledby="settings-title">
      <div class="panel-heading"><div><h2 id="settings-title">Make it your trip</h2><p>A few details. A world of options.</p></div><button type="button" class="icon-button close-panel" data-close-panel aria-label="Close trip settings">${closeIcon}</button></div>
      <div class="panel-scroll settings-content">
        <div class="field"><label for="home">Home city</label><select id="home">${ORIGINS.map(origin => `<option value="${escapeHtml(origin.name)}">${escapeHtml(origin.name)}</option>`).join('')}</select></div>
        <div class="date-fields"><div class="field"><label for="start">From</label><input type="date" id="start" value="${initialTrip.start}" aria-describedby="date-error" /></div><div class="field"><label for="end">To</label><input type="date" id="end" value="${initialTrip.end}" aria-describedby="date-error" /></div></div>
        <div class="trip-duration">${icon('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16"/>')}<output id="trip-length" for="start end">15 days</output><span>to get away</span></div>
        <p id="date-error" class="date-error" role="alert" hidden></p>
        <div class="section-divider"></div>
        <div class="preferences-heading"><h3>What matters to you?</h3><p>Turn up the things you care about.</p></div>
        <div class="weights">${preferences.map(({ key, label, hint, paths }) => `<div class="weight"><div class="weight-heading"><label for="weight-${key}">${icon(paths)}${label}</label><output for="weight-${key}" id="value-${key}">${weights[key]}</output></div><input id="weight-${key}" data-weight="${key}" type="range" min="0" max="10" step="1" value="${weights[key]}" aria-describedby="hint-${key}" /><p class="weight-hint" id="hint-${key}">${hint}</p></div>`).join('')}</div>
        <button class="text-button reset-preferences" id="reset-weights" type="button">Reset preferences</button><p class="settings-note">Your picks update as you go.</p>
      </div>
    </aside>
    <section class="globe-stage" aria-label="Interactive destination globe">
      <div class="stage-heading"><div><p class="stage-kicker">Go somewhere good.</p><div class="trip-summary"><span id="summary-origin">From Boston</span><span aria-hidden="true">·</span><span id="summary-dates">Dec 20 – Jan 3</span><span class="summary-duration" id="summary-duration">15 days</span></div><p class="invalid-summary" id="invalid-summary" hidden>Showing your last valid dates</p></div><div class="stage-actions"><button id="spin" class="small-button spin-button" type="button" aria-pressed="true"><span id="spin-icon">${icon('<path d="M9 5v14M15 5v14"/>')}</span><span id="spin-text">Pause spin</span></button><button id="units" class="small-button unit-button" type="button" aria-label="Temperature unit: Fahrenheit. Switch to Celsius."><span class="unit-active">°F</span><span class="unit-divider">/</span><span>°C</span></button></div></div>
      <div class="globe-canvas"><svg id="globe" viewBox="0 0 760 520" tabindex="0" role="group" aria-label="Interactive vacation globe. Use arrow keys to rotate, plus or minus to zoom. Choose a destination to center it."></svg><div class="zoom-controls" aria-label="Globe zoom"><button class="icon-button" id="zoom-in" type="button" aria-label="Zoom in">${icon('<path d="M12 5v14M5 12h14"/>')}</button><button class="icon-button" id="zoom-out" type="button" aria-label="Zoom out">${icon('<path d="M5 12h14"/>')}</button><button class="icon-button reset-view" id="reset-view" type="button" aria-label="Reset globe view">${icon('<path d="M8 4H4v4m12-4h4v4M4 16v4h4m8 0h4v-4"/>')}</button></div></div>
      <div id="selection" class="selection" hidden><span class="selection-dot"></span><div class="selection-copy"><strong id="selected-name"></strong><span id="selected-summary"></span></div><button id="selected-details" class="small-button" type="button">Details ${icon('<path d="m9 5 7 7-7 7"/>')}</button><button id="clear-selection" class="icon-button" type="button" aria-label="Clear selected destination">${closeIcon}</button></div>
      <div class="stage-bottom"><div class="legend" aria-label="Destination rating bands">${BANDS.map(rating => `<span><i class="swatch" style="--swatch:${rating.color}"></i>${rating.label}${rating.minimum ? `<span class="legend-threshold">${rating.minimum}+</span>` : ''}</span>`).join('')}</div><p class="globe-help"><span class="desktop-help">Drag to rotate · Scroll to zoom</span><span class="touch-help">Drag to rotate · Pinch to zoom</span><span class="help-divider">/</span> Numbers mark the top 10</p><p class="map-note">71 destinations, scored for you. Country colors are broader estimates.</p></div>
    </section>
    <aside id="results-panel" class="side-panel results-panel" aria-labelledby="top-title">
      <div class="panel-heading"><div><h2 id="top-title">Your top 5</h2><p id="ranking-context">For 15 days, from Boston</p></div><button type="button" class="icon-button close-panel" data-close-panel aria-label="Close recommendations">${closeIcon}</button></div>
      <div class="panel-scroll results-content"><div id="top-list" class="top-list"></div><div class="more-heading"><h3>More good options</h3><span>6–17</span></div><div id="more-grid" class="more-grid"></div><p class="results-note">A starting point for your next adventure.<br>Choose a place to take a closer look.</p></div>
    </aside>
    <button type="button" id="panel-backdrop" class="panel-backdrop" aria-label="Close open panel" tabindex="-1" hidden></button>
    <div id="tooltip" class="tooltip" role="tooltip" hidden></div>
  </section>
  <footer class="app-footer"><button type="button" class="text-button" id="show-method">${icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>')}How the score works</button><span>Climate averages, not a forecast.</span></footer>
  <p id="rank-announcement" class="sr-only" role="status" aria-live="polite"></p>
  <dialog id="details-dialog" class="detail-dialog" aria-label="Destination details"><button type="button" class="icon-button dialog-close" aria-label="Close destination details">${closeIcon}</button><div id="details-content"></div></dialog>
  <dialog id="method-dialog" class="method-dialog" aria-labelledby="method-title"><button type="button" class="icon-button dialog-close" aria-label="Close scoring explanation">${closeIcon}</button><span class="method-icon">${globeIcon}</span><h2 id="method-title">A little method to the wanderlust.</h2><p>We score 71 destinations for your dates, home city, and trip length. Your preferences decide how much comfortably warm weather, dry days, fewer crowds, and shorter travel matter.</p><p>Weather, rainfall, and crowds combine using a weighted geometric mean, so one poor factor can pull a destination down. Seasonal storms, holiday crowds, and usable days after travel also count. Cold or hot weather at home gives a small boost to more comfortable escapes.</p><p>Climate figures are approximate long-run averages, not forecasts. Flight times estimate distance, airport time, and likely connections. Time zones ignore daylight saving. Lunar holiday dates cover 2025–2029.</p><div class="method-note">Country colors use a broad model. Destination dots use the more detailed city data.</div></dialog>
`;

const start = document.querySelector<HTMLInputElement>('#start')!;
const end = document.querySelector<HTMLInputElement>('#end')!;
const homeSelect = document.querySelector<HTMLSelectElement>('#home')!;
const tooltip = document.querySelector<HTMLDivElement>('#tooltip')!;
const container = document.querySelector<HTMLElement>('#globe-container')!;
const spinButton = document.querySelector<HTMLButtonElement>('#spin')!;
const unitButton = document.querySelector<HTMLButtonElement>('#units')!;
const topList = document.querySelector<HTMLDivElement>('#top-list')!;
const moreGrid = document.querySelector<HTMLDivElement>('#more-grid')!;
const detailsDialog = document.querySelector<HTMLDialogElement>('#details-dialog')!;
const panels = setupPanels(container);

function hideTooltip(): void {
  tooltip.hidden = true; activeTip = '';
  document.querySelectorAll('[aria-describedby="tooltip"]').forEach(element => element.removeAttribute('aria-describedby'));
}
function showTooltip(html: string, key: string, clientX: number, clientY: number): void {
  if (container.classList.contains('drawer-open')) return;
  if (activeTip !== key) { tooltip.innerHTML = html; activeTip = key; }
  tooltip.hidden = false;
  const bounds = container.getBoundingClientRect(), tip = tooltip.getBoundingClientRect();
  let left = clientX - bounds.left + 15, top = clientY - bounds.top + 15;
  if (left + tip.width > bounds.width - 10) left = clientX - bounds.left - tip.width - 15;
  if (top + tip.height > bounds.height - 10) top = clientY - bounds.top - tip.height - 15;
  tooltip.style.left = `${clamp(left, 10, Math.max(10, bounds.width - tip.width - 10))}px`;
  tooltip.style.top = `${clamp(top, 10, Math.max(10, bounds.height - tip.height - 10))}px`;
}
const globe = new Globe(document.querySelector<SVGSVGElement>('#globe')!, {
  cityHover: (r, x, y) => showTooltip(cityTooltip(r, home, unit), `city-${r.city.name}-${unit}`, x, y),
  countryHover: (r, x, y) => showTooltip(countryTooltip(r, unit), `country-${r.country.name}-${unit}`, x, y),
  citySelected: r => selectDestination(r, false), hideTooltip,
  spinChanged: spinning => {
    document.querySelector('#spin-text')!.textContent = spinning ? 'Pause spin' : 'Spin';
    document.querySelector('#spin-icon')!.innerHTML = spinning ? icon('<path d="M9 5v14M15 5v14"/>') : icon('<path d="m9 5 10 7-10 7Z"/>');
    spinButton.setAttribute('aria-pressed', String(spinning));
    spinButton.setAttribute('aria-label', spinning ? 'Pause spin' : 'Spin globe');
  },
});

function renderLists(): void {
  topList.innerHTML = ranked.slice(0, 5).map(r => {
    const rating = band(r.score), travel = `~${hours(r.travel.hours)}h ${r.travel.mode === 'drive' ? 'drive' : 'away'}`;
    const delta = r.high - r.homeHigh;
    const note = [...r.events.filter(e => !e.startsWith('Ramadan')), ...r.risks, ...r.dealbreakers][0];
    const escape = delta * 1.8 >= 15 ? `${difference(delta, unit)} vs ${home.name}` : crowdWord(r.crowd);
    return `<button type="button" class="pick-row${selectedName === r.city.name ? ' selected' : ''}" data-city="${escapeHtml(r.city.name)}" aria-pressed="${selectedName === r.city.name}" aria-label="${escapeHtml(r.city.name)}, rank ${r.rank}, ${rating.label}, ${Math.round(r.score)}. Center on globe."><span class="pick-heading"><span class="rank-circle" style="--swatch:${rating.color}">${r.rank}</span><span class="pick-place"><strong class="city-name">${escapeHtml(r.city.name)}</strong><span class="country-name">${escapeHtml(displayCountry(r.city.country))}</span></span><span class="rating ${rating.key}"><strong>${Math.round(r.score)}</strong><span>${rating.label}</span></span></span><span class="pick-facts"><span>${temperature(r.high, unit)}</span><span>${rainWord(r.rain).toLowerCase()}</span><span>${travel}</span></span><span class="pick-note">${escapeHtml(note ?? escape)}</span></button>`;
  }).join('');
  moreGrid.innerHTML = ranked.slice(5, 17).map(r => {
    const rating = band(r.score);
    return `<button type="button" class="option-card${selectedName === r.city.name ? ' selected' : ''}" data-city="${escapeHtml(r.city.name)}" aria-pressed="${selectedName === r.city.name}" aria-label="${escapeHtml(r.city.name)}, rank ${r.rank}, ${rating.label}, score ${Math.round(r.score)}. Center on globe."><span class="option-top"><span class="option-name"><span class="swatch" style="--swatch:${rating.color}"></span>${escapeHtml(r.city.name)}</span><span class="option-score">${Math.round(r.score)}</span></span><span class="option-detail">${temperature(r.high, unit)} <span>·</span> ~${hours(r.travel.hours)}h ${r.travel.mode === 'drive' ? 'drive' : 'away'}</span></button>`;
  }).join('');
}
function renderSelection(): void {
  const result = cityScores.find(r => r.city.name === selectedName);
  const selection = document.querySelector<HTMLElement>('#selection')!;
  selection.hidden = !result;
  if (!result) return;
  selection.style.setProperty('--swatch', band(result.score).color);
  document.querySelector('#selected-name')!.textContent = result.city.name;
  document.querySelector('#selected-summary')!.textContent = `${displayCountry(result.city.country)} · ${temperature(result.high, unit)} · ~${hours(result.travel.hours)}h ${result.travel.mode === 'drive' ? 'drive' : 'away'}`;
  document.querySelector('#details-content')!.innerHTML = cityTooltip(result, home, unit);
}
function selectDestination(result: CityScore, fly = true): void {
  selectedName = result.city.name; hideTooltip();
  if (fly) globe.flyTo(result.city.lon, result.city.lat);
  globe.setSelected(selectedName);
  for (const button of document.querySelectorAll<HTMLButtonElement>('.pick-row, .option-card')) {
    const selected = button.dataset.city === selectedName;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
  panels.closeDrawer(); renderSelection();
}
function recompute(shouldFly: boolean): void {
  const trip: Trip = { start: start.value, end: end.value }, error = validateTrip(trip);
  const errorElement = document.querySelector<HTMLElement>('#date-error')!;
  errorElement.hidden = !error; errorElement.textContent = error ?? '';
  document.querySelector<HTMLElement>('#invalid-summary')!.hidden = !error;
  start.setAttribute('aria-invalid', String(Boolean(error))); end.setAttribute('aria-invalid', String(Boolean(error)));
  if (error) { document.querySelector('#trip-length')!.textContent = '— days'; return; }
  home = ORIGINS.find(origin => origin.name === homeSelect.value)!; hideTooltip();
  cityScores = scoreCities(trip, home, weights); ranked = rankCities(cityScores);
  const samples = sampleDays(trip), duration = `${samples.tripDays} ${samples.tripDays === 1 ? 'day' : 'days'}`;
  const dateLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  document.querySelector('#trip-length')!.textContent = duration;
  document.querySelector('#summary-origin')!.textContent = `From ${home.name}`;
  document.querySelector('#summary-dates')!.textContent = `${dateLabel(trip.start)} – ${dateLabel(trip.end)}`;
  document.querySelector('#summary-duration')!.textContent = duration;
  if (shouldFly) selectedName = null;
  const countries = MAP_COUNTRIES.map(({ country }) => scoreCountry(country, home, samples, weights)).filter((c): c is CountryScore => c !== null);
  renderLists(); renderSelection(); globe.update(cityScores, ranked, countries, home); globe.setSelected(selectedName);
  document.querySelector('#ranking-context')!.textContent = `For ${duration}, from ${home.name}`;
  document.querySelector('#rank-announcement')!.textContent = `Top pick: ${ranked[0].city.name}, score ${Math.round(ranked[0].score)}. ${duration} from ${home.name}.`;
  if (shouldFly) globe.flyTo(ranked[0].city.lon, ranked[0].city.lat);
}
for (const control of [start, end, homeSelect]) control.addEventListener('change', () => recompute(true));
for (const slider of document.querySelectorAll<HTMLInputElement>('[data-weight]')) slider.addEventListener('input', () => {
  weights[slider.dataset.weight as keyof Weights] = Number(slider.value);
  document.querySelector(`#value-${slider.dataset.weight}`)!.textContent = slider.value; recompute(false);
});
document.querySelector('#reset-weights')!.addEventListener('click', () => {
  Object.assign(weights, DEFAULT_WEIGHTS);
  for (const slider of document.querySelectorAll<HTMLInputElement>('[data-weight]')) {
    slider.value = String(weights[slider.dataset.weight as keyof Weights]); document.querySelector(`#value-${slider.dataset.weight}`)!.textContent = slider.value;
  }
  recompute(false);
});
spinButton.addEventListener('click', () => globe.toggleSpin());
document.querySelector('#zoom-in')!.addEventListener('click', () => globe.zoom(1.2));
document.querySelector('#zoom-out')!.addEventListener('click', () => globe.zoom(1 / 1.2));
document.querySelector('#reset-view')!.addEventListener('click', () => globe.resetView());
unitButton.addEventListener('click', () => {
  unit = unit === 'F' ? 'C' : 'F';
  unitButton.innerHTML = `<span class="${unit === 'F' ? 'unit-active' : ''}">°F</span><span class="unit-divider">/</span><span class="${unit === 'C' ? 'unit-active' : ''}">°C</span>`;
  unitButton.setAttribute('aria-label', `Temperature unit: ${unit === 'F' ? 'Fahrenheit. Switch to Celsius.' : 'Celsius. Switch to Fahrenheit.'}`);
  hideTooltip(); renderLists(); renderSelection();
});
function resultForTarget(target: EventTarget | null): CityScore | undefined {
  const card = (target as Element | null)?.closest<HTMLButtonElement>('[data-city]');
  return cityScores.find(r => r.city.name === card?.dataset.city);
}
for (const list of [topList, moreGrid]) {
  list.addEventListener('click', event => { const r = resultForTarget(event.target); if (r) selectDestination(r); });
  list.addEventListener('pointermove', event => { if (event.pointerType === 'touch') return; const r = resultForTarget(event.target); if (r) showTooltip(cityTooltip(r, home, unit), `city-${r.city.name}-${unit}`, event.clientX, event.clientY); });
  list.addEventListener('pointerleave', hideTooltip); list.addEventListener('focusout', hideTooltip);
}
document.querySelector('#clear-selection')!.addEventListener('click', () => {
  selectedName = null; globe.setSelected(null); renderLists(); renderSelection(); document.querySelector<SVGSVGElement>('#globe')!.focus();
});
document.querySelector('#selected-details')!.addEventListener('click', () => { hideTooltip(); detailsDialog.showModal(); });
document.querySelector('#show-method')!.addEventListener('click', () => document.querySelector<HTMLDialogElement>('#method-dialog')!.showModal());
for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog')) {
  dialog.querySelector('.dialog-close')!.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
window.addEventListener('resize', hideTooltip);
document.querySelector('.panel-toggles')!.addEventListener('click', hideTooltip);
document.querySelectorAll('.panel-scroll').forEach(panel => panel.addEventListener('scroll', hideTooltip, { passive: true }));
window.addEventListener('pagehide', () => globe.destroy(), { once: true });
recompute(false);
window.setTimeout(() => globe.initialFlyTo(ranked[0].city.lon, ranked[0].city.lat), 600);
