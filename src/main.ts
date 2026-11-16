import './style.css';
import { ORIGINS } from './data/origins';
import { band, BANDS, cityTooltip, countryTooltip, displayCountry, escapeHtml, hours, reason, temperature } from './format';
import { Globe, MAP_COUNTRIES } from './globe';
import { clamp, DEFAULT_WEIGHTS, defaultTrip, rankCities, sampleDays, scoreCities, scoreCountry, validateTrip } from './scoring';
import type { CityScore, CountryScore, RankedCity, Trip, Unit, Weights } from './types';

const app = document.querySelector<HTMLElement>('#app')!;
const initialTrip = defaultTrip(new Date());
const weights: Weights = { ...DEFAULT_WEIGHTS };
let home = ORIGINS[0];
let unit: Unit = 'F';
let cityScores: CityScore[] = [];
let ranked: RankedCity[] = [];
let activeTip = '';
const preferences: { key: keyof Weights; label: string; icon: string }[] = [
  { key: 'weather', label: 'Weather fit', icon: '<circle cx="10" cy="10" r="3.5"/><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.6 3.6 5 5m10 10 1.4 1.4M3.6 16.4 5 15M15 5l1.4-1.4"/>' },
  { key: 'dry', label: 'Dry', icon: '<path d="M10 2C8 5 4.5 8.5 4.5 12a5.5 5.5 0 0 0 11 0C15.5 8.5 12 5 10 2Z"/>' },
  { key: 'crowds', label: 'Few crowds', icon: '<circle cx="7" cy="6" r="2.5"/><path d="M2 17v-2a5 5 0 0 1 10 0v2M14 4a2.5 2.5 0 0 1 0 5m1 3a4 4 0 0 1 3 4v1"/>' },
  { key: 'travel', label: 'Short travel', icon: '<circle cx="10" cy="10" r="7.5"/><path d="M10 5v5l3 2"/>' },
];

app.innerHTML = `
  <header class="page-header">
    <div class="heading-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4.5" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/></svg></div>
    <h1>Where to go, and when</h1>
    <p class="subtitle">Dots are 71 popular destinations, scored for your dates, your home city, and your trip length. Countries are shaded with a broader estimate. Hover for details, click to center.</p>
  </header>
  <section class="preferences" aria-label="Your trip preferences">
    <div class="trip-fields">
      <div class="field home-field"><label for="home">Home city</label><select id="home">${ORIGINS.map(origin => `<option value="${escapeHtml(origin.name)}">${escapeHtml(origin.name)}</option>`).join('')}</select></div>
      <div class="date-fields">
        <div class="field"><label for="start">From</label><input type="date" id="start" value="${initialTrip.start}" aria-describedby="date-error" /></div>
        <span class="date-arrow" aria-hidden="true">→</span>
        <div class="field"><label for="end">to</label><input type="date" id="end" value="${initialTrip.end}" aria-describedby="date-error" /></div>
        <output id="trip-length" class="trip-length" for="start end">15 days</output>
      </div>
    </div>
    <p id="date-error" class="date-error" role="alert" hidden></p>
    <div class="preference-divider"></div>
    <div class="weights">${preferences.map(({ key, label, icon }) => `
      <div class="weight"><div class="weight-heading"><label for="weight-${key}"><svg viewBox="0 0 20 20" aria-hidden="true">${icon}</svg>${label}</label><output for="weight-${key}" id="value-${key}">${weights[key]}</output></div>
        <input id="weight-${key}" data-weight="${key}" type="range" min="0" max="10" step="1" value="${weights[key]}" style="--progress:${weights[key] * 10}%" />
      </div>`).join('')}
    </div>
  </section>
  <section class="top-picks" aria-labelledby="top-title">
    <div class="section-heading"><h2 id="top-title">Your top 5 for these dates</h2><span id="ranking-context" class="section-note"></span></div>
    <div id="top-list" class="top-list"></div>
    <p id="rank-announcement" class="sr-only" role="status" aria-live="polite"></p>
  </section>
  <section id="globe-container" class="exploration" aria-label="Explore your destinations">
    <div class="globe-card">
      <div class="globe-toolbar"><span class="globe-caption"><span class="tiny-globe" aria-hidden="true">◎</span> A world of possibilities</span><div class="globe-buttons"><button type="button" id="spin" class="small-button" aria-pressed="true">Pause spin</button><button type="button" id="units" class="small-button unit-button" aria-label="Temperature unit: Fahrenheit. Switch to Celsius."><span class="unit-active">°F</span><span class="unit-divider">/</span><span>°C</span></button></div></div>
      <svg id="globe" viewBox="0 0 760 520" tabindex="0" role="group" aria-label="Interactive vacation globe. Use arrow keys to rotate, plus or minus to zoom. Choose a destination in the lists to center it."></svg>
    </div>
    <div class="legend"><div class="legend-bands">${BANDS.map(rating => `<span><i class="swatch" style="--swatch:${rating.color}"></i>${rating.label}${rating.minimum ? ` (${rating.minimum}+)` : ''}</span>`).join('')}</div><span class="legend-help">Numbers mark the top 10 · drag to rotate · scroll to zoom</span></div>
    <section class="more-options" aria-labelledby="more-title"><div class="section-heading"><h2 id="more-title">More good options</h2><span class="section-note">Keep exploring</span></div><div id="more-grid" class="more-grid"></div></section>
    <div id="tooltip" class="tooltip" role="tooltip" hidden></div>
  </section>
  <footer class="method"><h2>How the score works</h2><p>Weather fit, rainfall, and crowds combine using your weights, with adjustments for seasonal storms, holiday crowds, and usable days after travel. Warmer escapes get a small boost when home is cold; cooler escapes do when home is hot. Shorter trips favor closer places. Countries use a broader estimate.</p><p>Climate figures are approximate long-run averages, not forecasts. Flight times are estimates based on distance, airport time, and likely connections; time zones ignore daylight saving. Lunar holiday dates cover 2025–2029.</p><div class="footer-line"><span>71 destinations. Your kind of getaway.</span><span>Made for a little wanderlust <span aria-hidden="true">↗</span></span></div></footer>
`;

