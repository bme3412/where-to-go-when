import { escapeHtml, temperature } from './format';
import { destinationName } from './regions';
import { monthlySeasonalScores } from './seasonal';
import { TEMPERATURE_COLORS, temperatureColor } from './weather-map';
import type { CityScore, Origin, Trip, Unit } from './types';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateLabel = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
const temperatureKey = TEMPERATURE_COLORS.map(band => band.color).join(', ');

export function monthlyScoreChart(result: CityScore, home: Origin, trip: Trip, unit: Unit, nonstopOnly = false): string {
  const departureMonth = new Date(trip.start).getUTCMonth();
  const scores = monthlySeasonalScores(result.city, home, trip, nonstopOnly);
  const peakScore = Math.max(...scores.map(point => point ? Math.round(point.score) : -1));
  const peaks = scores.flatMap((point, i) => point && Math.round(point.score) === peakScore ? [i] : []);
  const peakLabel = peaks.length === 1 ? `<span class="monthly-score-peak">Highest in ${months[peaks[0]]}</span>` : '';
  const place = escapeHtml(destinationName(result.city));

  // Keep the temperature geometry in Celsius so the unit switch only changes the labels.
  const highs = scores.flatMap(point => point ? [point.high] : []);
  const coldest = Math.min(0, ...highs), warmest = Math.max(0, ...highs);
  const step = Math.max(10, Math.ceil((warmest - coldest) / 40) * 10);
  const low = Math.floor(coldest / step) * step;
  const high = Math.max(step, Math.ceil(warmest / step) * step);
  const temperatureY = (value: number) => (high - value) / (high - low) * 100;
  const freezingY = temperatureY(0);
  const ticks = Array.from({ length: (high - low) / step + 1 }, (_, i) => high - i * step);
  const labels = scores.map((point, i) => point
    ? escapeHtml(`${months[i]} · Score ${point.score.toFixed(1)} out of 100 · Average daytime high ${temperature(point.high, unit)} · ${dateLabel.formatRange(new Date(point.dates.start), new Date(point.dates.end))}`)
    : `${months[i]} · score and temperature unavailable`);

  return `<section class="monthly-scores" aria-label="Monthly scores and temperatures for ${place}">
    <div class="monthly-score-heading">
      <span><i class="monthly-score-key" aria-hidden="true"></i>Score</span>
      ${peakLabel}
      <span><i class="monthly-score-key monthly-temperature-key" style="background:linear-gradient(90deg, ${temperatureKey})" aria-hidden="true"></i>Avg. high °${unit}</span>
    </div>
    <div class="monthly-score-grid">
      <div class="monthly-score-axis" aria-hidden="true">${[100, 50, 0].map(value => `<span style="top:${100 - value}%">${value}</span>`).join('')}</div>
      <div class="monthly-score-plot" aria-hidden="true">
        <svg viewBox="0 0 120 100" preserveAspectRatio="none" aria-hidden="true">
          <rect class="monthly-score-highlight" x="${departureMonth * 10}" width="10" height="100" rx="1" />
          <path class="monthly-score-guides" d="M0 0H120 M0 50H120 M0 100H120" vector-effect="non-scaling-stroke" />
          ${low < 0 ? `<path class="monthly-temperature-baseline" d="M0 ${freezingY}H120" vector-effect="non-scaling-stroke" />` : ''}
          ${scores.map((point, i) => {
            if (!point) return '';
            const y = temperatureY(point.high);
            return `<g><title>${labels[i]}</title>
              <rect class="monthly-temperature-bar" x="${i * 10 + 2.25}" y="${Math.min(y, freezingY)}" width="5.5" height="${Math.abs(y - freezingY)}" rx=".5" fill="${temperatureColor(point.high)}" />
            </g>`;
          }).join('')}
        </svg>
        ${scores.map((point, i) => point
          ? `<span class="monthly-score-marker" style="left:${(i + .5) * 100 / 12}%;top:${100 - point.score}%" title="${labels[i]}"></span>`
          : '').join('')}
      </div>
      <div class="monthly-score-axis monthly-temperature-axis" aria-hidden="true">
        ${ticks.map(value => `<span style="top:${temperatureY(value)}%">${temperature(value, unit).slice(0, -2)}</span>`).join('')}
      </div>
      <ol class="monthly-score-values" role="list" aria-label="January through December scores and temperatures">
        ${scores.map((point, i) => `<li${i === departureMonth ? ' class="trip-month" aria-current="date"' : ''} title="${labels[i]}">
          <span aria-hidden="true">${months[i].slice(0, 3)}</span><strong aria-hidden="true">${point ? Math.round(point.score) : '–'}</strong><span class="sr-only">${labels[i]}</span>
        </li>`).join('')}
      </ol>
    </div>
  </section>`;
}
