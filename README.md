# Where to go, and when

A lightweight vacation globe with 71 destinations, scored for your travel dates, home city, and trip length. The globe fills the center of the first screen, with collapsible trip settings on the left and independently scrolling recommendations on the right. Built with TypeScript, Vite, D3 v7, and `topojson-client`; no framework, API keys, or backend.

## Run

Requires Node.js 22.12+.

```sh
npm install
npm run dev
```

## Test and build

```sh
npm test
npm run build
```

The build produces **only `dist/index.html`**. JavaScript, CSS, reference data, the favicon, and `world-atlas@2/countries-110m.json` are included in that file. Open it directly in a modern browser, or serve it with `npm run preview`. The built app makes no runtime network requests and works offline. The development server uses Vite's live-reload connection.

## Use

- Open **Your trip** to choose a home city and inclusive date range; the list reranks and the globe flies to the best result.
- Choose **All**, **Domestic**, or **International** under Destinations. The filter uses the home city's country and updates recommendations and globe markers. Puerto Rico is grouped with the United States. Empty results include a button to restore All.
- Use **Your trip** and **Your picks** to toggle the side panels. At 1100px and below, both panels start closed and open as accessible drawers, keeping the globe visible on arrival. Escape or the close button dismisses a drawer.
- Set your preferred daytime-high temperature range in °F or °C. Invalid or reversed ranges leave the last valid results visible. Changing units preserves the underlying range.
- Adjust four percentage weights. The edited weight is held fixed while the remaining 100% is distributed proportionally across the other factors, using deterministic integer rounding. If the others are all zero, the remainder is split equally. Changing preferences reranks without a fly-to.
- Drag to rotate, scroll or pinch to zoom, use the visible zoom/reset buttons, or use arrow keys and `+`/`−` while the globe is focused. The projection resizes with the viewport and panel layout.
- Click a country, destination dot, ranked row, or option card to center it.
- A selected city stays highlighted on the globe and in the recommendations. Its summary appears below the globe; **Why this score?** opens its weather, travel, events, component fits, weights, and additive point contributions, including on touch screens.
- Countries are neutral and never scored. Hovering a country lists only covered destinations under the current filters. **What do the colors mean?** opens the match thresholds, calculation rules, and data limitations. Bands use rounded scores so labels and numbers agree.
- Hover over countries, dots, and recommendation cards for details. Top-ten dots also show details on keyboard focus; Escape dismisses tooltips. Drawers trap keyboard focus while open; dialogs use native browser focus management.
- Toggle spin and Fahrenheit/Celsius above the globe. Reset preferences restores 20–30°C (68–86°F) and weights of 40/25/10/25%. Colors follow the system's light/dark preference. Reduced-motion users start with spin paused and immediate fly-to positioning.

## Source layout

- `src/data/`: destination and origin metadata, fixed time zones, estimated event/crowd/risk reference data, and the imported climate baseline.
- `src/scoring.ts`: pure date sampling, interpolation, climate scoring, distance/travel calculations, and ranking functions.
- `src/scoring.test.ts`: 35 tests covering source completeness, climate distributions, percentage rebalancing, personalized temperature ranges, additive score reconstruction, seasonal notes, domestic/international filters, and color thresholds.
- `src/globe.ts`: bundled topology, orthographic projection, gestures, animation, markers, and label placement.
- `src/panels.ts`: responsive panel toggles, modal drawers, keyboard focus, and backdrop behavior.
- `src/format.ts`: rating bands, units, reasons, and tooltip presentation.
- `src/method.ts`: the current scoring rules and data provenance disclosure.
- `src/main.ts` and `src/style.css`: accessible controls, responsive lists, and light/dark styles.

Calendar calculations use UTC days to avoid daylight-saving errors. Destination time zones are the supplied fixed UTC offsets. Country centroids are only used for navigation. Lunar holiday tables cover 2025–2029; recurring fixed-date and Gregorian events are generated for other years too.

## Climate data and provenance

The bundled baseline is derived from **NASA POWER / MERRA-2 daily point data, 1991-01-01 through 2020-12-31**, at each destination/home coordinate. There are 83 unique locations covering all 71 destinations and 24 origins; every location has 10,958 daily records. No original unsourced temperature/rainfall arrays are used.

- Source methodology: https://power.larc.nasa.gov/docs/methodology/
- Daily API: https://power.larc.nasa.gov/docs/services/api/temporal/daily/
- Variables: `T2M_MAX` and `T2M_MIN` in °C, and `PRECTOTCORR` in mm/day, with Local Solar Time day boundaries.
- Resolution: source-native **0.5° latitude × 0.625° longitude** MERRA-2 grid. This is reanalysis at a location, not a city weather-station measurement. Coastal microclimates, elevation, and within-city differences may not be resolved. Regions/islands represent their listed point.
- Derived monthly values: mean daily high/low, 10th/90th high percentiles, mean monthly precipitation, count of days with at least 1 mm precipitation, and a 0.1°C histogram of daily highs. Histograms retain sample counts so temperature fits can be recalculated for any preferred range.
- `src/data/climate.json` retains each source request URL, retrieval timestamp, API version, grid elevation, and SHA-256 of the raw response. Each city links to its data request in the app.
- Data provided by the NASA POWER Project at NASA Langley Research Center. Aggregation and preference scoring are this app's transformations; NASA does not endorse the rankings.

To reproduce or refresh the import (Python standard library only):

```sh
python3 scripts/import-climate.py
```

Coordinates live in `data/climate-locations.json`. The importer caches full responses in ignored `.climate-cache/`, uses two concurrent requests, validates dates, units, fill values, and physical bounds, then atomically replaces the bundled JSON after all locations pass. Remove a cached response only when intentionally refreshing it. The app makes no runtime data requests.

## Scoring model

`match = temperatureFit × temperatureWeight + dryFit × dryWeight + crowdFit × crowdWeight + travelFit × travelWeight`

Fits are 0–1; integer weights always sum to 100. Defaults are a user-editable preference, not empirical importance estimates.

- **Temperature:** historical fraction of daily highs inside the inclusive preferred range, using 0.1°C histogram bins.
- **Dry:** historical fraction of days with less than 1 mm total precipitation (including snowfall water equivalent). Monthly rain volume is context only.
- **Crowds:** 1 minus the original estimated seasonal crowd level plus dated event adjustments. No measured attendance claim.
- **Travel:** estimated usable days divided by trip days. Great-circle distance, assumed speeds/airport allowances, and fixed time shifts estimate time cost; roads, actual connections, and schedules are not checked.

Monthly values are blended between mid-months for each sampled trip date, then averaged. Longer trips retain the original bounded sampling (at most 90 dates). Seasonal risk notes are separate and do not change the score. There are no geometric means, country scores, popularity factors, escape bonuses, or additional travel/storm multipliers. Contribution rounding preserves the displayed total. The score is a preference match, not a weather forecast or trip-success probability.
