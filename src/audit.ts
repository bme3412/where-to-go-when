import { CITIES } from './data/cities';
import { climateFor, climateLabel, climateSourceKind, gridElevationMismatch } from './climate';
import { displayCountry, escapeHtml } from './format';
import type { ClimateSource } from './types';

export type AuditFilter = 'all' | 'station' | 'mixed' | 'grid';
export const sourceCounts = CITIES.reduce((counts, city) => {
  counts[climateSourceKind(climateFor(city.name))]++; return counts;
}, { station: 0, mixed: 0, grid: 0 });

export function auditDestinations(query: string, filter: AuditFilter) {
  const text = query.trim().toLocaleLowerCase();
  return CITIES.filter(city => {
    const climate = climateFor(city.name);
    return (filter === 'all' || climateSourceKind(climate) === filter)
      && `${city.name} ${displayCountry(city.country)} ${climate.referenceLabel ?? ''}`.toLocaleLowerCase().includes(text);
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const factor = (source: ClimateSource): string => source.kind === 'grid' ? 'Regional grid estimate'
  : `${source.stationName} · ${Math.floor(Math.min(...source.coverage.map(month => month.days / month.expectedDays)) * 100)}% minimum monthly coverage`;

export function auditRows(query: string, filter: AuditFilter): string {
  const cities = auditDestinations(query, filter);
  return cities.map(city => {
    const climate = climateFor(city.name), kind = climateSourceKind(climate), mismatch = gridElevationMismatch(climate);
    return `<button type="button" class="audit-row" data-audit-city="${escapeHtml(city.name)}" aria-haspopup="dialog" aria-label="Inspect ${escapeHtml(city.name)}. ${climateLabel(climate)}."><span class="audit-row-heading"><strong>${escapeHtml(city.name)}</strong><span class="audit-source source-${kind}">${climateLabel(climate)}</span></span><span class="audit-locality">${escapeHtml(displayCountry(city.country))}${climate.referenceLabel ? ` · ${escapeHtml(climate.referenceLabel)}` : ''}</span><span><b>Temperature</b> ${escapeHtml(factor(climate.sources.temperature))}</span><span><b>Precipitation</b> ${escapeHtml(factor(climate.sources.precipitation))}</span>${mismatch !== null ? '<span class="terrain-flag">Grid terrain differs by at least 300 m</span>' : ''}</button>`;
  }).join('') || '<p class="audit-empty">No destinations match. Try another name or source filter.</p>';
}

export const auditContent = `<h2 id="audit-title">Climate data audit</h2><p class="audit-intro">All 71 destinations, including those outside your top picks. Inspect a place for its station, sample coverage and original files.</p><div class="audit-counts"><span><strong>${sourceCounts.station}</strong> Station data</span><span><strong>${sourceCounts.mixed}</strong> Mixed sources</span><span><strong>${sourceCounts.grid}</strong> Regional grids</span></div><p class="audit-policy">1991–2020 baseline · stations within 15 km and 150 m · at least 80% of days in every calendar month. Source quality is separate from your match score.</p><div class="audit-controls"><div class="field"><label for="audit-search">Find a destination</label><input type="search" id="audit-search" placeholder="City, country or reference area" /></div><div class="field"><label for="audit-filter">Climate source</label><select id="audit-filter"><option value="all">All sources</option><option value="station">Station data</option><option value="mixed">Mixed sources</option><option value="grid">Regional grids</option></select></div></div><p id="audit-count" class="audit-count" role="status" aria-live="polite">71 destinations</p><div id="audit-list" class="audit-list">${auditRows('', 'all')}</div>`;
