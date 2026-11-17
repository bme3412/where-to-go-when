import { FORECAST_SOURCE } from './forecast';
import { destinationName, regionMetadata } from './regions';
import type { CityClimate, CityScore, ClimateSource, Country, FlightJourney, FlightRoute, Travel, Unit, Weights, WeatherFlag } from './types';
import { BOSTON_FLIGHTS } from './flights';
import { DAY, minimumUsableStay, routeCoverageFactor, WEIGHT_KEYS } from './scoring';
import { WEATHER_SYMBOLS, weatherFlagLabel } from './weather';
import { AGENCY_STATUS_LABELS, climateLabel, climateSourceKind, gridElevationMismatch, sharedGridHistory } from './climate';

export const BANDS = [
  { minimum: 75, range: '75–100', label: 'Strong match', key: 'great', color: '#355B88' },
  { minimum: 62, range: '62–74', label: 'Good match', key: 'good', color: '#6385AC' },
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

export function weatherBadges(flags: readonly WeatherFlag[]): string {
  if (!flags.length) return '';
  return `<span class="weather-badges">${flags.map(flag => `<span class="weather-tag weather-${flag.kind}"><svg viewBox="-8 -8 16 16" aria-hidden="true"><path d="${WEATHER_SYMBOLS[flag.kind]}"/></svg>${escapeHtml(weatherFlagLabel(flag))}</span>`).join('')}</span>`;
}

const weatherDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function weatherSourceSummary(result: CityScore): string {
  const { start, end, forecast } = result.weatherDates;
  if (!forecast.length) return 'Historical climate for all selected dates';
  const runs: { start: number; end: number; forecast: boolean }[] = [];
  const add = (first: number, last: number, isForecast: boolean) => {
    if (first > last) return;
    const previous = runs.at(-1);
    if (previous?.forecast === isForecast && previous.end + DAY === first) previous.end = last;
    else runs.push({ start: first, end: last, forecast: isForecast });
  };
  let cursor = Date.parse(start);
  for (const date of forecast) {
    const day = Date.parse(date);
    add(cursor, day - DAY, false);
    add(day, day, true);
    cursor = day + DAY;
  }
  add(cursor, Date.parse(end), false);
  return runs.map(run => `${run.forecast ? 'Forecast' : 'Historical climate'} ${weatherDateFormat.formatRange(new Date(run.start), new Date(run.end))}`).join(' · ');
}

function dailyWeatherTable(result: CityScore, unit: Unit): string {
  const contribution = (days: number) => days > 0 && days < 0.005 ? '&lt;0.01' : days.toFixed(2);
  const grouped = result.weatherPeriods.some(period => period.days > 1);
  const rows = result.weatherPeriods.map(period => {
    const start = new Date(period.start), end = new Date(period.start + (period.days - 1) * DAY);
    const date = weatherDateFormat.formatRange(start, end);
    const rain = period.rain;
    return `<tr><th scope="row">${date}</th><td>${temperature(period.high, unit)}</td>
      <td>${rain.source === 'forecast' ? `${rain.millimeters} mm` : `${Math.round(rain.wetFrequency * 100)}% wet-day chance`}</td>
      <td>${rain.source === 'forecast' ? 'Forecast' : 'Historical climate'}</td><td>${contribution(period.comfortableDryDays)}</td></tr>`;
  }).join('');
  return `<div class="daily-weather"><table aria-describedby="daily-weather-note">
    <caption>${grouped ? 'Weather by date' : 'Day-by-day weather'}</caption>
    <thead><tr><th scope="col">Date</th><th scope="col">High</th><th scope="col">Rain</th><th scope="col">Source</th><th scope="col">Comfortable, dry days</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th scope="row" colspan="4">Total after travel</th><td>${contribution(result.comfortableDryDays)}</td></tr></tfoot>
  </table></div>
  <p id="daily-weather-note" class="weather-caveat">Forecast rows show predicted highs and precipitation. Historical rows show typical highs and the chance of at least 1 mm of precipitation. Contributions account for estimated travel time and may differ slightly from the total due to rounding.${grouped ? ' Date ranges share one historical sample. Their contribution covers the full range shown.' : ''}</p>`;
}

export function weatherDetails(result: CityScore, unit: Unit): string {
  const forecast = result.weatherDates.forecast.length > 0;
  return `<section class="weather-details"><h3>Weather for your dates</h3>
    <p><strong>${escapeHtml(weatherSourceSummary(result))}</strong>${forecast ? ` · <a href="${FORECAST_SOURCE}" target="_blank" rel="noopener noreferrer">Weather data by Open-Meteo ↗</a>` : ''}</p>
    <p>Average high ${temperature(result.high, unit)} · low ${temperature(result.low, unit)}. ${rainWord(result.wetFrequency)} estimated.</p>
    ${dailyWeatherTable(result, unit)}
    ${result.weatherFlags.length ? `<ul>${result.weatherFlags.map(flag => `<li><strong class="weather-${flag.kind}">${escapeHtml(weatherFlagLabel(flag))}${flag.temperature === undefined ? '' : ` · ${temperature(flag.temperature, unit)}`}</strong><p>${escapeHtml(flag.detail)}</p><span class="weather-source">${flag.basis === 'climate' ? '1991–2020 climate baseline' : flag.basis === 'calendar' ? 'Seasonal calendar' : 'Unverified regional estimate'} · ${flag.sourceUrl ? `<a href="${escapeHtml(flag.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(flag.sourceLabel)} ↗</a>` : escapeHtml(flag.sourceLabel)}</span></li>`).join('')}</ul>` : '<p>No flags meet the app’s thresholds for these dates. This is not a guarantee of settled weather.</p>'}
    <p class="weather-caveat">Seasonal flags come from historical patterns and calendars. Wet-season patterns are inferred from local monthly precipitation; daily temperatures and rainfall can vary.</p></section>`;
}

export function cityTooltip(result: CityScore, unit: Unit): string {
  const rating = band(result.score);
  return `<div class="tooltip-heading"><strong>${escapeHtml(destinationName(result.city))}</strong><span class="badge ${rating.key}"><span class="swatch" style="--swatch:${rating.color}"></span>${rating.label}</span></div>
    <div class="tooltip-country">${escapeHtml(displayCountry(result.city.country))}</div>
    <p>Average high ${temperature(result.high, unit)} · ${rainWord(result.wetFrequency)}</p>
    <p><strong>${comfortableDryTime(result.comfortableDryDays)}</strong></p>`;
}

export function comfortableDryTime(days: number): string {
  const rounded = Number(days.toFixed(1));
  if (days > 0 && rounded === 0) return 'Under 0.1 comfortable, dry days';
  return `${rounded ? '~' : ''}${rounded} comfortable, dry ${rounded === 1 ? 'day' : 'days'}`;
}

export function destinationTime(usableDays: number): string {
  const days = Number(usableDays.toFixed(1));
  if (usableDays > 0 && days === 0) return 'Under 0.1 days at destination (est.)';
  return `~${days} ${days === 1 ? 'day' : 'days'} at destination`;
}

export function rankingRouteLabel(travel: Travel): string {
  if (travel.mode !== 'flight') return '';
  if (!travel.flights) return 'Distance estimate · routes unchecked';
  const label = flightLabel(travel);
  return travel.basis === 'routes' ? label : `${label} · distance estimate used`;
}

export function flightLabel(travel: Travel): string {
  if (!travel.flights) return '';
  if (travel.basis === 'distance') return 'Route coverage incomplete';
  const outbound = travel.flights.outbound;
  if (outbound?.totalMinutes == null) return 'Outbound coverage incomplete';
  const label = outbound.route.legs.length === 1 ? 'Nonstop listed from BOS' : `1 connection via ${outbound.route.path[1]}`;
  return label + (travel.basis === 'mixed' ? ' · return incomplete' : '');
}

const flightDuration = (minutes: number): string => {
  const rounded = Math.round(minutes), h = Math.floor(rounded / 60), m = rounded % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
};

/** Flight-only time and carriers for the exact direction drawn on the globe. */
export function flightRouteDetails(route: FlightRoute | null | undefined): string {
  if (!route) return '';
  return `<p><strong>Flight time: ~${flightDuration(route.flightMinutes)}</strong><span> · excludes transfers${route.legs.length > 1 ? ' and layovers' : ''}</span></p>
    <ul>${route.legs.map(leg => `<li>${route.legs.length > 1 ? `<strong>${escapeHtml(leg.from)} → ${escapeHtml(leg.to)}</strong> · ${flightDuration(leg.minutes)} · ` : ''}Airlines: ${leg.airlines.length ? leg.airlines.map(code => escapeHtml(BOSTON_FLIGHTS.airlines[code] ?? code)).join(', ') : 'Not recorded'}</li>`).join('')}</ul>`;
}

export function flightDetails(travel: Travel): string {
  const trip = travel.flights;
  if (!trip) return '';
  const a = BOSTON_FLIGHTS.assumptions;
  const direction = (label: string, journey: FlightJourney | null, fallbackHours: number) => {
    if (!journey) return `<section class="flight-direction"><h4>${label}</h4><p><strong>Route coverage incomplete</strong></p><p>${trip.hasGateway ? 'No nonstop or one-connection route is recorded in this direction. Longer routes may exist.' : 'No gateway airport is mapped for this destination in the snapshot.'} The score uses a distance estimate of ~${hours(fallbackHours)}h.</p></section>`;
    const { route, gateway } = journey;
    const path = route.path.map(code => `<abbr title="${escapeHtml(BOSTON_FLIGHTS.airports[code]?.name ?? code)}">${escapeHtml(code)}</abbr>`).join(' → ');
    return `<section class="flight-direction"><h4>${label}<span>${journey.totalMinutes === null ? 'Transfer unverified' : `~${flightDuration(journey.totalMinutes)} total`}</span></h4>
      <p class="flight-path">${path}</p>
      <p class="flight-kind">${route.legs.length === 1 ? 'Nonstop listed' : 'One-connection possibility'}</p>
      <ul class="flight-legs">${route.legs.map(leg => `<li><strong>${escapeHtml(leg.from)} → ${escapeHtml(leg.to)}</strong> · ${flightDuration(leg.minutes)}<span>Listed carriers: ${leg.airlines.map(code => escapeHtml(BOSTON_FLIGHTS.airlines[code] ?? code)).join(', ')}</span></li>`).join('')}</ul>
      <dl class="journey-parts"><dt>Stored flight time</dt><dd>${flightDuration(route.flightMinutes)}</dd>
      <dt>Connection allowance</dt><dd>${journey.connectionMinutes ? `~${flightDuration(journey.connectionMinutes)}` : 'None'}</dd>
      <dt>Airport formalities</dt><dd>~${flightDuration(a.departureMinutes + a.arrivalMinutes)}</dd>
      <dt>Boston ground transfer</dt><dd>~${flightDuration(a.homeTransferMinutes)}</dd>
      <dt>${escapeHtml(gateway.iata)} ${escapeHtml(gateway.mode)} transfer</dt><dd>${gateway.minutes === null ? 'Unknown' : `~${flightDuration(gateway.minutes)}`}</dd></dl>
      <p class="transfer-note">${escapeHtml(gateway.note)}${gateway.sourceUrl ? ` <a href="${escapeHtml(gateway.sourceUrl)}" target="_blank" rel="noopener noreferrer">Gateway source ↗</a>` : ''}</p>
      ${journey.totalMinutes === null ? `<p class="route-incomplete">Onward transfer unverified. The score uses a distance estimate of ~${hours(fallbackHours)}h for this direction.</p>` : ''}
    </section>`;
  };
  return `<section class="flight-details" aria-labelledby="flight-title"><h3 id="flight-title">Your journey from Boston</h3>
    <p class="flight-caveat">Offline route estimates. Operating dates, seasonal service, connection timing and through-ticket availability are unverified. Fares are not included.</p>
    ${trip.note ? `<p class="gateway-note">${escapeHtml(trip.note)}</p>` : ''}
    <div class="flight-directions">${direction('Outbound', trip.outbound, travel.hours)}${direction('Return', trip.inbound, travel.returnHours)}</div>
    <details class="flight-assumptions"><summary>Route source and time assumptions</summary>
      <p><a href="${BOSTON_FLIGHTS.source.url}" target="_blank" rel="noopener noreferrer">${BOSTON_FLIGHTS.source.name} ↗</a>. Source snapshot date unknown. Packaged ${escapeHtml(BOSTON_FLIGHTS.generatedAt.slice(0, 10))}; this is not a route update date.</p>
      <p>Each direction includes ${a.homeTransferMinutes} minutes in Boston, ${a.departureMinutes} minutes before departure, ${a.arrivalMinutes} minutes after arrival, and ${a.connectionMinutes} minutes per connection. These are planning allowances, not validated connection times.</p>
      <p>Local ground transfers use airport-to-place straight-line distance × ${a.groundDistanceMultiplier} at ${a.groundSpeedKmh} km/h, rounded up to 5 minutes with a ${a.minimumGroundMinutes}-minute minimum. Reviewed gateways use their listed estimate. Roads, traffic and transfer schedules are not checked.</p>
      <p>Routes are chosen separately each way by estimated flight, connection and transfer time. Missing coverage keeps a clearly labeled distance estimate; it does not mean the destination is unreachable.</p>
    </details></section>`;
}

export function countryTooltip(country: Country, destinations: readonly CityScore[]): string {
  const places = destinations.filter(result => result.city.country === country.name);
  return `<div class="tooltip-heading"><strong>${escapeHtml(displayCountry(country.name))}</strong></div>
    <p class="muted">Countries aren’t scored. Conditions vary by destination.</p>
    ${places.length ? `<p>${places.length} included ${places.length === 1 ? 'destination' : 'destinations'} in this view</p><ul class="country-places">${places.slice(0, 3).map(result => `<li><span><i class="swatch" style="--swatch:${band(result.score).color}"></i>${escapeHtml(destinationName(result.city))}</span><span>${Math.round(result.score)} match</span></li>`).join('')}</ul>${places.length > 3 ? `<p class="muted">+ ${places.length - 3} more on the globe</p>` : ''}` : '<p>No included destinations here. This says nothing about the quality of a trip here.</p>'}`;
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
  const coverage = routeCoverageFactor(result.travel);
  const minimumStay = minimumUsableStay(result.tripDays);
  const stayRule = minimumStay ? ` Recommendations for these dates require at least ${minimumStay === 0.5 ? 'half a day' : 'one day'} at the destination.` : '';
  const coverageNote = coverage === 0 ? ' The travel factor gives no points when both directions use distance estimates.'
    : coverage < 1 ? ' The travel factor gives half credit when one direction uses a distance estimate.' : '';
  const weatherQuality = result.weatherDates.forecast.length ? 'Open-Meteo forecast for covered dates' : '';
  const components: { key: keyof Weights; label: string; quality: string; note: string }[] = [
    { key: 'weather', label: 'Temperature', quality: weatherQuality || sourceLabel(result.climate.sources.temperature), note: `${Math.round(b.fits.weather * 100)}% estimated daytime highs in your ${temperatureBound(b.temperatureRange.min, unit)}–${temperatureBound(b.temperatureRange.max, unit)} range.` },
    { key: 'dry', label: 'Dry days', quality: weatherQuality || sourceLabel(result.climate.sources.precipitation), note: `${Math.round(b.fits.dry * 100)}% estimated dry days, with less than 1 mm of precipitation.` },
    { key: 'crowds', label: 'Few crowds', quality: 'Estimated', note: `${crowdWord(result.crowd)}. Seasonal levels and listed event adjustments are assigned estimates, not measured visitor counts.${result.city.region ? ` Inherited from the ${result.city.region} regional estimate; local crowd differences are not measured.` : ''}` },
    { key: 'travel', label: 'Short travel', quality: result.travel.basis === 'routes' ? 'Saved routes + estimated transfers' : result.travel.basis === 'mixed' ? 'Partial route coverage' : 'Estimated', note: `${result.travel.usable.toFixed(1)} of ${result.tripDays} days usable after modeled travel and time-zone recovery. ${result.travel.basis === 'routes' ? 'Uses saved BOS routes in both directions with connection and transfer allowances; schedules are unverified.' : result.travel.basis === 'mixed' ? 'One direction uses saved BOS routes; the other uses a distance estimate.' : result.travel.flights ? 'Route coverage is incomplete; the distance estimate is used.' : result.travel.mode === 'drive' ? 'Driving uses distance; roads and traffic are not checked.' : 'Routes and schedules are not checked.'}${coverageNote}${stayRule}` },
  ];
  return `<section class="score-breakdown" aria-labelledby="breakdown-title">
    <div class="breakdown-heading"><h3 id="breakdown-title">Why this score?</h3><span>${result.score.toFixed(1)} / 100</span></div><p class="breakdown-intro"><strong>${comfortableDryTime(result.comfortableDryDays)}</strong> expected after travel. Your four priorities determine the recommendation order and match label.</p>
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
  const shared = sharedGridHistory(climate);
  const locality = climate.referenceLabel ?? climate.name;
  return `<section class="climate-provenance" aria-label="Climate data sources"><h3>Climate data · 1991–2020</h3><p class="source-intro"><strong>${escapeHtml(locality)}</strong><br>${climate.lat.toFixed(4)}°, ${climate.lon.toFixed(4)}° · about ${Math.round(climate.elevation)} m elevation.${climate.referenceUrl ? ` <a href="${escapeHtml(climate.referenceUrl)}" target="_blank" rel="noopener noreferrer">${climate.referenceUrl.includes('geonames.org') ? 'Reference location · GeoNames (CC BY 4.0)' : 'Reference location'} ↗</a>` : ''}${climate.referenceNote ? `<br>${escapeHtml(climate.referenceNote)}` : ''}</p>
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
      if (shared[variable].length) {
        const peers = shared[variable].map(name => escapeHtml(destinationName({ name, ...regionMetadata(name) }))).join(', ');
        context += `<p class="resolution-warning"><strong>Same ${variable === 'temperature' ? 'temperature' : 'precipitation'} history as ${peers}.</strong> The complete 1991–2020 daily grid values are identical. This factor cannot distinguish these places; any score difference comes from other factors. This does not establish identical local weather.</p>`;
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
