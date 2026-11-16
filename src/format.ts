import type { CityClimate, CityScore, ClimateSource, Country, Origin, Unit, Weights } from './types';
import { WEIGHT_KEYS } from './scoring';
import { AGENCY_STATUS_LABELS, climateLabel, climateSourceKind, gridElevationMismatch } from './climate';

export const BANDS = [
  { minimum: 75, range: '75–100', label: 'Strong match', key: 'great', color: '#3B6D11' },
  { minimum: 62, range: '62–74', label: 'Good match', key: 'good', color: '#97C459' },
  { minimum: 48, range: '48–61', label: 'Mixed', key: 'okay', color: '#EF9F27' },
  { minimum: 0, range: '0–47', label: 'Low match', key: 'skip', color: '#E24B4A' },
] as const;
// The color and its printed range use the same rounded score shown to the user.
export const band = (score: number) => BANDS.find(item => Math.round(score) >= item.minimum) ?? BANDS[3];
export const temperature = (celsius: number, unit: Unit) => `${Math.round(unit === 'F' ? celsius * 9 / 5 + 32 : celsius)}°${unit}`;
export const rainWord = (frequency: number) => `${Math.round(frequency * 100)}% wet days`;
export const temperatureBound = (celsius: number, unit: Unit) => `${Number((unit === 'F' ? celsius * 9 / 5 + 32 : celsius).toFixed(1))}°${unit}`;
export const crowdWord = (crowd: number) => crowd < 0.3 ? 'Quiet' : crowd < 0.5 ? 'Moderate' : crowd < 0.7 ? 'Busy' : 'Peak crowds';
export const hours = (value: number) => value < 3 ? `${Math.round(value * 10) / 10}` : `${Math.round(value)}`;
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
export const displayCountry = (name: string) => name === 'United States of America' ? 'United States' : name;

