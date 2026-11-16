import type { CityScore, CountryScore, Origin, Unit } from './types';

export const BANDS = [
  { minimum: 75, label: 'Great', key: 'great', color: '#3B6D11' },
  { minimum: 62, label: 'Good', key: 'good', color: '#97C459' },
  { minimum: 48, label: 'So-so', key: 'okay', color: '#EF9F27' },
  { minimum: 0, label: 'Skip', key: 'skip', color: '#E24B4A' },
] as const;
export const band = (score: number) => BANDS.find(item => score >= item.minimum) ?? BANDS[3];
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
    <p>Good days: <strong>${result.goodDays} of ${result.tripDays}</strong></p>
    <div class="tooltip-divider"></div>
    <p>${journey}</p><p><strong>${result.travel.usable.toFixed(1)}</strong> of ${result.tripDays} days left after travel</p>
    ${tags.length ? `<div class="tags">${tags.map(tag => `<span class="tag ${tag.kind}">${escapeHtml(tag.text)}</span>`).join('')}</div>` : ''}`;
}

export function countryTooltip(result: CountryScore, unit: Unit): string {
  const rating = band(result.score);
  return `<div class="tooltip-heading"><strong>${escapeHtml(result.country.name)}</strong></div>
    <p><span class="swatch" style="--swatch:${rating.color}"></span> Broad estimate <strong>${Math.round(result.score)} / 100</strong></p>
    <p>Typical high ${temperature(result.high, unit)}</p>
    <p>${rainWord(result.rain * 240)} · ${crowdWord(result.crowd)}</p>
    <p>~${hours(result.travel.hours)}h away</p>`;
}
