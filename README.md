# Where to go, and when

A lightweight vacation globe with 71 destinations, scored for your travel dates, home city, and trip length. The larger globe fills the center of the first screen, with collapsible trip settings on the left, independently scrolling recommendations on the right, and a compact priorities strip at the bottom center. Built with TypeScript, Vite, D3 v7, and `topojson-client`; no framework, API keys, or backend.

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
- Adjust four percentage weights in **Your priorities** beneath the globe. The strip can collapse; it starts collapsed on phones. **Reset preferences** stays in this centered strip. The edited weight is held fixed while the remaining 100% is distributed proportionally across the other factors, using deterministic integer rounding. If the others are all zero, the remainder is split equally. Changing preferences reranks without a fly-to.
- Drag to rotate, scroll or pinch to zoom, use the visible zoom/reset buttons, or use arrow keys and `+`/`−` while the globe is focused. The projection resizes with the viewport and panel layout.
- Click a country, destination dot, ranked row, or option card to center it.
- A selected city stays highlighted on the globe and in the recommendations. Its summary appears below the globe; **Why this score?** opens its weather, travel, events, component fits, weights, and additive point contributions, including on touch screens.
- Countries are neutral and never scored. Hovering a country lists only covered destinations under the current filters. **Scoring & data** opens the match thresholds, calculation rules, and data limitations. The globe itself has no legend or gesture instructions underneath. Bands use rounded scores so labels and numbers agree.
- Hover over countries, dots, and recommendation cards for details. Top-ten dots also show details on keyboard focus; Escape dismisses tooltips. Drawers trap keyboard focus while open; dialogs use native browser focus management.
- Toggle spin and Fahrenheit/Celsius above the globe. Reset preferences restores 20–30°C (68–86°F) and weights of 40/25/10/25%. Colors follow the system's light/dark preference. Reduced-motion users start with spin paused and immediate fly-to positioning.

## Source layout

- `src/data/`: destination and origin metadata, fixed time zones, estimated event/crowd/risk reference data, and the imported climate baseline.
- `src/scoring.ts`: pure date sampling, interpolation, climate scoring, distance/travel calculations, and ranking functions.
- `src/scoring.test.ts`: 45 tests covering source completeness, climate distributions, percentage rebalancing, personalized temperature ranges, additive score reconstruction, seasonal notes, domestic/international filters, and color thresholds.
- `src/globe.ts`: bundled topology, orthographic projection, gestures, animation, markers, and label placement.
- `src/panels.ts`: responsive panel toggles, modal drawers, keyboard focus, and backdrop behavior.
- `src/format.ts`: rating bands, units, reasons, and tooltip presentation.
- `src/method.ts`: the current scoring rules and data provenance disclosure.
- `src/main.ts` and `src/style.css`: accessible controls, responsive lists, and light/dark styles.

Calendar calculations use UTC days to avoid daylight-saving errors. Destination time zones are the supplied fixed UTC offsets. Country centroids are only used for navigation. Lunar holiday tables cover 2025–2029; recurring fixed-date and Gregorian events are generated for other years too.

## Climate data and provenance

The bundled **1991–2020** baseline covers 83 reference points: all 71 destinations and 24 origins, with overlap. Temperature and precipitation each retain their own source, record counts and coverage. The app makes no runtime weather requests. Current destination coverage: **28 station / 6 mixed / 37 grid**.