const start = document.querySelector<HTMLInputElement>('#start')!;
const end = document.querySelector<HTMLInputElement>('#end')!;
const homeSelect = document.querySelector<HTMLSelectElement>('#home')!;
const tooltip = document.querySelector<HTMLDivElement>('#tooltip')!;
const container = document.querySelector<HTMLDivElement>('#globe-container')!;
const spinButton = document.querySelector<HTMLButtonElement>('#spin')!;
const unitButton = document.querySelector<HTMLButtonElement>('#units')!;
const topList = document.querySelector<HTMLDivElement>('#top-list')!;
const moreGrid = document.querySelector<HTMLDivElement>('#more-grid')!;

function hideTooltip(): void {
  tooltip.hidden = true;
  activeTip = '';
  document.querySelectorAll('[aria-describedby="tooltip"]').forEach(element => element.removeAttribute('aria-describedby'));
}

function showTooltip(html: string, key: string, clientX: number, clientY: number, inGlobe = true): void {
  if (activeTip !== key) { tooltip.innerHTML = html; activeTip = key; }
  tooltip.hidden = false;
  const bounds = container.getBoundingClientRect();
  const areaHeight = inGlobe ? container.querySelector<HTMLElement>('.globe-card')!.offsetHeight : container.offsetHeight;
  const tip = tooltip.getBoundingClientRect();
  let left = clientX - bounds.left + 15;
  let top = clientY - bounds.top + 15;
  if (left + tip.width > bounds.width - 10) left = clientX - bounds.left - tip.width - 15;
  if (top + tip.height > areaHeight - 10) top = clientY - bounds.top - tip.height - 15;
  tooltip.style.left = `${clamp(left, 10, Math.max(10, bounds.width - tip.width - 10))}px`;
  tooltip.style.top = `${clamp(top, 10, Math.max(10, areaHeight - tip.height - 10))}px`;
}

const globe = new Globe(document.querySelector<SVGSVGElement>('#globe')!, {
  cityHover: (result, x, y) => showTooltip(cityTooltip(result, home, unit), `city-${result.city.name}-${unit}`, x, y),
  countryHover: (result, x, y) => showTooltip(countryTooltip(result, unit), `country-${result.country.name}-${unit}`, x, y),
  hideTooltip,
  spinChanged: spinning => { spinButton.textContent = spinning ? 'Pause spin' : 'Spin'; spinButton.setAttribute('aria-pressed', String(spinning)); },
});

function renderLists(): void {
  topList.innerHTML = ranked.slice(0, 5).map(result => {
    const rating = band(result.score);
    return `<button type="button" class="pick-row" data-city="${escapeHtml(result.city.name)}" aria-label="${escapeHtml(result.city.name)}, rank ${result.rank}, ${rating.label}, ${Math.round(result.score)}. Center on globe.">
      <span class="rank-circle" style="--swatch:${rating.color}">${result.rank}</span>
      <span class="pick-main"><span class="pick-heading"><span class="city-name">${escapeHtml(result.city.name)}</span><span class="country-name">${escapeHtml(displayCountry(result.city.country))}</span></span><span class="pick-reason" title="${escapeHtml(reason(result, home, unit))}">${escapeHtml(reason(result, home, unit))}</span></span>
      <span class="badge ${rating.key}">${rating.label} <span aria-hidden="true">·</span> ${Math.round(result.score)}</span>
    </button>`;
  }).join('');
  moreGrid.innerHTML = ranked.slice(5, 17).map(result => {
    const rating = band(result.score);
    return `<button type="button" class="option-card" data-city="${escapeHtml(result.city.name)}" aria-label="${escapeHtml(result.city.name)}, rank ${result.rank}, ${rating.label}, score ${Math.round(result.score)}. Center on globe."><span class="option-top"><span class="option-name"><span class="swatch" style="--swatch:${rating.color}"></span>${escapeHtml(result.city.name)}</span><span class="option-score">${Math.round(result.score)}</span></span><span class="option-detail">${temperature(result.high, unit)} <span>·</span> ~${hours(result.travel.hours)}h ${result.travel.mode === 'drive' ? 'drive' : 'away'}</span></button>`;
  }).join('');
}

