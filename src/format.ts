import type { CityScore, Country, Origin, Unit } from './types';

export const BANDS = [
  { minimum: 75, range: '75–100', label: 'Strong match', key: 'great', color: '#3B6D11' },
  { minimum: 62, range: '62–74', label: 'Good match', key: 'good', color: '#97C459' },
  { minimum: 48, range: '48–61', label: 'Mixed', key: 'okay', color: '#EF9F27' },
  { minimum: 0, range: '0–47', label: 'Low match', key: 'skip', color: '#E24B4A' },
] as const;
// The color and its printed range use the same rounded score shown to the user.
export const band = (score: number) => BANDS.find(item => Math.round(score) >= item.minimum) ?? BANDS[3];
export const temperature = (celsius: number, unit: Unit) => `${Math.round(unit === 'F' ? celsius * 9 / 5 + 32 : celsius)}°${unit}`;
export const rainWord = (rain: number) => rain < 30 ? 'Dry' : rain < 80 ? 'Some rain' : rain < 150 ? 'Wet' : 'Very wet';
export const crowdWord = (crowd: number) => crowd < 0.3 ? 'Quiet' : crowd < 0.5 ? 'Moderate' : crowd < 0.7 ? 'Busy' : 'Peak crowds';
export const hours = (value: number) => value < 3 ? `${Math.round(value * 10) / 10}` : `${Math.round(value)}`;
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export const displayCountry = (name: string) => name === 'United States of America' ? 'United States' : name;

