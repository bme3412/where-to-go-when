import { countryFlag, destinationActivity } from './data/destination-tips';
import { setupOriginSearch } from './origin-search';
import { datePickerMarkup, setupDatePicker } from './date-picker';
import { CITIES } from './data/cities';
import { FORECAST_SOURCE, loadForecast, needsForecast } from './forecast';
import type { Forecasts } from './forecast';
import { destinationName, GLOBE_REGIONS, matchesDestinationRegion, REGIONS, REGION_DESCRIPTIONS } from './regions';
import type { DestinationRegionFilter } from './regions';
import './style.css';
import { ORIGINS } from './data/origins';
import { climateLabel, climateResolutionLabel } from './climate';
import { auditContent, auditDestinations, auditRows } from './audit';
import type { AuditFilter } from './audit';
import { band, cityTooltip, countryTooltip, displayCountry, escapeHtml, flightDetails, flightRouteDetails, rankingRouteLabel, scoreBreakdown, temperature, temperatureBound, weatherBadges, weatherDetails, weatherSourceSummary } from './format';
import { Globe } from './globe';
import { isNonstopBostonTrip } from './flights';
import { flightMapFor, nonstopFlightMaps } from './flight-map';
import type { FlightDirection, NonstopFlightMap } from './flight-map';
import { methodContent } from './method';
import { setupPanels } from './panels';
import { clamp, DEFAULT_WEIGHTS, DEFAULT_TEMPERATURE, defaultTrip, isRankableCity, matchesDestinationScope, matchesTemperaturePreferences, rankCities, sampleDays, scoreCities, setWeight, validateTemperature } from './scoring';
import { weatherFlagLabel } from './weather';
import { weatherLegend } from './weather-map';
import type { CityScore, DestinationScope, RankedCity, TemperatureRange, Unit, WeatherLayer, Weights } from './types';