function recompute(shouldFly: boolean): void {
  const trip: Trip = { start: start.value, end: end.value };
  const error = validateTrip(trip);
  const errorElement = document.querySelector<HTMLElement>('#date-error')!;
  errorElement.hidden = !error;
  errorElement.textContent = error ?? '';
  start.setAttribute('aria-invalid', String(Boolean(error)));
  end.setAttribute('aria-invalid', String(Boolean(error)));
  const length = document.querySelector<HTMLOutputElement>('#trip-length')!;
  length.textContent = error ? '— days' : `${sampleDays(trip).tripDays} ${sampleDays(trip).tripDays === 1 ? 'day' : 'days'}`;
  if (error) return;
  home = ORIGINS.find(origin => origin.name === homeSelect.value)!;
  hideTooltip();
  cityScores = scoreCities(trip, home, weights);
  ranked = rankCities(cityScores);
  const samples = sampleDays(trip);
  const countries = MAP_COUNTRIES.map(({ country }) => scoreCountry(country, home, samples, weights)).filter((country): country is CountryScore => country !== null);
  renderLists();
  globe.update(cityScores, ranked, countries, home);
  document.querySelector('#ranking-context')!.textContent = `From ${home.name}`;
  document.querySelector('#rank-announcement')!.textContent = `Top pick: ${ranked[0].city.name}, score ${Math.round(ranked[0].score)}. ${samples.tripDays} days from ${home.name}.`;
  if (shouldFly) globe.flyTo(ranked[0].city.lon, ranked[0].city.lat);
}

for (const control of [start, end, homeSelect]) control.addEventListener('change', () => recompute(true));
for (const slider of document.querySelectorAll<HTMLInputElement>('[data-weight]')) {
  slider.addEventListener('input', () => {
    const key = slider.dataset.weight as keyof Weights;
    weights[key] = Number(slider.value);
    document.querySelector(`#value-${key}`)!.textContent = slider.value;
    slider.style.setProperty('--progress', `${Number(slider.value) * 10}%`);
    recompute(false);
  });
}
spinButton.addEventListener('click', () => globe.toggleSpin());
unitButton.addEventListener('click', () => {
  unit = unit === 'F' ? 'C' : 'F';
  unitButton.innerHTML = `<span class="${unit === 'F' ? 'unit-active' : ''}">°F</span><span class="unit-divider">/</span><span class="${unit === 'C' ? 'unit-active' : ''}">°C</span>`;
  unitButton.setAttribute('aria-label', `Temperature unit: ${unit === 'F' ? 'Fahrenheit. Switch to Celsius.' : 'Celsius. Switch to Fahrenheit.'}`);
  hideTooltip();
  renderLists();
});

function resultForTarget(target: EventTarget | null): CityScore | undefined {
  const card = (target as Element | null)?.closest<HTMLButtonElement>('[data-city]');
  return cityScores.find(result => result.city.name === card?.dataset.city);
}
for (const list of [topList, moreGrid]) list.addEventListener('click', event => {
  const result = resultForTarget(event.target);
  if (result) globe.flyTo(result.city.lon, result.city.lat);
});
moreGrid.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  const result = resultForTarget(event.target);
  if (result) showTooltip(cityTooltip(result, home, unit), `city-${result.city.name}-${unit}`, event.clientX, event.clientY, false);
});
moreGrid.addEventListener('pointerleave', hideTooltip);
moreGrid.addEventListener('focusin', event => {
  const result = resultForTarget(event.target);
  if (!result) return;
  const target = event.target as HTMLElement;
  const bounds = target.getBoundingClientRect();
  target.setAttribute('aria-describedby', 'tooltip');
  showTooltip(cityTooltip(result, home, unit), `city-${result.city.name}-${unit}`, bounds.left, bounds.top, false);
});
moreGrid.addEventListener('focusout', hideTooltip);
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
window.addEventListener('resize', hideTooltip);
window.addEventListener('pagehide', () => globe.destroy(), { once: true });

recompute(false);
window.setTimeout(() => globe.initialFlyTo(ranked[0].city.lon, ranked[0].city.lat), 600);