export function difference(value: number, unit: Unit): string {
  const rounded = Math.round(value * (unit === 'F' ? 1.8 : 1));
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded)}°${unit}`;
}

export function reason(result: CityScore, home: Origin, unit: Unit): string {
  const delta = result.high - result.homeHigh;
  const comparison = delta * 1.8 >= 15 ? ` (${difference(delta, unit)} vs ${home.name})` : '';
  const journey = result.travel.mode === 'drive' ? `a ${hours(result.travel.hours)}h drive` : `~${hours(result.travel.hours)}h away`;
  const notes = [...result.events.filter(event => !event.startsWith('Ramadan')), ...result.risks, ...result.dealbreakers].slice(0, 2);
  return [`Highs around ${temperature(result.high, unit)}${comparison}`, rainWord(result.rain).toLowerCase(), crowdWord(result.crowd).toLowerCase(), journey, ...notes].join(' · ');
}

export function cityTooltip(result: CityScore, home: Origin, unit: Unit): string {
  const rating = band(result.score);
  const journey = result.travel.mode === 'drive'
    ? `~${hours(result.travel.hours)}h drive`
    : `~${hours(result.travel.hours)}h door to door · ${result.travel.timeShift}h time shift`;
  const tags = [
    ...result.events.map(text => ({ text, kind: 'event' })),
    ...result.risks.map(text => ({ text, kind: 'risk' })),
    ...result.dealbreakers.map(text => ({ text, kind: 'dealbreaker' })),
  ];
  return `<div class="tooltip-heading"><strong>${escapeHtml(result.city.name)}</strong><span class="badge ${rating.key}"><span class="swatch" style="--swatch:${rating.color}"></span>${rating.label} · ${Math.round(result.score)}</span></div>
    <div class="tooltip-country">${escapeHtml(displayCountry(result.city.country))}</div>
    <p>Avg daytime high ${temperature(result.high, unit)} <span class="muted">(${difference(result.high - result.homeHigh, unit)} vs ${escapeHtml(home.name)})</span></p>
    <p>${rainWord(result.rain)} (~${Math.round(result.rain)} mm/month) · ${crowdWord(result.crowd)}</p>
    <div class="tooltip-divider"></div>
    <p>${journey} <span class="muted">(estimated)</span></p>
    ${tags.length ? `<div class="tags">${tags.map(tag => `<span class="tag ${tag.kind}">${escapeHtml(tag.text)}</span>`).join('')}</div>` : ''}`;
}

export function countryTooltip(country: Country, destinations: readonly CityScore[]): string {
  const places = destinations.filter(result => result.city.country === country.name);
  return `<div class="tooltip-heading"><strong>${escapeHtml(displayCountry(country.name))}</strong></div>
    <p class="muted">Countries aren’t scored. Conditions vary by destination.</p>
    ${places.length ? `<p>${places.length} included ${places.length === 1 ? 'destination' : 'destinations'} in this view</p><ul class="country-places">${places.slice(0, 3).map(result => `<li><span><i class="swatch" style="--swatch:${band(result.score).color}"></i>${escapeHtml(result.city.name)}</span><span>${Math.round(result.score)} match</span></li>`).join('')}</ul>${places.length > 3 ? `<p class="muted">+ ${places.length - 3} more on the globe</p>` : ''}` : '<p>No included destinations here. This says nothing about the quality of a trip here.</p>'}`;
}

export function scoreBreakdown(result: CityScore, unit: Unit): string {
  const b = result.breakdown;
  const components = [
    { label: 'Weather fit', fit: b.weatherFit, weight: b.weights.weather, note: `${temperature(result.high, unit)} average high. Target: ${temperature(20, unit)}–${temperature(29, unit)}; includes the warmer/cooler escape bonus.` },
    { label: 'Dry', fit: b.dryFit, weight: b.weights.dry, note: `~${Math.round(result.rain)} mm/month. Monthly rain volume, not the chance of a wet day.` },
    { label: 'Few crowds', fit: b.crowdFit, weight: b.weights.crowds, note: `${crowdWord(result.crowd)}. An assigned seasonal level, adjusted for listed events; not visitor counts.` },
  ];
  const weight = (value: number) => value === 0 ? 'Off' : `Weight ${value}/10`;
  const baseWeight = b.weights.weather + b.weights.dry + b.weights.crowds;
  const shares = baseWeight ? `Your ${b.weights.weather}:${b.weights.dry}:${b.weights.crowds} weights give weather ${Math.round(b.weights.weather / baseWeight * 100)}%, dry ${Math.round(b.weights.dry / baseWeight * 100)}%, and crowds ${Math.round(b.weights.crowds / baseWeight * 100)}% of the base weighting.` : 'All three base weights are off, so the base defaults to 50.';
  const deduction = (value: number) => value < 0.05 ? '0.0' : `−${value.toFixed(1)}`;
  return `<section class="score-breakdown" aria-labelledby="breakdown-title">
    <h3 id="breakdown-title">Why this score?</h3><p class="breakdown-intro">A preference match, not a probability. Higher fits align better with the current model’s rules.</p>
    <div class="score-components">${components.map(c => `<div class="score-component${c.weight === 0 ? ' component-off' : ''}"><div class="component-heading"><strong>${c.label}</strong><span>${weight(c.weight)}</span><b>${Math.round(c.fit * 100)}<small>/100 fit</small></b></div><meter min="0" max="100" value="${c.fit * 100}" aria-label="${c.label}: ${Math.round(c.fit * 100)} out of 100 model fit">${Math.round(c.fit * 100)}</meter><p>${c.note}</p></div>`).join('')}</div>
    <p class="calculation-note">${shares} These are average fits; the model combines them each sampled day using a weighted geometric mean, so they don’t add up to the final score.</p>
    <dl class="score-ledger"><div><dt>Climate + crowds</dt><dd>${b.baseScore.toFixed(1)}</dd></div><div><dt>Seasonal risk adjustment</dt><dd>${deduction(b.riskDeduction)}</dd></div><div><dt>Travel adjustment <span>${weight(b.weights.travel)}</span></dt><dd>${deduction(b.travelDeduction)}</dd></div><div class="ledger-total"><dt>Your match</dt><dd>${Math.round(result.score)}<small>/100</small></dd></div></dl>
    <p class="calculation-note">Travel uses ${result.travel.usable.toFixed(1)} estimated usable days out of ${result.tripDays}, giving a ×${b.travelMultiplier.toFixed(3)} multiplier. Seasonal risk is a fixed model penalty, not a forecast. Figures are rounded.</p>
    <div class="data-note"><strong>About this data</strong><p>Climate values are approximate monthly inputs; their source and reference period are not documented. Crowds, seasonal risks, and travel times are estimates. No day-by-day weather prediction is available.</p></div>
    <button type="button" class="text-button method-link" data-show-method aria-haspopup="dialog">See all scoring rules and color thresholds →</button>
  </section>`;
}