const app = document.querySelector<HTMLElement>('#app')!;
const initialTrip = defaultTrip(new Date());
let trip = initialTrip;
const weights: Weights = { ...DEFAULT_WEIGHTS };
let weightBasis: Weights = { ...weights };
let lastWeightKey: keyof Weights | null = null;
const preferredTemperature: TemperatureRange = { ...DEFAULT_TEMPERATURE };
const appliedTemperature: TemperatureRange = { ...DEFAULT_TEMPERATURE };
const temperaturePresets = { cool: { min: 10, max: 20 }, mild: { min: 15, max: 25 }, warm: { min: 20, max: 30 } };
let temperatureOnly = false;
let warmerThanHome = false;
let weatherLayer: WeatherLayer = 'temperature';
let home = ORIGINS[0];
let chosenHome = home;
let unit: Unit = 'F';
let scope: DestinationScope = 'all';
let selectedRegion: DestinationRegionFilter = 'all';
const scopeNames = { all: 'Anywhere', domestic: 'Domestic', international: 'Global' };
let nonstopOnly = false;
let routeDirection: FlightDirection = 'outbound';
let nonstopMaps: NonstopFlightMap[] = [];
let nonstopCityScores: CityScore[] = [];
let selectedNonstopRoute = false;
let cityScores: CityScore[] = [];
let allCityScores: CityScore[] = [];
let ranked: RankedCity[] = [];
const resultsPageSize = 30;
let visibleResults = resultsPageSize;
let forecasts: Forecasts | undefined;
let forecastPending = false;
let forecastExpires = 0;
let selectedName: string | null = null;
let activeRegion = '';
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
      <button id="toggle-settings" class="panel-toggle" type="button" aria-label="Trip settings" title="Trip settings" aria-controls="settings-panel" aria-expanded="true">${icon('<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>')}</button>
      <button id="toggle-results" class="panel-toggle" type="button" aria-label="Destinations" title="Destinations" aria-controls="results-panel" aria-expanded="true">${icon('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>')}</button>
    </nav>
  </header>
  <section id="globe-container" class="workspace" aria-label="Vacation explorer">
    <aside id="settings-panel" class="side-panel settings-panel" aria-label="Trip settings">
      <button type="button" class="icon-button close-panel settings-close" data-close-panel aria-label="Close trip settings">${closeIcon}</button>
      <div class="panel-scroll settings-content">
        <h2 class="trip-panel-title">Your trip</h2>
        <div class="field origin-field"><label for="home">Flying from</label><div class="origin-select">${icon('<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="m22 2-11 11"/>')}<input id="home" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="origin-suggestions" aria-describedby="origin-detail" autocomplete="off" spellcheck="false" placeholder="Search departure cities"><ul id="origin-suggestions" role="listbox" aria-label="Departure cities" hidden></ul></div><p id="origin-detail">Boston Logan · BOS</p></div>
        <fieldset class="destination-scope"><legend>Where to?</legend><div class="scope-options">${(['all', 'domestic', 'international'] as const).map(value => `<label class="scope-choice"><input type="radio" name="destination-scope" value="${value}" aria-label="${{ all: 'All destinations', domestic: 'Domestic destinations', international: 'Global destinations' }[value]}" ${value === 'all' ? 'checked' : ''} /><span>${{ all: 'Anywhere', domestic: 'Domestic', international: 'Global' }[value]}</span></label>`).join('')}</div></fieldset>
        <div class="field region-filter" hidden><label for="destination-region">Region</label><select id="destination-region"><option value="all">All regions</option>${GLOBE_REGIONS.map(region => `<option value="${region.id}">${region.name}</option>`).join('')}</select></div>
        <div id="boston-flight-filter" class="flight-filter"><label for="nonstop-only"><span class="flight-filter-copy"><strong id="nonstop-label">Nonstop flights only</strong><span id="nonstop-help">Both ways · schedules unverified</span></span><input type="checkbox" role="switch" id="nonstop-only" aria-labelledby="nonstop-label" aria-describedby="nonstop-help" /><span class="switch-track" aria-hidden="true"></span></label></div>
        <section class="trip-dates" aria-labelledby="trip-dates-title">
          <div class="trip-dates-heading"><h3 id="trip-dates-title">Travel dates</h3><output id="trip-length" aria-live="polite">15 days</output></div>
          ${datePickerMarkup}
        </section>
        <div class="section-divider"></div>
        <fieldset class="temperature-preference"><legend>Preferred daytime highs</legend><div class="temperature-fields"><div><label for="temperature-min">Low <span class="temperature-unit">°F</span></label><input type="number" id="temperature-min" step="any" value="68" min="-40" max="122" aria-describedby="temperature-error" /></div><span aria-hidden="true">to</span><div><label for="temperature-max">High <span class="temperature-unit">°F</span></label><input type="number" id="temperature-max" step="any" value="86" min="-40" max="122" aria-describedby="temperature-error" /></div></div><p id="temperature-error" class="date-error" role="alert" hidden></p><div class="temperature-presets" role="group" aria-label="Temperature presets">${Object.keys(temperaturePresets).map(key => `<button type="button" data-temperature-preset="${key}" aria-pressed="${key === 'warm'}">${key[0].toUpperCase() + key.slice(1)}</button>`).join('')}</div><label class="temperature-filter"><input type="checkbox" id="temperature-only" aria-describedby="temperature-filter-help" />At least half of highs in range</label><p id="temperature-filter-help" class="filter-help">Based on forecast and historical highs during estimated time at the destination.</p><label class="temperature-filter"><input type="checkbox" id="warmer-than-home" aria-describedby="warmer-than-home-help" />Warmer than home</label><p id="warmer-than-home-help" class="filter-help">Show places with a higher estimated daytime high than your departure city for these dates.</p></fieldset>

      </div>
    </aside>
    <section class="globe-stage" aria-label="Interactive destination globe">
      <div class="stage-heading"><div><div class="trip-summary"><span id="summary-origin">From Boston</span><span aria-hidden="true">·</span><span id="summary-dates">Dec 20 – Jan 3</span><span class="summary-duration" id="summary-duration">15 days</span><span class="summary-scope" id="summary-scope" hidden></span></div><p class="invalid-summary" id="invalid-summary" hidden>Showing your last valid settings</p></div><div class="stage-actions"><button id="spin" class="small-button spin-button" type="button" aria-pressed="true"><span id="spin-icon">${icon('<path d="M9 5v14M15 5v14"/>')}</span><span id="spin-text">Pause spin</span></button><button id="units" class="small-button unit-button" type="button" aria-label="Temperature unit: Fahrenheit. Switch to Celsius."><span class="unit-active">°F</span><span class="unit-divider">/</span><span>°C</span></button></div></div>
      <section id="region-explorer" class="region-explorer" aria-label="Places in this region" hidden></section>
      <div class="map-toolbar"><div class="map-control"><label for="weather-layer">Weather on globe</label><select id="weather-layer"><option value="temperature">Daytime temperature</option><option value="all">All weather flags</option><option value="wet">Wet seasons &amp; rain</option><option value="heat">Hot daytime highs</option><option value="cold">Freezing nights</option><option value="storm">Storm seasons</option><option value="off">Weather colors off</option></select></div></div>
      <div class="globe-canvas"><svg id="globe" viewBox="0 0 760 520" tabindex="0" role="group" aria-label="Destination globe"></svg><div id="weather-legend" class="weather-legend" aria-label="Weather color legend"></div><div class="zoom-controls" aria-label="Globe zoom"><button class="icon-button" id="zoom-in" type="button" aria-label="Zoom in">${icon('<path d="M12 5v14M5 12h14"/>')}</button><button class="icon-button" id="zoom-out" type="button" aria-label="Zoom out">${icon('<path d="M5 12h14"/>')}</button><button class="icon-button reset-view" id="reset-view" type="button" aria-label="Reset globe view">${icon('<path d="M8 4H4v4m12-4h4v4M4 16v4h4m8 0h4v-4"/>')}</button></div></div>
      <section id="flight-map-controls" class="flight-map-controls" aria-label="Boston flight routes" hidden>
        <div id="selected-flight-route" class="selected-flight-route" hidden><div class="flight-map-caption"><strong id="flight-map-path"></strong><span id="flight-map-note">Highlighted flight legs · schedules unverified</span></div><div class="flight-map-actions"><div class="route-directions" role="group" aria-label="Flight direction"><button type="button" id="route-outbound" data-route-direction="outbound" aria-pressed="true">Outbound</button><button type="button" id="route-inbound" data-route-direction="inbound" aria-pressed="false">Return</button></div><button type="button" id="view-flight-route" class="text-button">View route</button></div><div id="flight-map-details" class="flight-map-details" role="status" aria-live="polite" aria-atomic="true"></div></div>
      </section>
      <div id="selection" class="selection" hidden><span class="selection-dot"></span><div class="selection-copy"><strong id="selected-name"></strong><span id="selected-summary"></span><span id="selected-weather"></span></div><button id="selected-details" class="small-button" type="button" aria-haspopup="dialog">Why this score? ${icon('<path d="m9 5 7 7-7 7"/>')}</button><button id="clear-selection" class="icon-button" type="button" aria-label="Clear selected destination">${closeIcon}</button></div>
      <section class="priorities-dock" aria-label="Your priorities">
        <div class="priorities-top"><button id="toggle-priorities" class="priorities-toggle" type="button" aria-expanded="true" aria-controls="priorities-body"><span class="priorities-title">Your priorities</span><output id="weight-total" aria-label="Total weight">100%</output>${icon('<path d="m7 10 5 5 5-5"/>')}</button><p class="weights-help" id="weights-help">Weights set the match score. Adjust one to rebalance the others.</p><button class="text-button reset-preferences" id="reset-weights" type="button">Reset preferences</button></div>
        <div id="priorities-body">
        <div class="weights">${preferences.map(({ key, label, hint, paths }) => `<div class="weight"><div class="weight-heading"><label for="weight-${key}">${icon(paths)}${label}</label><output for="weight-${key}" id="value-${key}">${weights[key]}%</output></div><input id="weight-${key}" data-weight="${key}" type="range" min="0" max="100" step="1" value="${weights[key]}" aria-valuetext="${weights[key]} percent" aria-describedby="hint-${key} weights-help" /><p class="weight-hint" id="hint-${key}">${hint}</p></div>`).join('')}</div>
        </div>
      </section>
    </section>
    <aside id="results-panel" class="side-panel results-panel" aria-labelledby="destinations-title">
      <div class="panel-heading"><h2 id="destinations-title">Destinations</h2><button type="button" class="icon-button close-panel" data-close-panel aria-label="Close destinations">${closeIcon}</button></div>
      <div class="panel-scroll results-content">
        <p id="forecast-status" class="forecast-status" role="status"></p>
        <div id="destination-list" class="destination-list"></div>
        <button type="button" id="show-more-destinations" class="small-button" aria-controls="destination-list" hidden>Show more destinations</button>
        <p class="results-note">Select a destination to inspect its score.</p>
      </div>
    </aside>
    <button type="button" id="panel-backdrop" class="panel-backdrop" aria-label="Close open panel" tabindex="-1" hidden></button>
    <div id="tooltip" class="tooltip" role="tooltip" hidden></div>
  </section>
  <footer class="app-footer"><button type="button" class="text-button" id="explore-regions" aria-haspopup="dialog">Compare local areas</button><button type="button" class="text-button" data-show-method aria-haspopup="dialog" aria-controls="method-dialog">${icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>')}Scoring & data</button><button type="button" class="text-button" id="show-audit" aria-haspopup="dialog" aria-controls="audit-dialog">Data audit · all destinations</button><span>Globe colors show historical climate.</span></footer>
  <p id="results-announcement" class="sr-only" role="status" aria-live="polite"></p>
  <dialog id="regions-dialog" class="method-dialog regions-dialog" aria-labelledby="regions-title"><button type="button" class="icon-button dialog-close" aria-label="Close region explorer">${closeIcon}</button><h2 id="regions-title">Compare local areas</h2><p>Compare specific towns, islands and coastlines.</p><div class="region-choices">${REGIONS.map(region => `<button type="button" class="region-choice" data-region="${region}"><strong>${region}</strong><span>${REGION_DESCRIPTIONS[region]}</span></button>`).join('')}</div></dialog>
  <dialog id="details-dialog" class="detail-dialog" aria-label="Destination details"><button type="button" class="icon-button dialog-close" aria-label="Close destination details">${closeIcon}</button><div id="details-content"></div></dialog>
  <dialog id="audit-dialog" class="method-dialog audit-dialog" aria-labelledby="audit-title"><button type="button" class="icon-button dialog-close" aria-label="Close data audit">${closeIcon}</button>${auditContent}</dialog>
  <dialog id="method-dialog" class="method-dialog" aria-labelledby="method-title"><button type="button" class="icon-button dialog-close" aria-label="Close scoring explanation">${closeIcon}</button>${methodContent}</dialog>
`;

setupDatePicker(document.querySelector<HTMLElement>('.trip-dates')!, initialTrip, selected => {
  trip = selected;
  recompute(false);
});
const homeInput = document.querySelector<HTMLInputElement>('#home')!;
const nonstopInput = document.querySelector<HTMLInputElement>('#nonstop-only')!;
const temperatureMin = document.querySelector<HTMLInputElement>('#temperature-min')!;
const temperatureMax = document.querySelector<HTMLInputElement>('#temperature-max')!;
const warmerThanHomeInput = document.querySelector<HTMLInputElement>('#warmer-than-home')!;
const temperatureOnlyInput = document.querySelector<HTMLInputElement>('#temperature-only')!;
const weatherLayerSelect = document.querySelector<HTMLSelectElement>('#weather-layer')!;
const regionSelect = document.querySelector<HTMLSelectElement>('#destination-region')!;
const tooltip = document.querySelector<HTMLDivElement>('#tooltip')!;
const container = document.querySelector<HTMLElement>('#globe-container')!;
const spinButton = document.querySelector<HTMLButtonElement>('#spin')!;
const unitButton = document.querySelector<HTMLButtonElement>('#units')!;
const destinationList = document.querySelector<HTMLDivElement>('#destination-list')!;
const showMoreDestinations = document.querySelector<HTMLButtonElement>('#show-more-destinations')!;
const detailsDialog = document.querySelector<HTMLDialogElement>('#details-dialog')!;
const panels = setupPanels(container);
const prioritiesToggle = document.querySelector<HTMLButtonElement>('#toggle-priorities')!;
const prioritiesBody = document.querySelector<HTMLElement>('#priorities-body')!;
function showPriorities(open: boolean): void {
  if (!open && prioritiesBody.contains(document.activeElement)) prioritiesToggle.focus();
  prioritiesBody.hidden = !open;
  prioritiesToggle.setAttribute('aria-expanded', String(open));
}
prioritiesToggle.addEventListener('click', () => showPriorities(prioritiesBody.hidden));
showPriorities(false);


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
  cityHover: (r, x, y) => showTooltip(cityTooltip(r, unit), `city-${r.city.name}-${unit}`, x, y),
  countryHover: (country, x, y) => showTooltip(countryTooltip(country, ranked), `country-${country.name}`, x, y),
  citySelected: r => selectDestination(r, false), hideTooltip,
  routeSelected: map => {
    const destination = map.destinations.find(city => city.name === selectedName) ?? map.destinations[0];
    const result = nonstopCityScores.find(item => item.city.name === destination.name);
    if (result) selectDestination(result, true, true);
  },
  spinChanged: spinning => {
    document.querySelector('#spin-text')!.textContent = spinning ? 'Pause spin' : 'Spin';
    document.querySelector('#spin-icon')!.innerHTML = spinning ? icon('<path d="M9 5v14M15 5v14"/>') : icon('<path d="m9 5 10 7-10 7Z"/>');
    spinButton.setAttribute('aria-pressed', String(spinning));
    spinButton.setAttribute('aria-label', spinning ? 'Pause spin' : 'Spin globe');
  },
});

function renderPick(r: RankedCity): string {
  const rating = band(r.score);
  const route = rankingRouteLabel(r.travel);
  const sources = escapeHtml(weatherSourceSummary(r));
  const activity = escapeHtml(destinationActivity(r));
  return `<button type="button" class="pick-row${selectedName === r.city.name ? ' selected' : ''}" data-city="${escapeHtml(r.city.name)}" aria-pressed="${selectedName === r.city.name}" aria-label="${escapeHtml(destinationName(r.city))}, ${rating.label}. ${activity} ${sources}. ${climateLabel(r.climate)}.${r.weatherFlags.length ? ` Seasonal weather: ${escapeHtml(r.weatherFlags.map(weatherFlagLabel).join(", "))}.` : ""}${route ? ` ${escapeHtml(route)}.` : ''} Center on globe."><span class="pick-heading"><span class="pick-place"><strong class="city-name">${escapeHtml(destinationName(r.city))}</strong><span class="country-name"><span class="country-flag" aria-hidden="true">${countryFlag(r.city.country)}</span>${escapeHtml(displayCountry(r.city.country))}${r.climate.referenceLabel ? ` · ${escapeHtml(r.climate.referenceLabel)}` : ''}</span></span><span class="rating ${rating.key}">${rating.label}</span></span><span class="pick-facts"><span>${temperature(r.high, unit)}</span></span><span class="pick-activity">${activity}</span>${weatherBadges(r.weatherFlags.slice(0, 2))}${route ? `<span class="pick-route${r.travel.basis !== 'routes' ? ' route-estimate' : ''}">${escapeHtml(route)}</span>` : ''}${r.weatherDates.forecast.length ? `<span class="weather-coverage">${sources}</span>` : ''}</button>`;
}

function renderLists(): void {
  document.querySelector<HTMLElement>('.results-note')!.hidden = ranked.length === 0;
  document.querySelector('.results-note')!.textContent = home.name === 'Boston'
    ? 'From Boston, picks with complete modeled journeys rank ahead of incomplete estimates. Flight schedules are unverified.'
    : 'Select a destination to inspect its score.';
  const scopeLabel = [selectedRegionName(), scope === 'all' ? '' : scopeNames[scope], nonstopOnly ? 'Nonstop flights' : '', temperatureOnly ? `${temperatureBound(appliedTemperature.min, unit)}–${temperatureBound(appliedTemperature.max, unit)} · 50%+ of highs in range` : '', warmerThanHome ? 'Warmer than home' : ''].filter(Boolean).join(' · ');
  document.querySelector<HTMLElement>('#summary-scope')!.hidden = !scopeLabel;
  document.querySelector('#summary-scope')!.textContent = scopeLabel;
  showMoreDestinations.hidden = ranked.length <= visibleResults;
  destinationList.innerHTML = ranked.slice(0, visibleResults).map(renderPick).join('');
  if (!ranked.length) destinationList.innerHTML = temperatureOnly
    ? `<div class="empty-results"><strong>No places meet your temperature filter</strong><p>Try a wider range or other dates. The filter requires at least half of estimated highs during your estimated stay to fall in range.</p><button type="button" class="small-button" data-clear-temperature>Show all temperatures</button></div>`
    : warmerThanHome
    ? `<div class="empty-results"><strong>No matching places warmer than home</strong><p>Try other dates or turn off the warmer-than-home filter.</p><button type="button" class="small-button" data-clear-warmer>Turn off warmer than home</button></div>`
    : nonstopOnly
    ? `<div class="empty-results"><strong>No nonstop flights in this view</strong><p>For these dates, no destination fits your filters with time on the ground and a listed nonstop in each direction.</p><button type="button" class="small-button" data-clear-flights>Show all flight routes</button></div>`
    : selectedRegion !== 'all'
    ? `<div class="empty-results"><strong>No matching destinations in ${escapeHtml(selectedRegionName())}</strong><p>Try another region or adjust your destination filters.</p><button type="button" class="small-button" data-clear-region>Show all regions</button></div>`
    : `<div class="empty-results"><strong>No ${scope === 'all' ? 'matching' : scopeNames[scope].toLowerCase()} destinations</strong><p>Try a longer trip or adjust your destination filters. Recommendations require some estimated time at the destination.</p><button type="button" class="small-button" data-clear-scope>Show all destinations</button></div>`;
}
function selectedDestination(): CityScore | undefined {
  const result = cityScores.find(item => item.city.name === selectedName);
  return result && selectedNonstopRoute ? nonstopCityScores.find(item => item.city.name === selectedName) ?? result : result;
}
function renderWeatherControls(): void {
  const legend = weatherLegend(weatherLayer, unit), target = document.querySelector<HTMLElement>('#weather-legend')!;
  target.hidden = !legend.items.length;
  target.classList.toggle('scale-legend', weatherLayer === 'temperature' || weatherLayer === 'wet');
  target.innerHTML = `<strong>${escapeHtml(legend.title)}</strong><div class="weather-legend-items">${legend.items.map(item => `<span><i style="--weather-color:${item.color}"></i>${escapeHtml(item.label)}</span>`).join('')}</div><p>${escapeHtml(legend.note)}</p>`;
}
function renderSelection(): void {
  const result = selectedDestination();
  const selection = document.querySelector<HTMLElement>('#selection')!;
  selection.hidden = !result;
  renderFlightMap(result);
  if (!result) return;
  selection.style.setProperty('--swatch', band(result.score).color);
  document.querySelector('#selected-name')!.textContent = destinationName(result.city);
  document.querySelector('#selected-summary')!.textContent = `${displayCountry(result.city.country)} · ${temperature(result.high, unit)}`;
  document.querySelector('#selected-weather')!.textContent = result.weatherFlags.map(weatherFlagLabel).join(' · ');
  document.querySelector('#details-content')!.innerHTML = cityTooltip(result, unit) + weatherDetails(result, unit) + flightDetails(result.travel) + scoreBreakdown(result, unit);
}
function renderFlightMap(result?: CityScore): void {
  const panel = document.querySelector<HTMLElement>('#flight-map-controls')!;
  const map = result ? flightMapFor(result.travel, routeDirection) : null;
  globe.setRoute(map);
  panel.hidden = home.name !== 'Boston' || !result || (!map && !flightMapFor(result.travel, routeDirection === 'outbound' ? 'inbound' : 'outbound'));
  if (panel.hidden) return;
  const selectedRoute = document.querySelector<HTMLElement>('#selected-flight-route')!;
  selectedRoute.hidden = false;
  document.querySelector('#flight-map-path')!.textContent = map?.label ?? 'No flight route recorded';
  document.querySelector('#flight-map-note')!.textContent = map ? 'Highlighted flight legs · schedules unverified' : 'Coverage incomplete for this direction';
  document.querySelector('#flight-map-details')!.innerHTML = map ? flightRouteDetails(result!.travel.flights?.[routeDirection]?.route) : '';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-route-direction]')) {
    const direction = button.dataset.routeDirection as FlightDirection;
    button.setAttribute('aria-pressed', String(direction === routeDirection));
    button.disabled = !flightMapFor(result!.travel, direction);
  }
  document.querySelector<HTMLButtonElement>('#view-flight-route')!.disabled = !map;
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-route-direction]')) button.addEventListener('click', () => {
  routeDirection = button.dataset.routeDirection as FlightDirection;
  renderFlightMap(selectedDestination());
  globe.fitFlightRoute();
});
document.querySelector('#view-flight-route')!.addEventListener('click', () => globe.fitFlightRoute());
function selectDestination(result: CityScore, fly = true, preferNonstop = false): void {
  const fromRegion = document.querySelector('#region-explorer')!.contains(document.activeElement);
  selectedName = result.city.name; hideTooltip();
  selectedNonstopRoute = preferNonstop;
  routeDirection = 'outbound';
  if (!fromRegion) activeRegion = '';
  renderRegion();
  globe.setSelected(selectedName);
  for (const button of document.querySelectorAll<HTMLButtonElement>('.pick-row')) {
    const selected = button.dataset.city === selectedName;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
  panels.closeDrawer(); renderSelection();
  if (preferNonstop && flightMapFor(result.travel, routeDirection)) globe.fitFlightRoute();
  else if (fly) globe.flyTo(result.city.lon, result.city.lat);
  if (fromRegion) document.querySelector<HTMLButtonElement>('#view-flight-route:not(:disabled)')?.focus();
}
function selectedRegionName(): string {
  return GLOBE_REGIONS.find(region => region.id === selectedRegion)?.name ?? '';
}
function focusGlobe(initial = false): void {
  const region = GLOBE_REGIONS.find(item => item.id === selectedRegion);
  if (region) globe.focusLocation(region.lon, region.lat, region.zoom, initial);
  else globe.focusLocation(home.lon, home.lat, initial ? 1.15 : .98, initial);
}
regionSelect.addEventListener('change', () => {
  activeRegion = '';
  recompute(true);
});

function recompute(shouldFly: boolean): void {
  const nextScope = document.querySelector<HTMLInputElement>('[name="destination-scope"]:checked')!.value as DestinationScope;
  const global = nextScope === 'international';
  regionSelect.closest<HTMLElement>('.region-filter')!.hidden = !global;
  if (!global) regionSelect.value = 'all';
  const temperatureError = validateTemperature(preferredTemperature);
  const temperatureErrorElement = document.querySelector<HTMLElement>('#temperature-error')!;
  temperatureErrorElement.hidden = !temperatureError; temperatureErrorElement.textContent = temperatureError ?? '';
  temperatureMin.setAttribute('aria-invalid', String(Boolean(temperatureError)));
  temperatureMax.setAttribute('aria-invalid', String(Boolean(temperatureError)));
  document.querySelector<HTMLElement>('#invalid-summary')!.hidden = !temperatureError;
  if (temperatureError) return;
  const forecastStatus = document.querySelector('#forecast-status')!;
  const nearTerm = needsForecast(trip, new Date());
  if (nearTerm && Date.now() >= forecastExpires && !forecastPending) {
    forecastPending = true;
    forecasts = undefined;
    void loadForecast([...ORIGINS, ...CITIES]).then(result => {
      forecasts = result;
      forecastExpires = Date.now() + (result.size ? 30 : 5) * 60_000;
      forecastPending = false;
      recompute(false);
    });
  }
  const tripForecasts = nearTerm ? forecasts : undefined;
  forecastStatus.innerHTML = nearTerm
    ? forecastPending ? 'Loading forecasts. Showing historical climate meanwhile.'
      : tripForecasts?.size ? `Forecasts by <a href="${FORECAST_SOURCE}" target="_blank" rel="noopener noreferrer">Open-Meteo</a> where available.`
        : 'Forecast unavailable. Showing historical climate.'
    : '';
  forecastStatus.toggleAttribute('hidden', !nearTerm);
  globe.setWeatherTrip(trip);
  const homeChanged = home !== chosenHome;
  const regionChanged = selectedRegion !== regionSelect.value;
  selectedRegion = regionSelect.value as DestinationRegionFilter;
  home = chosenHome; hideTooltip();
  document.querySelector('#origin-detail')!.textContent = home.name === 'Boston' ? 'Boston Logan · BOS' : displayCountry(home.country);
  document.querySelector<HTMLElement>('#boston-flight-filter')!.hidden = home.name !== 'Boston';
  nonstopOnly = home.name === 'Boston' && nonstopInput.checked;
  temperatureOnly = temperatureOnlyInput.checked;
  warmerThanHome = warmerThanHomeInput.checked;
  Object.assign(appliedTemperature, preferredTemperature);
  scope = nextScope;
  allCityScores = scoreCities(trip, home, weights, preferredTemperature, false, tripForecasts);
  const nonstopCandidates = home.name === 'Boston' ? scoreCities(trip, home, weights, preferredTemperature, true, tripForecasts) : [];
  const candidates = nonstopOnly ? nonstopCandidates : allCityScores;
  const inScope = (result: CityScore) => isRankableCity(result) && matchesDestinationScope(result.city.country, home.country, scope)
    && matchesDestinationRegion(result.city, selectedRegion)
    && matchesTemperaturePreferences(result, temperatureOnly, warmerThanHome);
  const eligible = (result: CityScore) => inScope(result) && (!nonstopOnly || isNonstopBostonTrip(result.travel));
  cityScores = candidates.filter(eligible);
  nonstopCityScores = nonstopCandidates.filter(inScope);
  nonstopMaps = nonstopFlightMaps(nonstopCityScores);
  globe.setNonstopRoutes(nonstopMaps);
  ranked = rankCities(cityScores);
  const samples = sampleDays(trip), duration = `${samples.tripDays} ${samples.tripDays === 1 ? 'day' : 'days'}`;
  const dateLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  document.querySelector('#trip-length')!.textContent = duration;
  document.querySelector('#summary-origin')!.textContent = `From ${home.name}`;
  document.querySelector('#summary-dates')!.textContent = `${dateLabel(trip.start)} – ${dateLabel(trip.end)}`;
  document.querySelector('#summary-duration')!.textContent = duration;
  if (shouldFly || homeChanged || regionChanged || !cityScores.some(result => result.city.name === selectedName)) selectedName = null;
  if (activeRegion && !cityScores.some(result => result.city.region === activeRegion)) activeRegion = '';
  renderLists(); renderSelection(); renderRegion(); renderWeatherControls(); globe.update(cityScores, ranked, home); globe.setSelected(selectedName);
  document.querySelector('#results-announcement')!.textContent = ranked.length
    ? `${ranked.length} matching destinations from ${home.name}.`
    : `No matching destinations from ${home.name}.`;
  if (homeChanged) globe.focusLocation(home.lon, home.lat, 1.15);
  else if (shouldFly || regionChanged) focusGlobe();
}
for (const control of document.querySelectorAll<HTMLInputElement>('[name="destination-scope"]')) control.addEventListener('change', () => {
  recompute(true);
});
setupOriginSearch(homeInput, document.querySelector('#origin-suggestions')!, ORIGINS, home, origin => {
  chosenHome = origin;
  activeRegion = '';
  recompute(true);
});
nonstopInput.addEventListener('change', () => recompute(true));
temperatureOnlyInput.addEventListener('change', () => recompute(false));
warmerThanHomeInput.addEventListener('change', () => recompute(false));
weatherLayerSelect.addEventListener('change', () => {
  weatherLayer = weatherLayerSelect.value as WeatherLayer;
  hideTooltip(); globe.setWeatherLayer(weatherLayer); renderWeatherControls();
});
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
  syncTemperaturePresets();
}
function syncTemperaturePresets(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-temperature-preset]')) {
    const preset = temperaturePresets[button.dataset.temperaturePreset as keyof typeof temperaturePresets];
    button.setAttribute('aria-pressed', String(Math.abs(preferredTemperature.min - preset.min) < 1e-8 && Math.abs(preferredTemperature.max - preset.max) < 1e-8));
    button.title = `${temperatureBound(preset.min, unit)}–${temperatureBound(preset.max, unit)}`;
  }
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-temperature-preset]')) button.addEventListener('click', () => {
  Object.assign(preferredTemperature, temperaturePresets[button.dataset.temperaturePreset as keyof typeof temperaturePresets]);
  syncTemperature(); recompute(false);
});
for (const [key, input] of [['min', temperatureMin], ['max', temperatureMax]] as const) input.addEventListener('input', () => {
  preferredTemperature[key] = unit === 'F' ? (input.valueAsNumber - 32) * 5 / 9 : input.valueAsNumber;
  syncTemperaturePresets();
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
  temperatureOnlyInput.checked = false;
  warmerThanHomeInput.checked = false;
  syncWeights(); syncTemperature(); recompute(false);
});
spinButton.addEventListener('click', () => globe.toggleSpin());
document.querySelector('#zoom-in')!.addEventListener('click', () => globe.zoom(1.2));
document.querySelector('#zoom-out')!.addEventListener('click', () => globe.zoom(1 / 1.2));
document.querySelector('#reset-view')!.addEventListener('click', () => activeRegion ? fitRegion() : focusGlobe());
unitButton.addEventListener('click', () => {
  unit = unit === 'F' ? 'C' : 'F';
  unitButton.innerHTML = `<span class="${unit === 'F' ? 'unit-active' : ''}">°F</span><span class="unit-divider">/</span><span class="${unit === 'C' ? 'unit-active' : ''}">°C</span>`;
  unitButton.setAttribute('aria-label', `Temperature unit: ${unit === 'F' ? 'Fahrenheit. Switch to Celsius.' : 'Celsius. Switch to Fahrenheit.'}`);
  syncTemperature(); hideTooltip(); renderLists(); renderSelection(); renderRegion(); renderWeatherControls();
});
destinationList.addEventListener('click', event => {
  if ((event.target as Element).closest('[data-clear-region]')) {
    regionSelect.value = 'all'; recompute(true);
    destinationList.querySelector<HTMLButtonElement>('.pick-row')?.focus();
    return;
  }
  const clearTemperature = (event.target as Element).closest('[data-clear-temperature], [data-clear-warmer]');
  if (clearTemperature) {
    if (clearTemperature.hasAttribute('data-clear-warmer')) warmerThanHomeInput.checked = false;
    else temperatureOnlyInput.checked = false;
    recompute(false);
    destinationList.querySelector<HTMLButtonElement>('.pick-row')?.focus();
    return;
  }
  if ((event.target as Element).closest('[data-clear-flights]')) {
    nonstopInput.checked = false; recompute(true);
    destinationList.querySelector<HTMLButtonElement>('.pick-row')?.focus();
    return;
  }
  if (!(event.target as Element).closest('[data-clear-scope]')) return;
  document.querySelector<HTMLInputElement>('[name="destination-scope"][value="all"]')!.checked = true;
  recompute(true);
  destinationList.querySelector<HTMLButtonElement>('.pick-row')?.focus();
});
function resultForTarget(target: EventTarget | null): CityScore | undefined {
  const card = (target as Element | null)?.closest<HTMLButtonElement>('[data-city]');
  return cityScores.find(r => r.city.name === card?.dataset.city);
}
destinationList.addEventListener('click', event => {
  const result = resultForTarget(event.target);
  if (result) selectDestination(result);
});
showMoreDestinations.addEventListener('click', () => {
  const previousCount = visibleResults;
  visibleResults += resultsPageSize;
  destinationList.insertAdjacentHTML('beforeend', ranked.slice(previousCount, visibleResults).map(renderPick).join(''));
  showMoreDestinations.hidden = ranked.length <= visibleResults;
  (destinationList.children[previousCount] as HTMLButtonElement | undefined)?.focus();
});
const regionExplorer = document.querySelector<HTMLElement>('#region-explorer')!;
const regionsDialog = document.querySelector<HTMLDialogElement>('#regions-dialog')!;
function renderRegion(): void {
  const panel = document.querySelector<HTMLElement>('#region-explorer')!;
  const focusedCity = panel.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.city : undefined;
  panel.hidden = !activeRegion;
  const selected = cityScores.find(result => result.city.name === selectedName);
  panel.classList.toggle('route-selected', Boolean(selected && flightMapFor(selected.travel, routeDirection)));
  if (!activeRegion) return;
  const places = rankCities(cityScores.filter(result => result.city.region === activeRegion));
  panel.innerHTML = `<div class="region-heading"><strong>${escapeHtml(activeRegion)}</strong><button type="button" class="text-button" data-region-fit>View region</button><button type="button" class="icon-button" data-region-close aria-label="Close regional places">${closeIcon}</button></div><div class="region-places">${places.map(result => `<button type="button" data-city="${escapeHtml(result.city.name)}" aria-pressed="${result.city.name === selectedName}"><strong><i class="swatch" style="--swatch:${band(result.score).color}"></i>${escapeHtml(destinationName(result.city))}</strong><span>${band(result.score).label} · ${temperature(result.high, unit)}</span><small>${climateLabel(result.climate)}</small>${climateResolutionLabel(result.climate) ? `<small class="resolution-flag">${climateResolutionLabel(result.climate)}</small>` : ''}</button>`).join('')}</div><p>${places.length ? `Separate reference points. ${activeRegion === 'Maldives' ? 'Island comparisons, not an inland/coastal split. Small islands may be absent from the basemap. ' : ''}Grid estimates cannot establish local beach, slope or neighborhood differences. Crowd estimates are shared across the region.` : 'No places in this region match your destination filter.'}</p>`;
  if (focusedCity) [...panel.querySelectorAll<HTMLButtonElement>('[data-city]')].find(button => button.dataset.city === focusedCity)?.focus();
}
function fitRegion(): void {
  const places = cityScores.filter(result => result.city.region === activeRegion);
  if (places.length) globe.fitPlaces(places);
}
document.querySelector('#explore-regions')!.addEventListener('click', () => { hideTooltip(); panels.closeDrawer(); regionsDialog.showModal(); });
regionsDialog.addEventListener('click', event => {
  const region = (event.target as Element).closest<HTMLElement>('[data-region]')?.dataset.region;
  if (!region) return;
  activeRegion = region; selectedName = null; globe.setSelected(null); renderLists(); renderSelection();
  regionsDialog.close(); renderRegion(); fitRegion();
  regionExplorer.querySelector<HTMLButtonElement>('[data-city]')?.focus();
});
regionExplorer.addEventListener('click', event => {
  const target = event.target as Element;
  if (target.closest('[data-region-close]')) { activeRegion = ''; renderRegion(); focusGlobe(); document.querySelector<HTMLButtonElement>('#explore-regions')!.focus(); return; }
  if (target.closest('[data-region-fit]')) {
    selectedName = null; globe.setSelected(null); renderLists(); renderSelection(); renderRegion(); fitRegion();
    regionExplorer.querySelector<HTMLButtonElement>('[data-region-fit]')?.focus();
    return;
  }
  const result = resultForTarget(target);
  if (result) selectDestination(result);
});
document.querySelector('#clear-selection')!.addEventListener('click', () => {
  selectedName = null; globe.setSelected(null); renderLists(); renderSelection(); renderRegion(); document.querySelector<SVGSVGElement>('#globe')!.focus();
  if (activeRegion) fitRegion(); else focusGlobe();
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
  document.querySelector('#details-content')!.innerHTML = cityTooltip(result, unit) + weatherDetails(result, unit) + flightDetails(result.travel) + scoreBreakdown(result, unit);
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
syncTemperaturePresets();
recompute(false);
window.setTimeout(() => focusGlobe(true), 600);
