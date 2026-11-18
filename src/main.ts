import { observeCardPrices, resetCardPrices } from './card-prices';
import { rankSeasonalAreas, seasonalArea, seasonalScore, seasonalTitle } from "./seasonal";
import { tripFromUrl } from './trip-date-feedback';
import destinationPhotos from './data/destination-photos.json';
import { countryFlag } from './data/destination-tips';
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
import { band, cityTooltip, countryTooltip, displayCountry, escapeHtml, flightDetails, flightRouteDetails, rankingRouteLabel, scoreBreakdown, temperature, tripPrice, weatherDetails, weatherSourceSummary } from './format';
import { Globe } from './globe';
import { isNonstopBostonTrip } from './flights';
import { flightMapFor, nonstopFlightMaps } from './flight-map';
import type { FlightDirection, NonstopFlightMap } from './flight-map';
import { methodContent } from './method';
import { setupPanels } from './panels';
import { AIRFARE_ENDPOINT, airfareAirports } from './airfare';
import type { AirfareOption } from './airfare';
import { LODGING_ENDPOINT, lodgingCountryCode } from './lodging';
import type { LodgingQuote } from './lodging';
import { clamp, DEFAULT_WEIGHTS, DEFAULT_TEMPERATURE, defaultTrip, isRankableCity, matchesDestinationScope, minimumUsableStay, rankCities, scoreCities } from './scoring';
import { weatherFlagLabel } from './weather';
import { weatherLegend, WEATHER_KINDS } from './weather-map';
import type { CityScore, DestinationScope, RankedCity, TripPriceEstimate, Unit, WeatherKind, WeatherLayer } from './types';

const photos: Readonly<Partial<Record<string, { image: string; author: string; license: string; url: string; licenseUrl: string }>>> = destinationPhotos;
const photoCredits = Object.entries(destinationPhotos).sort(([a], [b]) => a.localeCompare(b)).map(([city, photo]) =>
  `<li><a href="${escapeHtml(photo.url)}">${escapeHtml(city)}</a> · ${escapeHtml(photo.author)} · ${photo.licenseUrl ? `<a href="${escapeHtml(photo.licenseUrl)}">${escapeHtml(photo.license)}</a>` : escapeHtml(photo.license)}</li>`
).join('');
const app = document.querySelector<HTMLElement>('#app')!;
const initialTrip = tripFromUrl(new URL(location.href), defaultTrip(new Date()));
let trip = initialTrip;
const tripPrices = new Map<string, Map<string, TripPriceEstimate>>();
const airfareQuotes = new WeakMap<HTMLFormElement, AirfareOption[]>();
const nonstopFares = new Map<string, number>();
function nonstopFareKey(city: string): string {
  return JSON.stringify([home.name, trip.start, trip.end, city]);
}
function hasNonstopFare(city: string): boolean {
  return (nonstopFares.get(nonstopFareKey(city)) ?? 0) > Date.now();
}
const lodgingQuotes = new WeakMap<HTMLFormElement, LodgingQuote>();
function tripPriceKey(nonstop: boolean): string {
  return JSON.stringify([home.name, trip.start, trip.end, nonstop]);
}