export function difference(value: number, unit: Unit): string {
  const rounded = Math.round(value * (unit === 'F' ? 1.8 : 1));
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded)}°${unit}`;
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
    <div class="tooltip-country">${escapeHtml(displayCountry(result.city.country))}${result.climate.referenceLabel ? ` · ${escapeHtml(result.climate.referenceLabel)}` : ''}<span class="climate-caption source-${climateSourceKind(result.climate)}">${climateLabel(result.climate)} · 1991–2020</span></div>
    <p>Avg daytime high ${temperature(result.high, unit)} <span class="muted">(${difference(result.high - result.homeHigh, unit)} vs ${escapeHtml(home.name)})</span></p>
    <p>${rainWord(result.wetFrequency)} historically · ~${Math.round(result.rain)} mm/month</p><p>${crowdWord(result.crowd)} <span class="muted">(crowd estimate)</span></p>
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

/** Round contributions together so the displayed tenths sum to the displayed total. */
export function displayedContributions(result: CityScore): Weights {
  const pieces = WEIGHT_KEYS.map((key, index) => ({ key, index, exact: result.breakdown.contributions[key] * 10, value: Math.floor(result.breakdown.contributions[key] * 10) }));
  const remaining = Math.round(result.score * 10) - pieces.reduce((sum, item) => sum + item.value, 0);
  [...pieces].sort((a, b) => (b.exact - b.value) - (a.exact - a.value) || a.index - b.index).slice(0, remaining).forEach(item => item.value++);
  return Object.fromEntries(pieces.map(item => [item.key, item.value / 10])) as unknown as Weights;
}

export function scoreBreakdown(result: CityScore, unit: Unit): string {
  const b = result.breakdown, points = displayedContributions(result);
  const components: { key: keyof Weights; label: string; quality: string; note: string }[] = [
    { key: 'weather', label: 'Temperature', quality: sourceLabel(result.climate.sources.temperature), note: `${Math.round(b.fits.weather * 100)}% of historical daily highs in your ${temperatureBound(b.temperatureRange.min, unit)}–${temperatureBound(b.temperatureRange.max, unit)} range.` },
    { key: 'dry', label: 'Dry days', quality: sourceLabel(result.climate.sources.precipitation), note: `${Math.round(b.fits.dry * 100)}% of historical days had less than 1 mm of precipitation. This is a historical frequency, not a forecast.` },
    { key: 'crowds', label: 'Few crowds', quality: 'Estimated', note: `${crowdWord(result.crowd)}. Seasonal levels and listed event adjustments are assigned estimates, not measured visitor counts.` },
    { key: 'travel', label: 'Short travel', quality: 'Estimated', note: `${result.travel.usable.toFixed(1)} of ${result.tripDays} days usable after modeled travel and time-zone recovery. Routes and schedules are not checked.` },
  ];
  return `<section class="score-breakdown" aria-labelledby="breakdown-title">
    <div class="breakdown-heading"><h3 id="breakdown-title">Why this score?</h3><span>${result.score.toFixed(1)} / 100</span></div><p class="breakdown-intro">Four contributions, one sum. Your weights total 100%.</p>
    <div class="score-components">${components.map(c => `<div class="score-component${b.weights[c.key] === 0 ? ' component-off' : ''}"><div class="component-heading"><strong>${c.label}</strong><span>${b.weights[c.key]}% weight</span><b>+${points[c.key].toFixed(1)}<small>points</small></b></div><meter min="0" max="100" value="${b.fits[c.key] * 100}" aria-label="${c.label}: ${Math.round(b.fits[c.key] * 100)} out of 100 fit">${Math.round(b.fits[c.key] * 100)}</meter><p>${c.note}</p><span class="quality-label">${c.quality}${b.weights[c.key] === 0 ? ' · excluded from score' : ''}</span></div>`).join('')}</div>
    <div class="score-sum" aria-label="Score calculation">${WEIGHT_KEYS.map(key => points[key].toFixed(1)).join(' + ')} <strong>= ${result.score.toFixed(1)}</strong></div>
    <p class="calculation-note">Each contribution = fit × weight. Contributions are rounded to 0.1 point. Seasonal risk notes do not reduce the score.</p>
    ${climateProvenance(result.climate)}
    <button type="button" class="text-button method-link" data-show-method aria-haspopup="dialog">See all scoring rules and color thresholds →</button>
  </section>`;
}

const sourceLabel = (source: ClimateSource): string => source.kind === 'station' ? (source.stationMembers ? 'Agency station series' : 'Nearby station observations') : 'Regional grid estimate';

function originalSourceFile(file: NonNullable<ClimateSource['rawInputs']>[number]): string {
  const request = file.request ? `<details class="export-request"><summary>POST export · request recorded</summary><p>This CSV is generated through the agency’s export form. The link above opens that form.</p><small>Endpoint <code>${escapeHtml(file.url)}</code><br>Content type <code>${escapeHtml(file.request.contentType)}</code><br>Parameters <code>${escapeHtml(file.request.body)}</code></small></details>` : '';
  return `<li><a href="${escapeHtml(file.sourcePage ?? file.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.label)} ↗</a><small>Retrieved ${escapeHtml(file.retrieved.slice(0, 10))} · SHA-256 <code>${file.sha256}</code></small>${request}</li>`;
}