- **Nearby observations:** NOAA NCEI [GHCN-Daily Version 3](https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily), [dataset DOI](https://doi.org/10.7289/V5D21VHZ), plus **Source: MeteoSwiss**, [SwissMetNet historical daily observations](https://opendatadocs.meteoswiss.ch/a-data-groundbased/a1-automatic-weather-stations) for Interlaken station INT.
- **Regional fallback:** [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/) at the destination coordinate. Native 0.5° latitude × 0.625° longitude grid; `T2M_MAX`, `T2M_MIN` (°C) and `PRECTOTCORR` (mm/day), Local Solar Time. Data provided by the NASA POWER Project at NASA Langley Research Center.
- **Reference elevations:** [Copernicus DEM GLO-90, 2021](https://doi.org/10.5270/ESA-c5d3d65) via [Open-Meteo](https://open-meteo.com/en/docs/elevation-api), 90 m resolution. Used for station screening, not temperature adjustment.

NOAA station selection is deterministic, nearest first. National-agency supplements are reviewed by station identity and location. Every accepted site is at most **15 km away and 150 m elevation difference**. NOAA inventory is prefiltered for a potential baseline spanning 1996–2015 or longer, then actual daily records are checked. MeteoSwiss supplements the known NOAA coverage gap at Interlaken, with the same distance, elevation and completeness rules. Selection is independent for temperature and precipitation, so two nearby stations may be used. Distance and elevation are screening choices, not proof of identical coastal exposure or terrain. No arbitrary blending or lapse-rate correction is applied. Documented agency station histories are retained, including Prague’s location change and Banff’s station succession: ECCC specifies 3050520 through 1995-03-31 and 3050519 from 1995-04-01. Both sites pass the same geography checks; no estimates or neighboring observations fill gaps.

A station year-month needs ≥90% valid daily observations. For every calendar month, retained observations must cover ≥80% of possible 1991–2020 days, with ≥20 qualifying years and ≥5 in each baseline decade (1991–2000, 2001–2010, 2011–2020). One failing calendar month keeps that whole variable on the grid baseline; station and grid days are never silently mixed. The UI labels all-grid and mixed-source destinations, identifies the grid variable, and explains the fallback reason.

[NOAA flags](https://www.ncei.noaa.gov/pub/data/ghcn/daily/readme.txt): exclude missing -9999 values, any nonblank quality flag, and missing source flags. Temperature requires paired high/low values, no measurement flags (including hourly-derived extrema), and low ≤ high. Precipitation excludes partial/ambiguous reports, missing-presumed-zero records and GSOD/SSOD source flags S/2; accept only blank/B/D/F/G/T measurement flags. Trace is below the 1 mm wet-day threshold. Multiday totals are not used. MeteoSwiss daily CSV uses `tre200dx`, `tre200dn` and `rre150d0`, °C/°C/mm, published provider quality checks, and empty fields for missing values. Its precipitation interval is 06:00–06:00 UTC. Observation day boundaries can differ by provider/station. These historical distributions are not a homogenized trend analysis.

Monthly outputs: paired mean high/low, high-temperature percentiles and 0.1°C histogram; precipitation count, wet-day count (≥1 mm, including snow water equivalent), and mean daily precipitation × average calendar-month length. **Each variable has its own denominator. Missing rain is never dry.** No claim that station observations describe every beach, slope or neighborhood; regional destinations represent the listed coordinate.

`src/data/climate.json` stores per-variable source URLs, station IDs/names, coordinates, elevation/distance differences, retrieval dates, raw SHA-256 hashes, version and month-by-month coverage. `data/station-audit.json` records evaluated candidates and accepted/rejected coverage. Raw public responses are cached in ignored `.climate-cache/`; no keys are needed. Aggregation and scoring are this app’s transformations; providers do not endorse the rankings.

National-agency additions in `scripts/agency_sources.py`:

- [Météo-France](https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-quotidiennes): Paris-Montsouris 75114001 and Tahiti/Faaa 98715002. Daily TX/TN/RR with quality flags 0/1 only; exclude doubtful 2 and filtered-only 9. Licence Ouverte 2.0 attribution: Météo-France.
- [Hong Kong Observatory](https://data.gov.hk/en-data/dataset/hk-hko-rss-daily-temperature-info-hko): HKO headquarters, complete C records only; exclude #/missing. Trace <0.05 mm is below the wet-day threshold.
- [Meteorological Service Singapore](https://www.weather.gov.sg/climate-historical-daily/): Paya Lebar S06, 360 monthly files. Agency-published values, no per-record QC flag; skip missing dash/blank values. Metadata is from the 2015 agency report; current coordinates differ by about 0.6 km.
- **Data Source: Environment and Climate Change Canada.** [Banff agency station succession](https://climate.weather.gc.ca/climate_normals/results_1991_2020_e.html?climate_id=3050519#metadata-thread) supports temperature; observed-only precipitation still fails coverage. Exclude E estimates; follow API pagination and exact transition dates. [ECCC licence](https://eccc-msc.github.io/open-data/licence/readme_en/).
- Tenerife now explicitly represents **El Médano south coast**, using [AEMET’s coordinates](https://www.aemet.es/es/eltiempo/prediccion/playas/el-medano-3801705) and qualifying NOAA station SPE00120476 (AEMET C429I). The old mountain point did not represent a coastal getaway.

Additional agency adapters:

- `scripts/agency_americas.py`: [Mexico SMN](https://smn.conagua.gob.mx/es/climatologia/informacion-climatologica/normales-climatologicas-por-estado) supplies dated daily observations for Cancún and Tacubaya Central, Mexico City. `NULO` stays missing; no per-record QC flags are supplied.
- [Galapagos Climatology Database, dataZone, Charles Darwin Foundation](https://datazone.darwinfoundation.org/es/clima/puerto-ayora): Puerto Ayora daily observations, with all 2020 minima excluded following the operator’s instrument-error warning. Source and this app’s derived monthly summaries remain [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), requiring attribution, noncommercial use and share-alike. This licence applies to the derived Puerto Ayora data, not unrelated provider data or app code.
- `scripts/agency_europe_africa.py`: [CHMI](https://opendata.chmi.cz/meteorology/climate/historical_csv/) supplies Praha Karlov observations with only Good quality accepted, preserving both station locations. [National Observatory of Athens / CLIMPACT](https://data.climpact.gr/dataset/e2ae9f71-048f-4565-b24b-f8f15e4c2cf5) supplies Thissio historical data under CC BY 4.0, adapted into monthly summaries; instrument changes and daily observation boundaries remain disclosed.
- `scripts/agency_asia.py`: [JMA daily exports](https://www.data.jma.go.jp/risk/obsdl/) supply Kyoto temperature/precipitation and Tokyo precipitation using normal QC code 8 only. Tokyo temperature is excluded because its 2014 homogeneity break cannot be pooled into one distribution. [KMA daily ASOS observations](https://www.data.go.kr/data/15059093/openapi.do), retrieved through its public annual tables, supply Seoul temperature with KOGL Type 1 attribution; ambiguous precipitation blanks stay missing and precipitation stays grid. Public tables have no per-record QC flags.
- `data/agency-review-*.json` records the reviewed route for each of the 45 previously grid-only destinations. A public archive that could not be retrieved is labeled unverified, not assumed to require an account or payment. Actual record qualification remains separate from access.

For multi-file sources, `rawInputs` lists every URL/hash/retrieval date and `hashScope: "input manifest"` identifies a digest of ordered `{url,sha256}` pairs, canonical JSON with sorted keys and compact separators. A single raw-file hash is not misrepresented as the full series. The detail dialog exposes all source files and documented station history. POST-only exports retain their exact public request parameters; the UI links to the agency’s working export page instead of a broken GET endpoint. NOAA’s global revision is no longer inferred from a stale metadata cache.

Regional reference areas are explicit; locality names were checked against [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), with individual reference links. Remaining grid terrain mismatches ≥300 m are flagged, separately from match scores. The **Data audit** view allows keyboard inspection of every destination, irrespective of its rank, home city, or Domestic/International filter. Its Data status filter distinguishes verified agency login/access requirements, explicit data-request routes, records that failed qualification, and daily records not yet verified. Every agency review links its source and checked date; access alone does not guarantee qualifying observations. `data/climate-audit.json` records the completed audit; `data/climate-audit-before.json` preserves the preceding version’s source counts for comparison; `data/station-audit.json` retains candidate coverage. Agency research was targeted, not exhaustive: Queenstown’s NIWA daily archive requires agency access; Nepal DHM uses a request process; no verified Cusco baseline was obtained. These remain grid estimates. The current review identifies 5 destinations needing agency access, 14 with explicit data-request routes, 1 with insufficient nearby coverage, and 17 with daily records not verified; 8 received full or partial station upgrades.

Rebuild from the cached source responses or fetch missing ones (Python standard library, two concurrent requests):

```sh
python3 scripts/import-stations.py
python3 -m unittest discover -s scripts
python3 scripts/audit-climate.py
npm test
npm run build
```

`import-stations.py` reuses the NASA importer and caches; it is the final dataset entry point. `import-climate.py` alone creates a grid-only intermediate dataset and must be followed by the station importer before building. Remove cached files only for intentional refreshes. A failed download or validation aborts rather than silently degrading a source. Coordinates live in `data/climate-locations.json`.

## Scoring model

`match = temperatureFit × temperatureWeight + dryFit × dryWeight + crowdFit × crowdWeight + travelFit × travelWeight`

Fits are 0–1; integer weights always sum to 100. Defaults are a user-editable preference, not empirical importance estimates.

- **Temperature:** historical fraction of daily highs inside the inclusive preferred range, using 0.1°C histogram bins.
- **Dry:** historical fraction of days with less than 1 mm total precipitation (including snowfall water equivalent). Monthly rain volume is context only.
- **Crowds:** 1 minus the original estimated seasonal crowd level plus dated event adjustments. No measured attendance claim.
- **Travel:** estimated usable days divided by trip days. Great-circle distance, assumed speeds/airport allowances, and fixed time shifts estimate time cost; roads, actual connections, and schedules are not checked.

Monthly values are blended between mid-months for each sampled trip date, then averaged. Longer trips retain the original bounded sampling (at most 90 dates). Seasonal risk notes are separate and do not change the score. There are no geometric means, country scores, popularity factors, escape bonuses, or additional travel/storm multipliers. Contribution rounding preserves the displayed total. The score is a preference match, not a weather forecast or trip-success probability.