let weatherLayer: WeatherLayer = 'temperature';
let weatherKinds = new Set<WeatherKind>(WEATHER_KINDS);
const weatherFlagLabels = { wet: 'Wet periods', heat: 'Heat', cold: 'Freezing nights', storm: 'Storm seasons' };
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
let forecasts: Forecasts | undefined;
let forecastPending = false;
let forecastExpires = 0;
let selectedName: string | null = null;
let activeRegion = '';
let activeTip = '';
const icon = (content: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
const closeIcon = icon('<path d="m6 6 12 12M18 6 6 18"/>');
const globeIcon = icon('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4.5" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>');

app.innerHTML = `
  <header class="app-header">
    <div class="brand"><span class="brand-icon">${globeIcon}</span><h1>Where to go, and when</h1></div>
    <div class="trip-summary">
      <h2 id="summary-route">From Boston</h2>
      <div class="trip-dates">${datePickerMarkup}</div>
      <span class="summary-scope" id="summary-scope" hidden></span>
    </div>
    <nav class="panel-toggles" aria-label="Explore controls">
      <button id="toggle-settings" class="panel-toggle" type="button" aria-label="Trip settings" title="Trip settings" aria-controls="settings-panel" aria-expanded="true">${icon('<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>')}</button>
      <button id="toggle-results" class="panel-toggle" type="button" aria-label="Destinations" title="Destinations" aria-controls="results-panel" aria-expanded="true">${icon('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>')}</button>
    </nav>
  </header>
  <section id="globe-container" class="workspace" aria-label="Vacation explorer">
    <aside id="settings-panel" class="side-panel settings-panel" aria-label="Trip settings">
      <button type="button" class="icon-button close-panel settings-close" data-close-panel aria-label="Close trip settings">${closeIcon}</button>
      <div class="panel-scroll settings-content">
        <h2 class="trip-panel-title">Trip settings</h2>
        <div class="field origin-field"><label for="home">Flying from</label><div class="origin-select">${icon('<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="m22 2-11 11"/>')}<input id="home" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="origin-suggestions" aria-describedby="origin-detail" autocomplete="off" spellcheck="false" placeholder="Search departure cities"><ul id="origin-suggestions" role="listbox" aria-label="Departure cities" hidden></ul></div><p id="origin-detail">Boston Logan · BOS</p></div>
        <fieldset class="destination-scope"><legend>Destination area</legend><div class="scope-options">${(['all', 'domestic', 'international'] as const).map(value => `<label class="scope-choice"><input type="radio" name="destination-scope" value="${value}" aria-label="${{ all: 'All destinations', domestic: 'Domestic destinations', international: 'Global destinations' }[value]}" ${value === 'all' ? 'checked' : ''} /><span>${{ all: 'Anywhere', domestic: 'Domestic', international: 'Global' }[value]}</span></label>`).join('')}</div></fieldset>
        <div class="field region-filter" hidden><label for="destination-region">Region</label><select id="destination-region"><option value="all">All regions</option>${GLOBE_REGIONS.map(region => `<option value="${region.id}">${region.name}</option>`).join('')}</select></div>
        <div id="boston-flight-filter" class="flight-filter"><label for="nonstop-only"><span class="flight-filter-copy"><strong id="nonstop-label">Nonstop flights only</strong><span id="nonstop-help">Round trip · confirm schedules</span></span><input type="checkbox" role="switch" id="nonstop-only" aria-labelledby="nonstop-label" aria-describedby="nonstop-help" /><span class="switch-track" aria-hidden="true"></span></label></div>

      </div>
    </aside>
    <section class="globe-stage" aria-label="Interactive destination globe">

      <section id="region-explorer" class="region-explorer" aria-label="Places in this region" hidden></section>

      <div class="globe-canvas"><svg id="globe" viewBox="0 0 760 520" tabindex="0" role="group" aria-label="Destination globe"></svg><div id="weather-legend" class="weather-legend" aria-label="Weather color legend"></div><div class="zoom-controls" aria-label="Globe zoom"><button class="icon-button" id="zoom-in" type="button" aria-label="Zoom in">${icon('<path d="M12 5v14M5 12h14"/>')}</button><button class="icon-button" id="zoom-out" type="button" aria-label="Zoom out">${icon('<path d="M5 12h14"/>')}</button><button class="icon-button reset-view" id="reset-view" type="button" aria-label="Reset globe view">${icon('<path d="M8 4H4v4m12-4h4v4M4 16v4h4m8 0h4v-4"/>')}</button></div></div>
      <div class="map-controls"><details class="map-toolbar">
        <summary>Weather<span aria-hidden="true"></span></summary>
        <div class="map-weather-options" id="map-weather-options" role="group" aria-label="Weather layers">
          <label><input type="checkbox" data-weather-surface="temperature" checked />Daytime temperature</label>
          <label><input type="checkbox" data-weather-surface="wet" />Precipitation</label>
          ${WEATHER_KINDS.map(kind => `<label><input type="checkbox" data-weather-kind="${kind}" checked />${weatherFlagLabels[kind]}</label>`).join('')}
        </div>
      </details><div class="stage-actions"><button id="spin" class="small-button spin-button" type="button" aria-pressed="true"><span id="spin-icon">${icon('<path d="M9 5v14M15 5v14"/>')}</span><span id="spin-text">Pause spin</span></button><button id="units" class="small-button unit-button" type="button" aria-label="Temperature unit: Fahrenheit. Switch to Celsius."><span class="unit-active">°F</span><span class="unit-divider">/</span><span>°C</span></button></div></div>
      <section id="flight-map-controls" class="flight-map-controls" aria-label="Boston flight routes" hidden>
        <div id="selected-flight-route" class="selected-flight-route" hidden><div class="flight-map-caption"><strong id="flight-map-path"></strong><span id="flight-map-note">Highlighted flight legs · schedules unverified</span></div><div class="flight-map-actions"><div class="route-directions" role="group" aria-label="Flight direction"><button type="button" id="route-outbound" data-route-direction="outbound" aria-pressed="true">Outbound</button><button type="button" id="route-inbound" data-route-direction="inbound" aria-pressed="false">Return</button></div><button type="button" id="view-flight-route" class="text-button">View route</button></div><div id="flight-map-details" class="flight-map-details" role="status" aria-live="polite" aria-atomic="true"></div></div>
      </section>
      <div id="selection" class="selection" hidden><span class="selection-dot"></span><div class="selection-copy"><strong id="selected-name"></strong><span id="selected-summary"></span><span id="selected-weather"></span></div><button id="selected-details" class="small-button" type="button" aria-haspopup="dialog">Why this score? ${icon('<path d="m9 5 7 7-7 7"/>')}</button><button id="clear-selection" class="icon-button" type="button" aria-label="Clear selected destination">${closeIcon}</button></div>
    </section>
    <aside id="results-panel" class="side-panel results-panel" aria-labelledby="destinations-title">
      <div class="panel-heading"><div><h2 id="destinations-title">Discover destinations</h2><p id="results-context"></p></div><button type="button" class="icon-button close-panel" data-close-panel aria-label="Close destinations">${closeIcon}</button></div>
      <div class="panel-scroll results-content">
        <p id="forecast-status" class="forecast-status" role="status"></p>
        <div id="destination-list" class="destination-list"></div>
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
  <dialog id="method-dialog" class="method-dialog" aria-labelledby="method-title"><button type="button" class="icon-button dialog-close" aria-label="Close scoring explanation">${closeIcon}</button>${methodContent}<details class="method-rules"><summary>Destination photo credits</summary><p>Thumbnails are cropped. Each image retains its listed license.</p><ul>${photoCredits}</ul></details></dialog>
`;

setupDatePicker(document.querySelector<HTMLElement>('.trip-dates')!, initialTrip, selected => {
  if (selected.start === trip.start && selected.end === trip.end) return;
  trip = selected;
  const url = new URL(location.href);
  url.searchParams.set('start', trip.start);
  url.searchParams.set('end', trip.end);
  history.replaceState(history.state, '', url);
  const positions = new Map(ranked.map((r, i) => [seasonalTitle(r), i]));
  recompute(false);
  const viewport = document.querySelector<HTMLElement>('.results-content')!;
  viewport.scrollTop = 0;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bottom = viewport.getBoundingClientRect().bottom;
  for (const [index, row] of [...destinationList.querySelectorAll<HTMLElement>('.pick-card')].entries()) {
    const rect = row.getBoundingClientRect();
    if (rect.top >= bottom) break;
    const old = positions.get(seasonalTitle(ranked[index]));
    if (old === index) continue;
    const offset = old === undefined ? 18 : clamp((old - index) * rect.height, -120, 120);
    row.animate([{ transform: `translateY(${offset}px)`, opacity: 0.35 }, { transform: 'translateY(0)', opacity: 1 }],
      { duration: 480, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }
});
const homeInput = document.querySelector<HTMLInputElement>('#home')!;
const nonstopInput = document.querySelector<HTMLInputElement>('#nonstop-only')!;
const weatherOptions = document.querySelector<HTMLElement>('#map-weather-options')!;
const weatherSurfaces = [...weatherOptions.querySelectorAll<HTMLInputElement>('[data-weather-surface]')];
const weatherFlags = [...weatherOptions.querySelectorAll<HTMLInputElement>('[data-weather-kind]')];
const regionSelect = document.querySelector<HTMLSelectElement>('#destination-region')!;
const tooltip = document.querySelector<HTMLDivElement>('#tooltip')!;
const container = document.querySelector<HTMLElement>('#globe-container')!;
const spinButton = document.querySelector<HTMLButtonElement>('#spin')!;
const unitButton = document.querySelector<HTMLButtonElement>('#units')!;
const destinationList = document.querySelector<HTMLDivElement>('#destination-list')!;
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

function otherBases(result: CityScore): string {
  const area = seasonalArea(result);
  if (!area) return '';
  const others = rankCities(cityScores.filter(r => seasonalArea(r) === area && r.city.name !== result.city.name));
  if (!others.length) return '';
  return `<section><h3>Other bases in ${escapeHtml(area)}</h3>${others.map(r => `<button type="button" class="small-button" data-city="${escapeHtml(r.city.name)}">${escapeHtml(destinationName(r.city))}</button>`).join(' ')}</section>`;
}
function renderPick(r: RankedCity): string {
  const rating = band(r.score);
  const photo = photos[r.city.name];
  const route = hasNonstopFare(r.city.name) ? 'Nonstop both ways · Nuitée' : rankingRouteLabel(r.travel);
  const sources = escapeHtml(weatherSourceSummary(r));
  return `<div class="pick-card"><button type="button" class="pick-row${selectedName === r.city.name ? ' selected' : ''}" data-city="${escapeHtml(r.city.name)}" aria-pressed="${selectedName === r.city.name}" aria-label="${escapeHtml(seasonalTitle(r))}, ${rating.label}. ${sources}. ${climateLabel(r.climate)}.${r.weatherFlags.length ? ` Seasonal weather: ${escapeHtml(r.weatherFlags.map(weatherFlagLabel).join(", "))}.` : ""}${route ? ` ${escapeHtml(route)}.` : ''} Center on globe.">${photo ? `<img class="pick-photo" loading="lazy" decoding="async" src="${photo.image}" alt="">` : ''}<span class="pick-copy"><span class="pick-heading"><span class="pick-place"><strong class="city-name">${escapeHtml(seasonalTitle(r))}</strong><span class="country-name"><span class="country-flag" aria-hidden="true">${countryFlag(r.city.country)}</span>${escapeHtml(displayCountry(r.city.country))}${seasonalTitle(r) !== destinationName(r.city) ? ` · ${escapeHtml(destinationName(r.city))}` : ''}</span></span><span class="rating ${rating.key}">${rating.label}</span></span><span class="pick-facts"><span>${temperature(r.high, unit)}</span>${r.tripCost ? `<span>${tripPrice(r.tripCost.total)} estimated trip</span>` : ''}</span>${route ? `<span class="pick-route${r.travel.basis !== 'routes' ? ' route-estimate' : ''}">${escapeHtml(route)}</span>` : ''}${r.weatherDates.forecast.length ? `<span class="weather-coverage">${sources}</span>` : ''}</span></button><div class="card-prices" aria-live="polite"></div></div>`;
}

function renderLists(): void {
  document.querySelector('#results-context')!.textContent = `${ranked.length} matches from ${home.name}`;
  const minimumStay = ranked[0] ? minimumUsableStay(ranked[0].tripDays) : 0;
  document.querySelector('.results-note')!.textContent = [
    minimumStay === 0.5 ? 'Day trips require at least half a day at the destination.'
      : minimumStay ? 'Short trips require at least one day at the destination.' : '',
    home.name === 'Boston' ? 'Missing routes use estimated travel time. Flight schedules are unverified.' : '',
  ].filter(Boolean).join(' ');
  document.querySelector<HTMLElement>('.results-note')!.hidden = !ranked.length || (!minimumStay && home.name !== 'Boston');
  const scopeLabel = [selectedRegionName(), scope === 'all' ? '' : scopeNames[scope], nonstopOnly ? 'Nonstop flights' : ''].filter(Boolean).join(' · ');
  document.querySelector<HTMLElement>('#summary-scope')!.hidden = !scopeLabel;
  document.querySelector('#summary-scope')!.textContent = scopeLabel;
  resetCardPrices();
  destinationList.innerHTML = ranked.map(renderPick).join('');
  ranked.forEach((city, index) => {
    const container = destinationList.children[index].querySelector<HTMLElement>('.card-prices')!;
    observeCardPrices(container, home.name, city.city.name, trip, city.travel.mode === 'flight', nonstopOnly);
  });
  if (!ranked.length) destinationList.innerHTML = nonstopOnly
    ? `<div class="empty-results"><strong>No nonstop flights in this view</strong><p>For these dates, no destination fits your filters with time on the ground and a listed nonstop in each direction.</p><button type="button" class="small-button" data-clear-flights>Show all flight routes</button></div>`
    : selectedRegion !== 'all'
    ? `<div class="empty-results"><strong>No matching destinations in ${escapeHtml(selectedRegionName())}</strong><p>Try another region or adjust your destination filters.</p><button type="button" class="small-button" data-clear-region>Show all regions</button></div>`
    : `<div class="empty-results"><strong>No ${scope === 'all' ? 'matching' : scopeNames[scope].toLowerCase()} destinations</strong><p>Try a longer trip or adjust your destination filters. Recommendations require enough estimated time at the destination for your trip length.</p><button type="button" class="small-button" data-clear-scope>Show all destinations</button></div>`;
}
function selectedDestination(): CityScore | undefined {
  const result = cityScores.find(item => item.city.name === selectedName);
  return result && selectedNonstopRoute ? nonstopCityScores.find(item => item.city.name === selectedName) ?? result : result;
}
function renderWeatherControls(): void {
  const legend = weatherLegend(weatherLayer, unit, weatherKinds), target = document.querySelector<HTMLElement>('#weather-legend')!;
  target.hidden = !legend.items.length;
  target.classList.toggle('scale-legend', weatherLayer === 'temperature' || weatherLayer === 'wet');
  target.innerHTML = `<strong>${escapeHtml(legend.title)}</strong><div class="weather-legend-items">${legend.items.map(item => `<span><i style="--weather-color:${item.color}"></i>${escapeHtml(item.label)}</span>`).join('')}</div><p>${escapeHtml(legend.note)}</p>`;
}
function renderSelection(): void {
  const result = selectedDestination();
  document.querySelector('#summary-route')!.textContent = result
    ? `${home.name} to ${destinationName(result.city)}`
    : `From ${home.name}`;
  const selection = document.querySelector<HTMLElement>('#selection')!;
  selection.hidden = !result;
  renderFlightMap(result);
  if (!result) return;
  selection.style.setProperty('--swatch', band(result.score).color);
  document.querySelector('#selected-name')!.textContent = destinationName(result.city);
  document.querySelector('#selected-summary')!.textContent = `${displayCountry(result.city.country)} · ${temperature(result.high, unit)}`;
  document.querySelector('#selected-weather')!.textContent = result.weatherFlags.map(weatherFlagLabel).join(' · ');
  const estimate = tripPrices.get(tripPriceKey(selectedNonstopRoute || nonstopOnly))?.get(result.city.name);
  const lookup = result.tripDays > 1 && lodgingCountryCode(result.city.name);
  const airfareLookup = result.travel.mode === 'flight' && airfareAirports(home.name, result.city.name, selectedNonstopRoute || nonstopOnly);
  const priceForm = `<form id="trip-price-form" class="trip-price-form">
    <h3>Trip cost estimate</h3>
    <p>Enter USD estimates for one traveler on these dates. Use 0 if there’s no airfare or lodging charge. Leave unknown prices blank.</p>
    <div class="trip-price-fields">
      <label>Round-trip airfare <input name="airfare" type="number" min="0" step="0.01" value="${estimate?.airfare ?? ''}" /></label>
      ${result.tripDays > 1 ? `<label>Lodging per night <input name="nightlyLodging" type="number" min="0" step="0.01" value="${estimate?.nightlyLodging?.toFixed(2) ?? ''}" /></label>` : ''}
    </div>
    <button type="submit" class="small-button">Apply estimate</button>
    <span id="trip-price-status" role="status"></span>
    ${estimate?.airfareSource === 'nuitee' ? '<p>Airfare uses a Nuitée fare estimate.</p>' : ''}
    ${airfareLookup ? `<div class="lodging-lookup">
      <button type="button" class="small-button" data-check-airfare>Check round-trip airfare</button>
      <p data-airfare-status role="status"></p>
      <div class="trip-price-fields" data-airfare-options hidden></div>
    </div>` : ''}
    ${estimate?.lodgingSource === 'nuitee' ? '<p>Lodging uses a Nuitée city estimate.</p>' : ''}
    ${lookup ? `<div class="lodging-lookup">
      <button type="button" class="small-button" data-check-lodging>Check lodging estimate</button>
      <p data-lodging-status role="status"></p>
      <button type="submit" class="small-button" data-use-lodging hidden>Use Nuitée estimate</button>
    </div>` : ''}
  </form>`;
  document.querySelector('#details-content')!.innerHTML = cityTooltip(result, unit) + weatherDetails(result, unit) + flightDetails(result.travel) + priceForm + scoreBreakdown(result, unit) + otherBases(result);
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
  else globe.focusLocation(home.lon, home.lat, 1, initial);
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
  scope = nextScope;
  allCityScores = scoreCities(trip, home, DEFAULT_WEIGHTS, DEFAULT_TEMPERATURE, false, tripForecasts, tripPrices.get(tripPriceKey(false))).map(seasonalScore);
  const nonstopCandidates = home.name === 'Boston' ? scoreCities(trip, home, DEFAULT_WEIGHTS, DEFAULT_TEMPERATURE, true, tripForecasts, tripPrices.get(tripPriceKey(true))).map(seasonalScore) : [];
  const candidates = nonstopOnly ? nonstopCandidates : allCityScores;
  const inScope = (result: CityScore) => isRankableCity(result) && matchesDestinationScope(result.city.country, home.country, scope)
    && matchesDestinationRegion(result.city, selectedRegion);
  const eligible = (result: CityScore) => inScope(result) && (!nonstopOnly || hasNonstopFare(result.city.name) || isNonstopBostonTrip(result.travel));
  cityScores = candidates.filter(eligible);
  nonstopCityScores = nonstopCandidates.filter(inScope);
  nonstopMaps = nonstopFlightMaps(nonstopCityScores);
  globe.setNonstopRoutes(nonstopMaps);
  ranked = rankSeasonalAreas(cityScores);
  if (shouldFly || homeChanged || regionChanged || !cityScores.some(result => result.city.name === selectedName)) selectedName = null;
  if (activeRegion && !cityScores.some(result => result.city.region === activeRegion)) activeRegion = '';
  renderLists(); renderSelection(); renderRegion(); renderWeatherControls(); globe.update(cityScores, ranked, home); globe.setSelected(selectedName);
  document.querySelector('#results-announcement')!.textContent = ranked.length
    ? `${ranked.length} matching destinations from ${home.name}.`
    : `No matching destinations from ${home.name}.`;
  if (homeChanged) globe.focusLocation(home.lon, home.lat, 1);
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
weatherOptions.addEventListener('change', event => {
  const changed = event.target as HTMLInputElement;
  if (changed.checked && changed.dataset.weatherSurface) {
    for (const surface of weatherSurfaces) if (surface !== changed) surface.checked = false;
  }
  weatherKinds = new Set(weatherFlags.filter(input => input.checked).map(input => input.dataset.weatherKind as WeatherKind));
  const surface = weatherSurfaces.find(input => input.checked)?.dataset.weatherSurface as 'temperature' | 'wet' | undefined;
  weatherLayer = surface ?? (weatherKinds.size ? 'all' : 'off');
  hideTooltip();
  globe.setWeatherLayer(weatherLayer, weatherKinds);
  renderWeatherControls();
});
spinButton.addEventListener('click', () => globe.toggleSpin());
document.querySelector('#zoom-in')!.addEventListener('click', () => globe.zoom(1.2));
document.querySelector('#zoom-out')!.addEventListener('click', () => globe.zoom(1 / 1.2));
document.querySelector('#reset-view')!.addEventListener('click', () => activeRegion ? fitRegion() : focusGlobe());
unitButton.addEventListener('click', () => {
  unit = unit === 'F' ? 'C' : 'F';
  unitButton.innerHTML = `<span class="${unit === 'F' ? 'unit-active' : ''}">°F</span><span class="unit-divider">/</span><span class="${unit === 'C' ? 'unit-active' : ''}">°C</span>`;
  unitButton.setAttribute('aria-label', `Temperature unit: ${unit === 'F' ? 'Fahrenheit. Switch to Celsius.' : 'Celsius. Switch to Fahrenheit.'}`);
  hideTooltip(); renderLists(); renderSelection(); renderRegion(); renderWeatherControls();
});
destinationList.addEventListener('click', event => {
  if ((event.target as Element).closest('[data-clear-region]')) {
    regionSelect.value = 'all'; recompute(true);
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
detailsDialog.addEventListener('click', async event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-check-lodging]');
  const form = button?.form;
  if (!button || !form || !selectedName) return;
  const { start, end } = trip;
  const city = selectedName;
  const status = form.querySelector<HTMLElement>('[data-lodging-status]')!;
  const use = form.querySelector<HTMLButtonElement>('[data-use-lodging]')!;
  const params = new URLSearchParams({ city, checkin: start, checkout: end });
  lodgingQuotes.delete(form);
  button.disabled = true;
  use.hidden = true;
  status.textContent = 'Checking Nuitée…';
  try {
    const response = await fetch(`${LODGING_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(10_000) });
    if (!form.isConnected || !detailsDialog.open || selectedName !== city || trip.start !== start || trip.end !== end) return;
    if (!response.ok) {
      status.textContent = response.status === 404 ? 'No complete lodging estimate for these dates.'
        : response.status === 429 ? 'Too many lodging lookups. Try again later.'
        : response.status === 400 ? 'Lookup supports stays of 1–30 nights within the next year.'
        : 'Lodging estimates are currently unavailable.';
      return;
    }
    const quote = await response.json() as LodgingQuote;
    if (!form.isConnected || !detailsDialog.open || selectedName !== city || trip.start !== start || trip.end !== end) return;
    if (!Number.isFinite(quote.total) || quote.total <= 0 || !Number.isFinite(quote.nightlyAverage) || quote.nightlyAverage <= 0 || quote.nights !== selectedDestination()!.tripDays - 1
      || !Number.isFinite(Date.parse(quote.retrievedAt))) throw new Error('Invalid lodging estimate');
    lodgingQuotes.set(form, quote);
    status.textContent = `Nuitée city estimate · ${tripPrice(quote.total)} for ${quote.nights} ${quote.nights === 1 ? 'night' : 'nights'} · ${tripPrice(quote.nightlyAverage)} per night on average. Checked ${new Date(quote.retrievedAt).toLocaleString()}.`;
    use.hidden = false;
  } catch {
    status.textContent = 'Lodging estimates are currently unavailable.';
  } finally {
    button.disabled = false;
  }
});
detailsDialog.addEventListener('click', async event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-check-airfare]');
  const form = button?.form;
  if (!button || !form || !selectedName) return;
  const city = selectedName;
  const nonstop = selectedNonstopRoute || nonstopOnly;
  const key = tripPriceKey(nonstop);
  const airports = airfareAirports(home.name, city, nonstop);
  if (!airports) return;
  const params = new URLSearchParams({ origin: home.name, city, start: trip.start, end: trip.end, nonstop: String(nonstop) });
  const status = form.querySelector<HTMLElement>('[data-airfare-status]')!;
  const results = form.querySelector<HTMLElement>('[data-airfare-options]')!;
  const current = () => form.isConnected && detailsDialog.open && selectedName === city && key === tripPriceKey(selectedNonstopRoute || nonstopOnly);
  airfareQuotes.delete(form);
  button.disabled = true;
  results.hidden = true;
  results.replaceChildren();
  status.textContent = `Checking ${airports.from} ↔ ${airports.to}${nonstop ? ' · nonstop only' : ''}…`;
  try {
    const response = await fetch(`${AIRFARE_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(18_000) });
    if (!current()) return;
    if (!response.ok) {
      status.textContent = response.status === 404 ? `No matching ${nonstop ? 'nonstop ' : ''}round-trip fares found.`
        : response.status === 429 ? 'Too many airfare lookups. Try again later.'
        : response.status === 400 ? 'Airfare lookup supports dates within the next 11 months.'
        : 'Airfare estimates are currently unavailable.';
      return;
    }
    const { options, nonstopValidUntil } = await response.json() as { options: AirfareOption[]; nonstopValidUntil: number };
    if (!current()) return;
    if (nonstopValidUntil > Date.now()) {
      nonstopFares.set(nonstopFareKey(city), nonstopValidUntil);
      renderLists();
    }
    airfareQuotes.set(form, options);
    const stops = (count: number) => count === 0 ? 'nonstop' : `${count} ${count === 1 ? 'stop' : 'stops'}`;
    for (const [index, option] of options.entries()) {
      const card = document.createElement('div');
      const heading = document.createElement('strong');
      heading.textContent = option.kind === 'both' ? 'Lowest fare · shortest trip' : option.kind === 'lowest' ? 'Lowest fare' : 'Shortest trip';
      const price = document.createElement('p');
      price.textContent = `${tripPrice(option.total)} round trip · ${Math.floor(option.minutes / 60)}h ${option.minutes % 60}m total · ${stops(option.outboundStops)} out, ${stops(option.returnStops)} back`;
      const apply = document.createElement('button');
      apply.type = 'submit';
      apply.className = 'small-button';
      apply.dataset.useAirfare = String(index);
      apply.textContent = 'Use fare';
      apply.setAttribute('aria-label', `Use fare · ${heading.textContent}`);
      card.append(heading, price, apply);
      results.append(card);
    }
    results.hidden = false;
    status.textContent = `${airports.from} ↔ ${airports.to} · 1 adult in economy. Fare estimates can change.`;
  } catch {
    if (current()) status.textContent = 'Airfare estimates are currently unavailable.';
  } finally {
    button.disabled = false;
  }
});
detailsDialog.addEventListener('submit', event => {
  const form = event.target as HTMLFormElement;
  if (form.id !== 'trip-price-form' || !selectedName) return;
  event.preventDefault();
  const readPrice = (name: string) => {
    const input = form.elements.namedItem(name) as HTMLInputElement | null;
    const value = input?.valueAsNumber;
    return value !== undefined && Number.isFinite(value) ? value : undefined;
  };
  const key = tripPriceKey(selectedNonstopRoute || nonstopOnly);
  const prices = tripPrices.get(key) ?? new Map<string, TripPriceEstimate>();
  const previous = prices.get(selectedName);
  const submitter = (event as SubmitEvent).submitter;
  const fareIndex = submitter?.getAttribute('data-use-airfare');
  const fare = fareIndex != null ? airfareQuotes.get(form)?.[Number(fareIndex)] : undefined;
  if (fareIndex != null && (!fare || (fare.expiresAt && Date.parse(fare.expiresAt) <= Date.now()))) {
    form.querySelector('[data-airfare-status]')!.textContent = 'This fare expired. Check airfare again.';
    return;
  }
  const useQuote = submitter?.hasAttribute('data-use-lodging');
  const quote = useQuote ? lodgingQuotes.get(form) : undefined;
  if (useQuote && !quote) return;
  const enteredLodging = readPrice('nightlyLodging');
  const keepNuitee = previous?.lodgingSource === 'nuitee'
    && enteredLodging === Number(previous.nightlyLodging?.toFixed(2));
  const enteredAirfare = readPrice('airfare');
  prices.set(selectedName, {
    airfare: fare?.total ?? enteredAirfare,
    airfareSource: fare || (previous?.airfareSource === 'nuitee' && previous.airfare === enteredAirfare) ? 'nuitee' : undefined,
    nightlyLodging: quote?.nightlyAverage ?? (keepNuitee ? previous?.nightlyLodging : enteredLodging),
    lodgingSource: quote || keepNuitee ? 'nuitee' : undefined,
  });
  tripPrices.set(key, prices);
  recompute(false);
  document.querySelector<HTMLButtonElement>('#trip-price-form button')?.focus({ preventScroll: true });
  const priceStatus = document.querySelector('#trip-price-status');
  if (priceStatus) priceStatus.textContent = selectedDestination()?.tripCost
    ? 'Estimate applied.' : 'Score unchanged until you enter both costs.';
});
detailsDialog.addEventListener('click', event => {
  const base = resultForTarget(event.target);
  if (base) selectDestination(base);
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
recompute(false);
window.setTimeout(() => focusGlobe(true), 600);
