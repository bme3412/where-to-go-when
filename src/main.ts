import './style.css';
import { ORIGINS } from './data/origins';
import { climateLabel, climateSourceKind } from './climate';
import { auditContent, auditDestinations, auditRows } from './audit';
import type { AuditFilter } from './audit';
import { band, cityTooltip, countryTooltip, crowdWord, difference, displayCountry, escapeHtml, hours, rainWord, scoreBreakdown, temperature } from './format';
import { Globe } from './globe';
import { methodContent } from './method';
import { setupPanels } from './panels';
import { clamp, DEFAULT_WEIGHTS, DEFAULT_TEMPERATURE, defaultTrip, matchesDestinationScope, rankCities, sampleDays, scoreCities, setWeight, validateTemperature, validateTrip } from './scoring';
import type { CityScore, DestinationScope, RankedCity, TemperatureRange, Trip, Unit, Weights } from './types';

const app = document.querySelector<HTMLElement>('#app')!;
const initialTrip = defaultTrip(new Date());
const weights: Weights = { ...DEFAULT_WEIGHTS };
let weightBasis: Weights = { ...weights };
let lastWeightKey: keyof Weights | null = null;
const preferredTemperature: TemperatureRange = { ...DEFAULT_TEMPERATURE };
let home = ORIGINS[0];
let unit: Unit = 'F';
let scope: DestinationScope = 'all';
let cityScores: CityScore[] = [];
let allCityScores: CityScore[] = [];
let ranked: RankedCity[] = [];
let selectedName: string | null = null;
let activeTip = '';
const icon = (content: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
const closeIcon = icon('<path d="m6 6 12 12M18 6 6 18"/>');
const globeIcon = icon('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4.5" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>');
const preferences: { key: keyof Weights; label: string; hint: string; paths: string }[] = [
  { key: 'weather', label: 'Temperature', hint: 'Historical highs in your range', paths: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>' },
  { key: 'dry', label: 'Dry days', hint: 'Historical days below 1 mm precipitation', paths: '<path d="M12 3C10 6 6 10 6 14a6 6 0 0 0 12 0c0-4-4-8-6-11Z"/>' },
  { key: 'crowds', label: 'Few crowds', hint: 'Seasonal estimate + events', paths: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m1 4a5 5 0 0 1 4 5v2"/>' },
  { key: 'travel', label: 'Short travel', hint: 'Estimated usable trip time', paths: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>' },
];

app.innerHTML = `
  <header class="app-header">
    <div class="brand"><span class="brand-icon">${globeIcon}</span><h1>Where to go, and when</h1></div>
    <nav class="panel-toggles" aria-label="Explore controls">
      <button id="toggle-settings" class="panel-toggle" type="button" aria-controls="settings-panel" aria-expanded="true">${icon('<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>')}<span>Your trip</span></button>
      <button id="toggle-results" class="panel-toggle" type="button" aria-controls="results-panel" aria-expanded="true">${icon('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>')}<span>Your picks</span><span class="count-bubble">17</span></button>
    </nav>
  </header>
  <section id="globe-container" class="workspace" aria-label="Vacation explorer">
    <aside id="settings-panel" class="side-panel settings-panel" aria-label="Trip settings">
      <button type="button" class="icon-button close-panel settings-close" data-close-panel aria-label="Close trip settings">${closeIcon}</button>
      <div class="panel-scroll settings-content">
        <div class="field"><label for="home">Home city</label><select id="home">${ORIGINS.map(origin => `<option value="${escapeHtml(origin.name)}">${escapeHtml(origin.name)}</option>`).join('')}</select></div>
        <fieldset class="destination-scope"><legend>Destinations</legend><div class="scope-options">${(['all', 'domestic', 'international'] as const).map(value => `<label class="scope-choice"><input type="radio" name="destination-scope" value="${value}" ${value === 'all' ? 'checked' : ''} /><span>${value[0].toUpperCase() + value.slice(1)}</span></label>`).join('')}</div></fieldset>
        <div class="date-fields"><div class="field"><label for="start">From</label><input type="date" id="start" value="${initialTrip.start}" aria-describedby="date-error" /></div><div class="field"><label for="end">To</label><input type="date" id="end" value="${initialTrip.end}" aria-describedby="date-error" /></div></div>
        <div class="trip-duration">${icon('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16"/>')}<output id="trip-length" for="start end">15 days</output><span>to get away</span></div>
        <p id="date-error" class="date-error" role="alert" hidden></p>
        <div class="section-divider"></div>
        <fieldset class="temperature-preference"><legend>Preferred daytime highs</legend><div class="temperature-fields"><div><label for="temperature-min">Low <span class="temperature-unit">°F</span></label><input type="number" id="temperature-min" step="any" value="68" min="-40" max="122" aria-describedby="temperature-error" /></div><span aria-hidden="true">to</span><div><label for="temperature-max">High <span class="temperature-unit">°F</span></label><input type="number" id="temperature-max" step="any" value="86" min="-40" max="122" aria-describedby="temperature-error" /></div></div><p id="temperature-error" class="date-error" role="alert" hidden></p></fieldset>

      </div>
    </aside>
    <section class="globe-stage" aria-label="Interactive destination globe">
      <div class="stage-heading"><div><div class="trip-summary"><span id="summary-origin">From Boston</span><span aria-hidden="true">·</span><span id="summary-dates">Dec 20 – Jan 3</span><span class="summary-duration" id="summary-duration">15 days</span><span class="summary-scope" id="summary-scope" hidden></span></div><p class="invalid-summary" id="invalid-summary" hidden>Showing your last valid settings</p></div><div class="stage-actions"><button id="spin" class="small-button spin-button" type="button" aria-pressed="true"><span id="spin-icon">${icon('<path d="M9 5v14M15 5v14"/>')}</span><span id="spin-text">Pause spin</span></button><button id="units" class="small-button unit-button" type="button" aria-label="Temperature unit: Fahrenheit. Switch to Celsius."><span class="unit-active">°F</span><span class="unit-divider">/</span><span>°C</span></button></div></div>
      <div class="globe-canvas"><svg id="globe" viewBox="0 0 760 520" tabindex="0" role="group" aria-label="Interactive vacation globe. Use arrow keys to rotate, plus or minus to zoom. Choose a destination to center it."></svg><div class="zoom-controls" aria-label="Globe zoom"><button class="icon-button" id="zoom-in" type="button" aria-label="Zoom in">${icon('<path d="M12 5v14M5 12h14"/>')}</button><button class="icon-button" id="zoom-out" type="button" aria-label="Zoom out">${icon('<path d="M5 12h14"/>')}</button><button class="icon-button reset-view" id="reset-view" type="button" aria-label="Reset globe view">${icon('<path d="M8 4H4v4m12-4h4v4M4 16v4h4m8 0h4v-4"/>')}</button></div></div>
      <div id="selection" class="selection" hidden><span class="selection-dot"></span><div class="selection-copy"><strong id="selected-name"></strong><span id="selected-summary"></span></div><button id="selected-details" class="small-button" type="button" aria-haspopup="dialog">Why this score? ${icon('<path d="m9 5 7 7-7 7"/>')}</button><button id="clear-selection" class="icon-button" type="button" aria-label="Clear selected destination">${closeIcon}</button></div>
      <section class="priorities-dock" aria-label="Your priorities">
        <div class="priorities-top"><button id="toggle-priorities" class="priorities-toggle" type="button" aria-expanded="true" aria-controls="priorities-body"><span class="priorities-title">Your priorities</span><output id="weight-total" aria-label="Total weight">100%</output>${icon('<path d="m7 10 5 5 5-5"/>')}</button><p class="weights-help" id="weights-help">Adjust one; the others rebalance to 100%.</p><button class="text-button reset-preferences" id="reset-weights" type="button">Reset preferences</button></div>
        <div id="priorities-body">
        <div class="weights">${preferences.map(({ key, label, hint, paths }) => `<div class="weight"><div class="weight-heading"><label for="weight-${key}">${icon(paths)}${label}</label><output for="weight-${key}" id="value-${key}">${weights[key]}%</output></div><input id="weight-${key}" data-weight="${key}" type="range" min="0" max="100" step="1" value="${weights[key]}" aria-valuetext="${weights[key]} percent" aria-describedby="hint-${key} weights-help" /><p class="weight-hint" id="hint-${key}">${hint}</p></div>`).join('')}</div>
        </div>
      </section>
    </section>
    <aside id="results-panel" class="side-panel results-panel" aria-labelledby="top-title">
      <div class="panel-heading"><div><h2 id="top-title">Your top 5</h2><p id="ranking-context">For 15 days, from Boston</p></div><button type="button" class="icon-button close-panel" data-close-panel aria-label="Close recommendations">${closeIcon}</button></div>
      <div class="panel-scroll results-content"><div id="top-list" class="top-list"></div><div id="more-options"><div class="more-heading"><h3>More destinations</h3><span id="more-range">6–17</span></div><div id="more-grid" class="more-grid"></div></div><p class="results-note">Select a destination to inspect its score.</p></div>
    </aside>
    <button type="button" id="panel-backdrop" class="panel-backdrop" aria-label="Close open panel" tabindex="-1" hidden></button>
    <div id="tooltip" class="tooltip" role="tooltip" hidden></div>
  </section>
  <footer class="app-footer"><button type="button" class="text-button" data-show-method aria-haspopup="dialog" aria-controls="method-dialog">${icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>')}Scoring & data</button><button type="button" class="text-button" id="show-audit" aria-haspopup="dialog" aria-controls="audit-dialog">Data audit · all destinations</button><span>Climate averages, not a forecast.</span></footer>
  <p id="rank-announcement" class="sr-only" role="status" aria-live="polite"></p>
  <dialog id="details-dialog" class="detail-dialog" aria-label="Destination details"><button type="button" class="icon-button dialog-close" aria-label="Close destination details">${closeIcon}</button><div id="details-content"></div></dialog>
  <dialog id="audit-dialog" class="method-dialog audit-dialog" aria-labelledby="audit-title"><button type="button" class="icon-button dialog-close" aria-label="Close data audit">${closeIcon}</button>${auditContent}</dialog>
  <dialog id="method-dialog" class="method-dialog" aria-labelledby="method-title"><button type="button" class="icon-button dialog-close" aria-label="Close scoring explanation">${closeIcon}</button>${methodContent}</dialog>
`;

const start = document.querySelector<HTMLInputElement>('#start')!;
const end = document.querySelector<HTMLInputElement>('#end')!;
const homeSelect = document.querySelector<HTMLSelectElement>('#home')!;
const temperatureMin = document.querySelector<HTMLInputElement>('#temperature-min')!;
const temperatureMax = document.querySelector<HTMLInputElement>('#temperature-max')!;
const tooltip = document.querySelector<HTMLDivElement>('#tooltip')!;
const container = document.querySelector<HTMLElement>('#globe-container')!;
const spinButton = document.querySelector<HTMLButtonElement>('#spin')!;
const unitButton = document.querySelector<HTMLButtonElement>('#units')!;
const topList = document.querySelector<HTMLDivElement>('#top-list')!;
const moreGrid = document.querySelector<HTMLDivElement>('#more-grid')!;
const detailsDialog = document.querySelector<HTMLDialogElement>('#details-dialog')!;
const panels = setupPanels(container);
const prioritiesToggle = document.querySelector<HTMLButtonElement>('#toggle-priorities')!;
const prioritiesBody = document.querySelector<HTMLElement>('#priorities-body')!;
const compactPriorities = window.matchMedia('(max-width: 600px)');
function showPriorities(open: boolean): void {
  if (!open && prioritiesBody.contains(document.activeElement)) prioritiesToggle.focus();
  prioritiesBody.hidden = !open;
  prioritiesToggle.setAttribute('aria-expanded', String(open));
}
prioritiesToggle.addEventListener('click', () => showPriorities(prioritiesBody.hidden));
compactPriorities.addEventListener('change', () => showPriorities(!compactPriorities.matches));
showPriorities(!compactPriorities.matches);


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
  countryHover: (country, x, y) => showTooltip(countryTooltip(country, ranked), `country-${country.name}`, x, y),
  citySelected: r => selectDestination(r, false), hideTooltip,
  spinChanged: spinning => {
    document.querySelector('#spin-text')!.textContent = spinning ? 'Pause spin' : 'Spin';
    document.querySelector('#spin-icon')!.innerHTML = spinning ? icon('<path d="M9 5v14M15 5v14"/>') : icon('<path d="m9 5 10 7-10 7Z"/>');
    spinButton.setAttribute('aria-pressed', String(spinning));
    spinButton.setAttribute('aria-label', spinning ? 'Pause spin' : 'Spin globe');
  },
});

function renderLists(): void {
  const count = Math.min(5, ranked.length);
  document.querySelector('#top-title')!.textContent = count === 0 ? 'Your picks' : count === 1 ? 'Your top pick' : `Your top ${count}`;
  document.querySelector('.count-bubble')!.textContent = String(Math.min(17, ranked.length));
  document.querySelector<HTMLElement>('#more-options')!.hidden = ranked.length <= 5;
  document.querySelector('#more-range')!.textContent = `6–${Math.min(17, ranked.length)}`;
  document.querySelector<HTMLElement>('.results-note')!.hidden = ranked.length === 0;
  const scopeLabel = scope === 'all' ? '' : scope[0].toUpperCase() + scope.slice(1);
  document.querySelector<HTMLElement>('#summary-scope')!.hidden = !scopeLabel;
  document.querySelector('#summary-scope')!.textContent = scopeLabel;
  topList.innerHTML = ranked.slice(0, 5).map(r => {
    const rating = band(r.score), travel = `~${hours(r.travel.hours)}h ${r.travel.mode === 'drive' ? 'drive' : 'away'}`;
    const delta = r.high - r.homeHigh;
    const note = [...r.events.filter(e => !e.startsWith('Ramadan')), ...r.risks, ...r.dealbreakers][0];
    const escape = delta * 1.8 >= 15 ? `${difference(delta, unit)} vs ${home.name}` : crowdWord(r.crowd);
    return `<button type="button" class="pick-row${selectedName === r.city.name ? ' selected' : ''}" data-city="${escapeHtml(r.city.name)}" aria-pressed="${selectedName === r.city.name}" aria-label="${escapeHtml(r.city.name)}, rank ${r.rank}, ${rating.label}, ${Math.round(r.score)}. ${climateLabel(r.climate)}. Center on globe."><span class="pick-heading"><span class="rank-circle" style="--swatch:${rating.color}">${r.rank}</span><span class="pick-place"><strong class="city-name">${escapeHtml(r.city.name)}</strong><span class="country-name">${escapeHtml(displayCountry(r.city.country))}${r.climate.referenceLabel ? ` · ${escapeHtml(r.climate.referenceLabel)}` : ''}</span></span><span class="rating ${rating.key}"><strong>${Math.round(r.score)}</strong><span>${rating.label}</span></span></span><span class="pick-facts"><span>${temperature(r.high, unit)}</span><span>${rainWord(r.wetFrequency)}</span><span>${travel}</span></span><span class="pick-note">${escapeHtml(note ?? escape)}</span><span class="pick-source source-${climateSourceKind(r.climate)}">${climateLabel(r.climate)}</span></button>`;
  }).join('');
  if (!ranked.length) topList.innerHTML = `<div class="empty-results"><strong>No ${scope === 'all' ? 'matching' : scope} destinations</strong><p>There aren’t any destinations in this list beyond your home city for this filter.</p><button type="button" class="small-button" data-clear-scope>Show all destinations</button></div>`;
  moreGrid.innerHTML = ranked.slice(5, 17).map(r => {
    const rating = band(r.score);
    return `<button type="button" class="option-card${selectedName === r.city.name ? ' selected' : ''}" data-city="${escapeHtml(r.city.name)}" aria-pressed="${selectedName === r.city.name}" aria-label="${escapeHtml(r.city.name)}, rank ${r.rank}, ${rating.label}, score ${Math.round(r.score)}. ${climateLabel(r.climate)}. Center on globe."><span class="option-top"><span class="option-name"><span class="swatch" style="--swatch:${rating.color}"></span>${escapeHtml(r.city.name)}</span><span class="option-score">${Math.round(r.score)}</span></span><span class="option-detail">${temperature(r.high, unit)} <span>·</span> ~${hours(r.travel.hours)}h ${r.travel.mode === 'drive' ? 'drive' : 'away'}</span><span class="option-source source-${climateSourceKind(r.climate)}">${climateLabel(r.climate)}</span></button>`;
  }).join('');
}
function renderSelection(): void {
  const result = allCityScores.find(r => r.city.name === selectedName);
  const selection = document.querySelector<HTMLElement>('#selection')!;
  selection.hidden = !result;
  if (!result) return;
  selection.style.setProperty('--swatch', band(result.score).color);
  document.querySelector('#selected-name')!.textContent = result.city.name;
  document.querySelector('#selected-summary')!.textContent = `${displayCountry(result.city.country)} · ${temperature(result.high, unit)} · ~${hours(result.travel.hours)}h ${result.travel.mode === 'drive' ? 'drive' : 'away'}`;
  document.querySelector('#details-content')!.innerHTML = cityTooltip(result, home, unit) + scoreBreakdown(result, unit);
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
  const temperatureError = validateTemperature(preferredTemperature);
  const errorElement = document.querySelector<HTMLElement>('#date-error')!;
  errorElement.hidden = !error; errorElement.textContent = error ?? '';
  const temperatureErrorElement = document.querySelector<HTMLElement>('#temperature-error')!;
  temperatureErrorElement.hidden = !temperatureError; temperatureErrorElement.textContent = temperatureError ?? '';
  temperatureMin.setAttribute('aria-invalid', String(Boolean(temperatureError)));
  temperatureMax.setAttribute('aria-invalid', String(Boolean(temperatureError)));
  document.querySelector<HTMLElement>('#invalid-summary')!.hidden = !error && !temperatureError;
  start.setAttribute('aria-invalid', String(Boolean(error))); end.setAttribute('aria-invalid', String(Boolean(error)));
  if (error) { document.querySelector('#trip-length')!.textContent = '— days'; return; }
  if (temperatureError) return;
  home = ORIGINS.find(origin => origin.name === homeSelect.value)!; hideTooltip();
  scope = document.querySelector<HTMLInputElement>('[name="destination-scope"]:checked')!.value as DestinationScope;
  allCityScores = scoreCities(trip, home, weights, preferredTemperature);
  cityScores = allCityScores.filter(result => result.travel.km >= 40 && matchesDestinationScope(result.city.country, home.country, scope));
  ranked = rankCities(cityScores);
  const samples = sampleDays(trip), duration = `${samples.tripDays} ${samples.tripDays === 1 ? 'day' : 'days'}`;
  const dateLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  document.querySelector('#trip-length')!.textContent = duration;
  document.querySelector('#summary-origin')!.textContent = `From ${home.name}`;
  document.querySelector('#summary-dates')!.textContent = `${dateLabel(trip.start)} – ${dateLabel(trip.end)}`;
  document.querySelector('#summary-duration')!.textContent = duration;
  if (shouldFly) selectedName = null;
  renderLists(); renderSelection(); globe.update(cityScores, ranked, home); globe.setSelected(selectedName);
  document.querySelector('#ranking-context')!.textContent = `For ${duration}, from ${home.name}${scope === 'all' ? '' : ` · ${scope}`}`;
  const best = ranked[0];
  document.querySelector('#rank-announcement')!.textContent = best ? `Top pick: ${best.city.name}, score ${Math.round(best.score)}. ${duration} from ${home.name}.` : `No ${scope === 'all' ? 'matching' : scope} destinations in this list from ${home.name}.`;
  if (shouldFly) globe.flyTo(best?.city.lon ?? home.lon, best?.city.lat ?? home.lat);
}
for (const control of document.querySelectorAll<HTMLInputElement>('[name="destination-scope"]')) control.addEventListener('change', () => {
  recompute(true);
});
for (const control of [start, end, homeSelect]) control.addEventListener('change', () => recompute(true));
function syncWeights(): void {
  for (const slider of document.querySelectorAll<HTMLInputElement>('[data-weight]')) {
    const value = weights[slider.dataset.weight as keyof Weights];
    slider.value = String(value); slider.setAttribute('aria-valuetext', `${value} percent`);
    document.querySelector(`#value-${slider.dataset.weight}`)!.textContent = `${value}%`;
  }
  document.querySelector('#weight-total')!.textContent = `${Object.values(weights).reduce((sum, value) => sum + value, 0)}%`;
}
function syncTemperature(): void {
  for (const [key, input] of [['min', temperatureMin], ['max', temperatureMax]] as const) {
    const celsius = preferredTemperature[key];
    input.value = Number.isFinite(celsius) ? String(Number((unit === 'F' ? celsius * 9 / 5 + 32 : celsius).toFixed(1))) : '';
    input.min = '-40'; input.max = unit === 'F' ? '122' : '50';
  }
  document.querySelectorAll('.temperature-unit').forEach(label => label.textContent = `°${unit}`);
}
for (const [key, input] of [['min', temperatureMin], ['max', temperatureMax]] as const) input.addEventListener('input', () => {
  preferredTemperature[key] = unit === 'F' ? (input.valueAsNumber - 32) * 5 / 9 : input.valueAsNumber;
  recompute(false);
});
for (const slider of document.querySelectorAll<HTMLInputElement>('[data-weight]')) slider.addEventListener('input', () => {
  const key = slider.dataset.weight as keyof Weights;
  // Preserve the original proportions across repeated drag/keyboard input. Reusing
  // already rounded outputs would slowly skew the other factors at each step.
  if (lastWeightKey !== key) { weightBasis = { ...weights }; lastWeightKey = key; }
  Object.assign(weights, setWeight(weightBasis, key, Number(slider.value)));
  syncWeights(); recompute(false);
});
document.querySelector('#reset-weights')!.addEventListener('click', () => {
  Object.assign(weights, DEFAULT_WEIGHTS);
  lastWeightKey = null;
  Object.assign(preferredTemperature, DEFAULT_TEMPERATURE);
  syncWeights(); syncTemperature(); recompute(false);
});
spinButton.addEventListener('click', () => globe.toggleSpin());
document.querySelector('#zoom-in')!.addEventListener('click', () => globe.zoom(1.2));
document.querySelector('#zoom-out')!.addEventListener('click', () => globe.zoom(1 / 1.2));
document.querySelector('#reset-view')!.addEventListener('click', () => globe.resetView());
unitButton.addEventListener('click', () => {
  unit = unit === 'F' ? 'C' : 'F';
  unitButton.innerHTML = `<span class="${unit === 'F' ? 'unit-active' : ''}">°F</span><span class="unit-divider">/</span><span class="${unit === 'C' ? 'unit-active' : ''}">°C</span>`;
  unitButton.setAttribute('aria-label', `Temperature unit: ${unit === 'F' ? 'Fahrenheit. Switch to Celsius.' : 'Celsius. Switch to Fahrenheit.'}`);
  syncTemperature(); hideTooltip(); renderLists(); renderSelection();
});
topList.addEventListener('click', event => {
  if (!(event.target as Element).closest('[data-clear-scope]')) return;
  document.querySelector<HTMLInputElement>('[name="destination-scope"][value="all"]')!.checked = true;
  recompute(true);
  document.querySelector<HTMLButtonElement>('#top-list .pick-row')?.focus();
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
document.querySelector('#selected-details')!.addEventListener('click', () => { hideTooltip(); renderSelection(); detailsDialog.showModal(); detailsDialog.scrollTop = 0; });
document.addEventListener('click', event => {
  if ((event.target as Element).closest('[data-show-method]')) {
    hideTooltip();
    const methodDialog = document.querySelector<HTMLDialogElement>('#method-dialog')!;
    methodDialog.showModal(); methodDialog.scrollTop = 0;
  }
});
const auditDialog = document.querySelector<HTMLDialogElement>('#audit-dialog')!;
const auditSearch = document.querySelector<HTMLInputElement>('#audit-search')!;
const auditFilter = document.querySelector<HTMLSelectElement>('#audit-filter')!;
function renderAudit(): void {
  const filter = auditFilter.value as AuditFilter;
  document.querySelector('#audit-list')!.innerHTML = auditRows(auditSearch.value, filter);
  const count = auditDestinations(auditSearch.value, filter).length;
  document.querySelector('#audit-count')!.textContent = `${count} ${count === 1 ? 'destination' : 'destinations'}`;
}
document.querySelector('#show-audit')!.addEventListener('click', () => {
  hideTooltip(); panels.closeDrawer(); auditDialog.showModal(); auditDialog.scrollTop = 0; auditSearch.focus();
});
auditSearch.addEventListener('input', renderAudit);
auditFilter.addEventListener('change', renderAudit);
auditDialog.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-audit-city]');
  const result = allCityScores.find(r => r.city.name === button?.dataset.auditCity);
  if (!result) return;
  document.querySelector('#details-content')!.innerHTML = cityTooltip(result, home, unit) + scoreBreakdown(result, unit);
  detailsDialog.showModal(); detailsDialog.scrollTop = 0;
});
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
window.setTimeout(() => { const best = ranked[0]; if (best) globe.initialFlyTo(best.city.lon, best.city.lat); }, 600);