export function climateProvenance(climate: CityClimate): string {
  const mismatch = gridElevationMismatch(climate);
  const displayedInputs = new Set<string>();
  const locality = climate.referenceLabel ?? climate.name;
  return `<section class="climate-provenance" aria-label="Climate data sources"><h3>Climate data · 1991–2020</h3><p class="source-intro"><strong>${escapeHtml(locality)}</strong><br>${climate.lat.toFixed(4)}°, ${climate.lon.toFixed(4)}° · about ${Math.round(climate.elevation)} m elevation.${climate.referenceUrl ? ` <a href="${escapeHtml(climate.referenceUrl)}" target="_blank" rel="noopener noreferrer">Reference location ↗</a>` : ''}${climate.referenceNote ? `<br>${escapeHtml(climate.referenceNote)}` : ''}</p>
    ${mismatch !== null ? `<p class="terrain-warning"><strong>Grid terrain mismatch:</strong> the regional model elevation is ${Math.abs(mismatch).toLocaleString('en-US')} m ${mismatch > 0 ? 'higher' : 'lower'} than this reference point. Grid-based factors may miss local conditions. No elevation correction or extra score penalty is applied.</p>` : ''}
    ${(['temperature', 'precipitation'] as const).map(variable => {
      const source = climate.sources[variable];
      const records = source.coverage.reduce((sum, month) => sum + month.days, 0);
      const coverage = Math.min(...source.coverage.map(month => month.days / month.expectedDays));
      const years = Math.min(...source.coverage.map(month => month.years));
      const label = variable === 'temperature' ? 'Temperature' : 'Precipitation';
      let context: string;
      if (source.kind === 'station') {
        const members = source.stationMembers ? `<details class="source-files"><summary>Agency-documented station history</summary><ul>${source.stationMembers.map(member => `<li><strong>${escapeHtml(member.stationName)} · ${escapeHtml(member.stationId)}</strong><br>${member.start} to ${member.end} · ${Math.round(member.elevation)} m elevation · ${member.lat.toFixed(4)}°, ${member.lon.toFixed(4)}°</li>`).join('')}</ul><a href="${escapeHtml(source.lineageUrl!)}" target="_blank" rel="noopener noreferrer">Agency station history ↗</a><p>The agency’s published site periods are used. Observations are not averaged across sites or filled from neighboring stations; location changes may affect historical distributions.</p></details>` : '';
        context = `<p><a href="${escapeHtml(source.metadataUrl ?? source.lineageUrl ?? source.sourcePage ?? source.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.stationName)} ↗</a><br>${escapeHtml(source.provider)} · ${escapeHtml(source.stationId)}</p><p>${source.stationMembers ? 'All station locations within' : 'Station'} ${source.distanceKm.toFixed(1)} km ${source.stationMembers ? 'of' : 'from'} the reference point · ${source.stationMembers ? 'latest station' : 'station'} elevation ${Math.round(source.elevation)} m (${Math.abs(Math.round(source.elevationDifferenceM))} m ${source.elevationDifferenceM < 0 ? 'lower' : 'higher'}).<br>${records.toLocaleString('en-US')} accepted daily observations. Every calendar month has at least ${Math.floor(coverage * 100)}% of the baseline’s days and ${years} qualifying years.</p>${members}${source.qualityNote ? `<p>${escapeHtml(source.qualityNote)}</p>` : ''}${source.attribution ? `<p>${escapeHtml(source.attribution)}</p>` : ''}${source.qualityUrl || source.qualityEvidenceUrl ? `<a href="${escapeHtml(source.qualityUrl ?? source.qualityEvidenceUrl!)}" target="_blank" rel="noopener noreferrer">Agency quality notes ↗</a>` : ''}${source.licenseUrl ? ` <a href="${escapeHtml(source.licenseUrl)}" target="_blank" rel="noopener noreferrer">Source usage terms ↗</a>` : ''}`;
      } else {
        context = `<p><a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">NASA POWER / MERRA-2 daily data ↗</a><br>Regional grid estimate · 0.5° × 0.625°. Grid elevation ${Math.round(climate.gridElevation)} m; local coasts and mountains may differ substantially.</p><p><strong>Why a grid estimate?</strong> ${escapeHtml(source.reason)}</p>`;
      }
      let inputs = '';
      if (source.rawInputs?.length) {
        const key = source.rawInputs.map(file => file.sha256).join(',');
        inputs = displayedInputs.has(key) ? '<p class="retrieved">Uses the same source files listed under Temperature.</p>' : `<details class="source-files"><summary>${source.rawInputs.length} original source ${source.rawInputs.length === 1 ? 'file' : 'files'}</summary><ul>${source.rawInputs.map(originalSourceFile).join('')}</ul></details>`;
        displayedInputs.add(key);
      }
      return `<div class="data-note source-${source.kind}"><strong>${label} · ${sourceLabel(source)}</strong>${context}${inputs}<p class="retrieved">Retrieved ${escapeHtml(source.retrieved.slice(0, 10))}.</p></div>`;
    }).join('')}
    ${climate.agencyReview ? `<div class="data-note"><strong>${climate.agencyReview.status ? AGENCY_STATUS_LABELS[climate.agencyReview.status] : 'Local agency check'}</strong><p>${escapeHtml(climate.agencyReview.note)} <a href="${escapeHtml(climate.agencyReview.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(climate.agencyReview.agency)} ↗</a></p>${climate.agencyReview.checked ? `<p class="retrieved">Agency route checked ${escapeHtml(climate.agencyReview.checked)}. Access does not guarantee that a record will meet the station and coverage rules.</p>` : ''}</div>` : ''}
    <p class="source-caveat">A station describes its own site. Beaches, slopes, valleys and nearby neighborhoods can still differ. Regional destination names represent the listed point, not an entire island or region. Missing station days are excluded, never treated as dry. Monthly precipitation is scaled from the available daily sample; trace amounts below the provider’s reporting threshold are treated as zero for volume.</p></section>`;
}
