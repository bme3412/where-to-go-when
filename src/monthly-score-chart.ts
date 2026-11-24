import { escapeHtml } from './format';
import { destinationName } from './regions';
import { monthlySeasonalScores } from './seasonal';
import type { CityScore, Origin, Trip } from './types';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateLabel = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

export function monthlyScoreChart(result: CityScore, home: Origin, trip: Trip, nonstopOnly = false): string {
  const departure = new Date(trip.start);
  const departureMonth = departure.getUTCMonth();
  const scores = monthlySeasonalScores(result.city, home, trip, nonstopOnly);
  const peakScore = Math.max(...scores.map(point => point ? Math.round(point.score) : -1));
  const peaks = scores.flatMap((point, i) => point && Math.round(point.score) === peakScore ? [i] : []);
  const peakLabel = peaks.length === 1 ? `<span class="monthly-score-peak">Highest in ${months[peaks[0]]}</span>` : '';
  const tripLength = result.tripDays === 1 ? 'Day trips' : `${result.tripDays}-day trips`;
  const place = escapeHtml(destinationName(result.city));
  const path = scores.map((point, i) => point ? `${scores[i - 1] ? 'L' : 'M'}${i * 10 + 5} ${100 - point.score}` : '').join(' ');

  return `<section class="monthly-scores" aria-label="Match score by month for ${place}">
    <div class="monthly-score-heading"><h3>Match score by month</h3>${peakLabel}</div>
    <p class="monthly-score-context">${tripLength} from ${escapeHtml(home.name)} · ${departure.getUTCFullYear()}${nonstopOnly ? ' · Nonstop' : ''}</p>
    <div class="monthly-score-grid">
      <div class="monthly-score-axis" aria-hidden="true"><span>100</span><span>50</span><span>0</span></div>
      <div class="monthly-score-plot" aria-hidden="true">
        <svg viewBox="0 0 120 100" preserveAspectRatio="none" aria-hidden="true">
          <path class="monthly-score-guides" d="M0 0H120 M0 50H120 M0 100H120" vector-effect="non-scaling-stroke" />
          <path class="monthly-score-line" d="${path}" vector-effect="non-scaling-stroke" />
        </svg>
        ${scores.map((point, i) => point ? `<i class="monthly-score-dot${i === departureMonth ? ' trip-month' : ''}" style="left:${(i + .5) * 100 / 12}%;bottom:${point.score}%"></i>` : '').join('')}
      </div>
      <ol class="monthly-score-values" role="list" aria-label="January through December scores">
        ${scores.map((point, i) => {
          const label = point ? `${months[i]} · ${point.score.toFixed(1)} out of 100 · ${dateLabel.formatRange(new Date(point.dates.start), new Date(point.dates.end))}`
            : `${months[i]} · score unavailable`;
          return `<li${i === departureMonth ? ' class="trip-month" aria-current="date"' : ''} title="${escapeHtml(label)}">
            <span aria-hidden="true">${months[i].slice(0, 3)}</span><strong aria-hidden="true">${point ? Math.round(point.score) : '–'}</strong><span class="sr-only">${escapeHtml(label)}</span>
          </li>`;
        }).join('')}
      </ol>
    </div>
    <p class="monthly-score-basis">Departure dates adjust for shorter months. Scores use historical climate, estimated crowds, and modeled travel.</p>
  </section>`;
}
