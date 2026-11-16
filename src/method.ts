import { BANDS } from './format';

export const methodContent = `
  <h2 id="method-title">How the colors work</h2>
  <p>Each dot is a destination’s match to your dates and preferences. Countries are neutral geography: a city’s score never colors its whole country.</p>
  <div class="method-bands">${BANDS.map(b => `<div><span class="swatch" style="--swatch:${b.color}"></span><strong>${b.label}</strong><span>${b.range}</span></div>`).join('')}</div>
  <p class="method-caption">Bands use the rounded match score. These thresholds are design choices, not measured probabilities or universal travel ratings. A missing dot means no included destination data, not a poor match.</p>
  <h3>What goes into a match</h3>
  <ol class="method-steps">
    <li><strong>Combine weather, rain, and crowds.</strong> Your three weights set their relative influence. A weighted geometric mean makes a weak factor pull the match down. Turning a weight to zero removes that factor.</li>
    <li><strong>Apply a seasonal risk adjustment.</strong> Fixed hurricane, typhoon, cyclone, and monsoon curves reduce the result. These are rough assumptions, not storm probabilities.</li>
    <li><strong>Account for time spent traveling.</strong> Estimated usable days reduce the result again. The Short travel slider controls this adjustment separately; it is not a fourth share of the same weighted average.</li>
  </ol>
  <p>Select a destination, then <strong>Why this score?</strong> to see its component fits and exact point deductions.</p>
  <details class="method-rules"><summary>The current rules, in detail</summary>
    <dl>
      <dt>Weather fit</dt><dd>Full fit at a daytime high of 20–29°C (68–84°F). Below 20°C, fit falls linearly to zero at 7°C; above 29°C, it falls to zero at 37°C. If home is below 12°C or above 31°C, a more comfortable destination gets up to 0.15 extra fit, capped at 1.</dd>
      <dt>Dry fit</dt><dd>1 − monthly rainfall ÷ 240 mm, bounded between 0 and 1. This compares monthly rain volume; it cannot tell you how many days will be wet.</dd>
      <dt>Crowd fit</dt><dd>1 − crowd level. Assigned crowd levels are 0.2 off-season, 0.5 shoulder, and 0.8 peak, blended between months. Listed holiday/event adjustments are added, then levels are limited to 0.05–0.92.</dd>
      <dt>Combine and sample</dt><dd>For each sample: exp(Σ weight × ln(max(0.03, fit)) ÷ Σ weight). If all three weights are zero, the base is 50. Seasonal risk then multiplies each sample; adjusted samples are averaged. Monthly values are interpolated, not daily observations. Trips over 90 days use spaced samples.</dd>
      <dt>Travel adjustment</dt><dd>Multiply by (usable days ÷ trip days) raised to (Short travel weight ÷ 7). The usable share has a 0.03 floor. Weight zero removes this adjustment. Usable days subtract round-trip travel hours ÷ 14 plus a time-shift allowance of 0.1 day per hour, capped at 1.2 days.</dd>
      <dt>Travel time estimate</dt><dd>Great-circle distance under 450 km is treated as driving at 75 km/h. Otherwise, flight time is distance ÷ 780 km/h + 2.6 hours, plus 2 hours above 7,000 km and another 2 above 12,500 km. This does not check actual roads, routes, connections, or schedules. Time zones ignore daylight saving.</dd>
    </dl>
  </details>
  <div class="data-note"><strong>Data quality is separate from fit</strong><p>The current climate inputs are approximate monthly values without documented sources or reference periods. Crowd levels and seasonal penalties are hand-set. Holiday tables are incomplete; lunar dates cover 2025–2029. The score does not yet account for prices, humidity, air quality, visas, or your preferred activities.</p><p>Climate averages do not predict specific vacation days. There is no “good days” forecast in this model.</p></div>
`;
