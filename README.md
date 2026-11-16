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
- Choose **All**, **Domestic**, or **International** under Destinations. The filter uses the home city's country, updates recommendations and globe markers, and leaves excluded countries neutral. Puerto Rico is grouped with the United States. Empty results include a button to restore All.
- Use **Your trip** and **Your picks** to toggle the side panels. At 1100px and below, both panels start closed and open as accessible drawers, keeping the globe visible on arrival. Escape or the close button dismisses a drawer.
- Adjust the four weights from 0 to 10. Changing a weight reranks without a fly-to.
- Drag to rotate, scroll or pinch to zoom, use the visible zoom/reset buttons, or use arrow keys and `+`/`−` while the globe is focused. The projection resizes with the viewport and panel layout.
- Click a country, destination dot, ranked row, or option card to center it.
- A selected city stays highlighted on the globe and in the recommendations. Its summary appears below the globe; **Details** opens its weather, travel, events, and risks in a dialog, including on touch screens.
- Hover over countries, dots, and recommendation cards for details. Top-ten dots also show details on keyboard focus; Escape dismisses tooltips. Drawers trap keyboard focus while open; dialogs use native browser focus management.
- Toggle spin and Fahrenheit/Celsius above the globe. Reset preferences restores the original weights. Colors follow the system's light/dark preference. Reduced-motion users start with spin paused and immediate fly-to positioning.

## Source layout

- `src/data/`: the exact supplied destination, origin, timezone, event, storm-risk, and country-group reference data.
- `src/scoring.ts`: pure date sampling, interpolation, climate scoring, distance/travel calculations, and ranking functions.
- `src/scoring.test.ts`: 23 tests, including the requested scoring scenarios and home-relative domestic/international filtering, territory grouping, and empty results.
- `src/globe.ts`: bundled topology, orthographic projection, gestures, animation, markers, and label placement.
- `src/panels.ts`: responsive panel toggles, modal drawers, keyboard focus, and backdrop behavior.
- `src/format.ts`: rating bands, units, reasons, and tooltip presentation.
- `src/main.ts` and `src/style.css`: accessible controls, responsive lists, and light/dark styles.

Calendar calculations use UTC days to avoid daylight-saving errors. Destination time zones are the supplied fixed UTC offsets. Broad country estimates use centroid longitude rounded to the nearest UTC hour. Lunar holiday tables cover 2025–2029; recurring fixed-date and Gregorian events are generated for other years too.

Climate data represents approximate long-run averages, not forecasts. Travel estimates are based on great-circle distance, approximate speed, airport time, likely connections, and time shift; they are not actual route schedules or fares.
