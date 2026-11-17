# Where to go, and when

A lightweight vacation globe with 230 destinations, scored for your travel dates, home city, and trip length. The larger globe fills the center of the first screen, with collapsible trip settings on the left and independently scrolling recommendations on the right. Built with TypeScript, Vite, D3 v7, and `topojson-client`; no framework, API keys, or backend.

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

The build produces **only `dist/index.html`**. JavaScript, CSS, reference data, the favicon, and `world-atlas@2/countries-50m.json` are included in that file. Open it directly in a modern browser, or serve it with `npm run preview`. The built app makes no runtime network requests and works offline. The development server uses Vite's live-reload connection.

## Use

- Open **Your trip** to choose a home city and inclusive date range. Choosing a departure city centers the globe there with a gentle 15% zoom. The initial Boston view uses the same framing. Changing dates reranks while keeping your current globe view.
- With Boston selected, **Nonstop flights only** shows flight journeys with a listed nonstop in both directions. It combines with the destination filter and applies to the recommendations and globe. Nearby driving trips are excluded. The preference is inactive for other home cities.
- Boston's recorded nonstop routes to covered destinations appear together, with no selection required. The overview respects **Anywhere / Domestic / Global**, deduplicates shared airport routes, and uses the same nonstop-in-both-directions coverage rule as the flight filter. Clearing a selection restores the selected region view and its filtered route network. This covers the app's destinations, not every airport served from BOS.
- Click a Boston arc or its airport endpoint to select the destination and see its listed airlines and flight time below the globe. Routes have wider click targets, hover/focus highlighting, and Enter/Space keyboard selection. Flight time excludes transfers and layovers; **Outbound / Return** updates the route, time, and carriers together. Dragging across a route still rotates the globe.
- Select a Boston flight destination to highlight its airport-to-airport arcs and labeled connection airports over the network. Switch **Outbound / Return** to inspect each direction, and use **View route** to recenter after rotating or zooming. Solid arcs are outbound; dashed arcs are return. These are illustrative great-circle flight legs, not live aircraft tracks or ground transfers.
- Choose **Anywhere**, **Domestic**, or **Global** under **Where to?**. Global is the renamed abroad option and means destinations outside the departure country. The filter uses the home city's country and updates recommendations and globe markers. Puerto Rico is grouped with the United States. Empty results include a button to restore All.
- Choose **Global** to reveal **Region** in the left trip panel and filter recommendations, destination dots and Boston nonstop route endpoints together. Europe, North America, Central America & Caribbean, South America, Africa, Asia, Middle East and Oceania are available; **All regions** removes the region restriction. Region combines with Global, nonstop and temperature filters. Leaving Global clears the region. A region change also centers and zooms the globe; date/weather changes retain the view. Changing departure city preserves the region filter and centers the new origin. The separate **Compare local areas** explorer retains the detailed island/town comparisons.
- Use **Your trip** and **Your picks** to toggle the side panels. At 1100px and below, both panels start closed and open as accessible drawers, keeping the globe visible on arrival. Escape or the close button dismisses a drawer.
- Near-term recommendations use up to seven days of local daily forecasts from [Open-Meteo](https://open-meteo.com/en/docs). Cards and destination details identify covered dates. Dates outside the forecast or missing from the response use the bundled 1991–2020 climate baseline. The browser fetches forecasts when the selected trip overlaps the forecast window. Globe colors use historical climate.
- Choose **Cool**, **Mild**, or **Warm** for the daytime highs you prefer, or open **Custom range** to set your own. The range contributes to the temperature part of the match score. Invalid ranges preserve the last valid results, and changing units preserves the underlying range.
- **Travel dates** opens a shared calendar for choosing departure and return. Changing dates retains the selected place and camera so seasonal comparisons are easy.
- **Weather on globe** starts with full-land temperature colors for the average daytime high during your dates. A bundled NOAA global climate grid provides continuous coverage, independent of destination and flight filters. Its coarse model can differ from destination dots, which retain local climate sources. The legend follows °F / °C. The **Precipitation** background also covers all land, with a fixed dry-to-wet precipitation scale for your dates. Local droplet icons mark wet periods. Other seasonal views color heat orange, freezing nights purple and storm seasons amber around covered destinations. Symbols identify flags independently of color. Check any combination of seasonal flags and choose one background scale. Clearing all checkboxes restores match colors to dots. **Scoring & data** explains the global layer; **Why this score?** includes local explanations and sources. Historical patterns and seasonal calendars are not forecasts or live alerts.
- Drag to rotate, scroll or pinch to zoom, use the visible zoom/reset buttons, or use arrow keys and `+`/`−` while the globe is focused. The projection resizes with the viewport and panel layout.
- Click a country, destination dot, ranked row, or option card to center it.
- A selected city stays highlighted on the globe and in the recommendations. Its summary appears below the globe; **Why this score?** opens its weather, travel, events, component fits, weights, and additive point contributions, including on touch screens.
- Countries are never scored. Global temperature and precipitation colors vary across land; seasonal flag icons remain tied to included destinations. Hovering a country lists covered destinations under the current filters. **Scoring & data** opens the match thresholds, weather-color and flag rules, and data limitations. Recommendation cards use match labels. Full scores are available in destination details.
- Hover over countries, dots, and recommendation cards for details. Top-ten dots also show details on keyboard focus; Escape dismisses tooltips. Drawers trap keyboard focus while open; dialogs use native browser focus management.
- Toggle spin and Fahrenheit/Celsius above the globe. Colors follow the system's light/dark preference. Reduced-motion users start with spin paused and immediate fly-to positioning.

Broad regions are explicit travel groupings. Overseas destinations follow their location: Tahiti and Honolulu are in Oceania, Tenerife’s three reference points are in Africa, and Puerto Rico is in Central America & Caribbean. Mexico is in North America; Istanbul is grouped with Europe. Domestic/global country rules remain separate, including Puerto Rico as domestic from the US. Tests require every bundled destination to have exactly one broad region.

## Source layout

- `src/data/`: destination and origin metadata, fixed time zones, estimated event/crowd/risk reference data, and the imported climate baseline.
- `src/scoring.ts`: pure date sampling, interpolation, climate scoring, distance/travel calculations, and ranking functions.
- `src/weather.ts` and `src/data/weather-seasons.ts`: date-aware climate flags, sourced recurring seasonal windows, explicit estimate fallbacks, and historical weather context. Wet-season thresholds are documented in Scoring & data; flags add no hidden scoring penalty.
- `src/weather-map.ts`: fixed temperature bands, seasonal colors, readable rank labels and unit-aware legends; map colors remain comparable across dates.
- `src/global-temperature.ts` and `src/data/global-temperature.json`: the global monthly temperature grid, date blending, longitude-safe interpolation and geographic contours. `scripts/import-global-temperature.py` validates and bundles the source file.
- `src/global-climate.ts`: shared trip averaging, cyclic spatial interpolation and spherical-safe contours for full-map climate layers.
- `src/global-rain.ts` / `src/data/global-rain.json`: complete 1991–2020 NOAA global precipitation grid and date-dependent rain contours; `scripts/import-global-rain.py` validates and bundles the source.
- `src/flight-map.ts`: airport-based route geometry and spherical route centering for the globe.
- `src/flights.ts` and `src/data/boston-flights.json`: bundled Boston route estimates, independent outbound/return journeys, and explicit missing-coverage fallbacks.
- `scripts/airline_routes.py`: route-network tooling and the offline `boston` export. Reviewed gateway overrides live in `data/flights/boston-gateways.json`.
- `src/scoring.test.ts`: source completeness, climate distributions, percentage rebalancing, personalized temperature ranges, additive score reconstruction, seasonal notes, domestic/international filters, and color thresholds.
- `src/regions.ts` / `src/regions.test.ts`: geographic membership, regional rankings, overseas exceptions and Boston route filtering.
- `src/weather.test.ts`: local wet-season patterns, exact seasonal boundaries, year-crossing trips, heat/cold flags, overlay selection, temperature filtering, and month navigation.
- `src/global-temperature.test.ts` and `src/global-rain.test.ts`: source coverage, seasonal changes, date sampling, longitude seams and correct projected contour fills.
- `src/globe.ts`: bundled topology, orthographic projection, gestures, animation, markers, and label placement.
- `src/panels.ts`: responsive panel toggles, modal drawers, keyboard focus, and backdrop behavior.
- `src/format.ts`: rating bands, units, reasons, and tooltip presentation.
- `src/method.ts`: the current scoring rules and data provenance disclosure.
- `src/main.ts` and `src/style.css`: accessible controls, responsive lists, and light/dark styles.

Calendar calculations use UTC days to avoid daylight-saving errors. Destination time zones are the supplied fixed UTC offsets. Country centroids are only used for navigation. Lunar holiday tables cover 2025–2029; recurring fixed-date and Gregorian events are generated for other years too.

## Climate data and provenance

The full-map temperature background uses [NOAA PSL’s NCEP–NCAR Reanalysis 1](https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html), specifically the [1991–2020 monthly mean daily maximum air temperature at 2 m](https://www.psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis/Monthlies/surface_gauss/tmax.2m.mon.ltm.1991-2020.nc.das). **NCEP–NCAR Reanalysis 1 data provided by NOAA Physical Sciences Laboratory, Boulder, Colorado, USA.** All 18,048 cells contain 30 years for every month. The importer verifies the period, Kelvin units, valid values and year counts, converts to 0.1°C, and retains the source URL, retrieval date and raw-file SHA-256. Rebuild with `python3 scripts/import-global-temperature.py` (requires NumPy and h5py), or pass `--source /path/to/download.nc`; the original NetCDF is cached locally.

The source has 192 longitudes at 1.875° spacing and 94 Gaussian latitudes. The map uses bilinear spatial interpolation, cyclic longitude wrapping, nearest-row values beyond the polar grid centers, and the same sampled-date/month blending as destination scoring. One-degree display sampling generates smooth color contours, split into 90° longitude tiles so spherical clipping cannot invert a worldwide polygon. This display smoothing does not imply one-degree source resolution. The layer stays global when destination filters change, is clipped to land, and never replaces local climate data or changes match scores. Mountains, islands, coasts and city stations may differ from this coarse model.

The **Wet seasons & rain** layer also covers all land, using [NOAA's 1991–2020 monthly mean surface precipitation rate](https://www.psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis/Monthlies/surface_gauss/prate.sfc.mon.ltm.1991-2020.nc.das) from the same NCEP–NCAR Reanalysis 1 grid. It has all 30 years in all 18,048 cells for every month. `scripts/import-global-rain.py` checks shape, axes, period, units, finite nonnegative values and complete year counts, then converts kg/m²/s to mm/day (×86,400), storing 0.01 mm/day integers, source links, retrieval date and raw-file SHA-256. Rebuild with `python3 scripts/import-global-rain.py` (NumPy + h5py), optionally with `--source /path/to/download.nc`.

Rain uses the same date sampling, monthly blending, spatial interpolation and 90° contour tiles as temperature. Fixed bands are <1, 1–2, 2–4, 4–8, 8–12 and ≥12 mm/day. They describe **mean precipitation including snow water equivalent**, not forecast rain, rain probability, storm intensity or wet-day frequency. The map does not multiply the rate by trip length. Destination droplet icons still use local seasonal/wet-day data; filtering destinations does not remove the global background. Other seasonal layers retain their local flag areas. Both global layers are bundled offline and do not alter scoring.

The trip panel groups origin, destination scope, the Boston nonstop switch and dates. The selected date range is shown on one button, and the shared calendar opens beneath it. Trip duration sits beside the Travel dates heading. Search by city name to choose from 24 origins; the nonstop switch appears only for Boston.

The bundled **1991–2020** baseline covers 230 reference points, including all 230 destinations and all 24 origins. Temperature and precipitation each retain their own source, record counts and coverage. Current destination coverage: **56 station / 10 mixed / 164 grid**.

- **Nearby observations:** NOAA NCEI [GHCN-Daily Version 3](https://www.ncei.noaa.gov/products/land-based-station/global-historical-climatology-network-daily), [dataset DOI](https://doi.org/10.7289/V5D21VHZ), plus **Source: MeteoSwiss**, [SwissMetNet historical daily observations](https://opendatadocs.meteoswiss.ch/a-data-groundbased/a1-automatic-weather-stations) for Interlaken station INT.
- **Regional fallback:** [NASA POWER / MERRA-2](https://power.larc.nasa.gov/docs/methodology/) at the destination coordinate. Native 0.5° latitude × 0.625° longitude grid; `T2M_MAX`, `T2M_MIN` (°C) and `PRECTOTCORR` (mm/day), Local Solar Time. Data provided by the NASA POWER Project at NASA Langley Research Center.
- **Reference elevations:** [Copernicus DEM GLO-90, 2021](https://doi.org/10.5270/ESA-c5d3d65) via [Open-Meteo](https://open-meteo.com/en/docs/elevation-api), 90 m resolution. Used for station screening, not temperature adjustment.

To add locations without refreshing existing climate records, add their coordinates to `data/climate-locations.json` and run `python3 scripts/import-stations.py --only Berlin --only Vienna` with the new names. New destinations use a neutral crowd baseline until seasonal crowd estimates are configured.

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

`match = temperatureFit × temperatureWeight + dryFit × dryWeight + reliability × reliabilityWeight + crowdFit × crowdWeight + travelFit × travelWeight`

Fits are 0–1; integer weights always sum to 100. The app uses fixed weights of 32% temperature, 20% dry days, 13% weather reliability, 10% crowds, and 25% travel.

- **Trip cost:** enter estimated round-trip airfare and nightly lodging in destination details. Estimates are for one traveler in USD and scoped to the origin, destination, dates and route mode for the open session. Complete estimates contribute 10% of the match. Cost fit falls linearly from full credit at $250 plus $75 per night to zero at $1,200 plus $250 per night. These are scoring benchmarks. With missing prices, the original score is preserved. Same-day trips require airfare only.
- **Temperature:** historical highs use 0.1°C histogram bins. Forecast days use the feels-like high when supplied by Open-Meteo, which includes humidity, wind and sunlight. Other dates use air temperatures. Daily lows above 20°C gradually reduce the temperature fit by up to 20% at 26°C or above. Historical days use baseline average lows. This overnight adjustment affects temperature points only.
- **Dry:** historical fraction of days with less than 1 mm total precipitation (including snowfall water equivalent). Monthly rain volume is context only.
- **Weather reliability:** estimated probability that at least half the usable stay is comfortable and dry. Historical temperature and rain are modeled independently within days and across days. Forecast dates use the predicted outcome. Partial travel days count by usable fraction, and trips with more than 90 full usable days use a normal approximation.
- **Crowds:** 1 minus the original estimated seasonal crowd level plus dated event adjustments. No measured attendance claim.
- **Travel:** estimated usable days divided by trip days. Boston flights use stored route durations, separate outbound/return paths, and explicit connection/transfer allowances. Other origins and incomplete Boston directions use the distance estimate. Driving, airport time, transfers and time-zone recovery remain estimates; schedules and bookable connections are not checked.

For historical dates, monthly values are blended between mid-months. Longer trips sample the climate baseline on at most 90 evenly spaced dates. Forecast days are evaluated individually even on long trips. Seasonal risk notes are separate and do not change the score. The weighted score determines recommendation order and match labels. Day trips require at least half a modeled day at the destination. Two- and three-day trips require at least one modeled day. Longer trips require positive usable time. Contribution rounding preserves the displayed total. The score is a preference match, not a weather forecast or trip-success probability.


## Specific regional places

Compare local areas compares Galápagos, Goa, Patagonia, Bali, Tenerife and Maldives reference points. Legacy keys remain stable for source provenance; the UI names the original anchors Puerto Ayora, Bandoli area, El Calafate, Denpasar, El Médano and Malé. Closely overlapping dots are hidden at world scale and separate with zoom; every place remains reachable through regional cards and the audit.

Grid sources carry a `seriesSha256` for each factor, derived from complete dated daily readings (TMAX + TMIN for temperature; precipitation separately). The audit recomputes each fingerprint from its cached raw source. Shared-history warnings only compare grid-backed factors within the same region, never rounded monthly averages. Different fingerprints do not establish resolved microclimate differences. GeoNames locality coordinates are attributed under CC BY 4.0; compact research source manifests are in `data/regional-sources*.json`.


## Offline Boston flights

The single-file build embeds only the compact Boston export, not the full 23 MB source network or Parquet files. It still works with no API keys, backend, or runtime network requests. Choose Boston as the home city to see route labels on recommendations and the outbound/return breakdown under **Why this score?** or a destination in **Data audit**.

`python3 scripts/airline_routes.py boston` reads the existing local `data/flights/jonty.json` and gateway overrides and writes `src/data/boston-flights.json`. It never downloads or refreshes routes. The Python importer requires `networkx` and `pyarrow`; they are not browser or build dependencies. To prepare a separate importer environment, install them with `python3 -m pip install networkx pyarrow`.

The source is [Jonty airline-route-data](https://github.com/Jonty/airline-route-data). The export records its SHA-256, the gateway-configuration SHA-256 and packaging time. The local source has no verified acquisition date or upstream revision, so `snapshotDate` stays null and the UI explicitly says the snapshot date is unknown. Export time must not be described as a flight update date. Flight times are network-level leg durations, not dated offers or guaranteed schedules.

- The schema-v2 export includes airport coordinates and the best nonstop alternative in each direction, even when a connection is faster. Nonstop filtering scores the nonstop alternatives and requires both directed legs; the all-destination data audit retains the unrestricted journey estimates.
- BOS is the only enriched home airport. Outbound and return paths are searched independently with a maximum of one connection. Every selected leg has a positive time and named carriers. Route selection includes connection and destination transfer allowances and excludes hops through a second destination airport.
- Per direction: 45 minutes of Boston ground travel, 120 minutes before departure, 45 minutes after arrival, and 150 minutes per connection. These are app assumptions, not legal minimum connection times or measured waits.
- Automatic local ground transfer: airport-to-place straight-line distance × 1.3 at 50 km/h, rounded up to five minutes with a 30-minute minimum. Geography and roads are not validated by that heuristic.
- [Banff tourism](https://www.banfflakelouise.com/getting-here) supports Calgary as a gateway; the app allows 120 minutes to Banff. [Interlaken Tourism](https://www.interlaken.ch/fileadmin/pdf/toi/toi-2030-portrait-vision-strategy-en.pdf) supports Zurich plus roughly 150 minutes by train. Both mappings extend beyond the automatic 80 km radius. Sources and estimate notes are retained in the export and shown in details.
- Cape Cod uses the mainland HYA gateway in the export and retains the existing nearby-driving estimate in scoring. Known unmodeled island transfers (Maafushi and Puerto Ayora) are never treated as zero-minute ground travel.
- A missing airport, route, or onward transfer uses a distance estimate for that direction. For Boston flights, the share of directions with modeled journeys determines how much of the travel fit counts. One direction gives half credit and two distance-only directions give no travel credit. Each recorded connection also deducts the equivalent of 1.5 hours from the travel fit at three days or less, fading linearly to zero at 14 days. This affects the score without changing estimated time at the destination. The same calculation applies wherever route data is available. Other origins use estimated travel time and time-zone recovery. Partial coverage does not invent a reverse route. Round-trip time cost is `(outboundHours + returnHours) / 14`, plus the existing time-shift recovery allowance.
- Operating dates, seasonal service, through-ticket availability, actual connection waits, prices and booking are outside this offline snapshot. Changing trip dates changes the climate/trip-length score, not route availability.

Regenerate and verify:

```sh
python3 scripts/airline_routes.py boston
python3 -m unittest discover -s scripts -p 'test_airline_routes.py'
npm test
npm run build
```

The importer tests reproduce the bundled artifact from its local inputs. Flight tests cover directional timing, connection allowances, reviewed gateways, nearby driving, other origins, incomplete and one-way coverage, unknown island transfers, and user-facing disclosures.
