import { destinationName } from './regions';
import { easeCubicInOut, geoCentroid, geoCircle, geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-50m.json';
import type { Feature, Geometry } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { band } from './format';
import { climateLabel } from './climate';
import { clamp } from './scoring';
import { flightMapCenter } from './flight-map';
import { primaryWeatherFlag, WEATHER_SYMBOLS, weatherFlagLabel } from './weather';
import { RAIN_COLORS, TEMPERATURE_COLORS, weatherMapColor } from './weather-map';
import { globalTemperatureContours, globalTemperatureForTrip } from './global-temperature';
import { globalRainContours, globalRainForTrip } from './global-rain';
import type { FlightMap, NonstopFlightMap, RouteAirport } from './flight-map';
import type { CityScore, Country, Origin, RankedCity, Trip, WeatherKind, WeatherLayer } from './types';

type CountryFeature = Feature<Geometry, { name: string }>;
interface MapCountry { feature: CountryFeature; country: Country }
interface LabelBox { left: number; top: number; right: number; bottom: number }
interface Callbacks {
  cityHover: (city: CityScore, x: number, y: number) => void;
  countryHover: (country: Country, x: number, y: number) => void;
  citySelected: (city: CityScore) => void;
  routeSelected: (route: NonstopFlightMap) => void;
  hideTooltip: () => void;
  spinChanged: (spinning: boolean) => void;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function element<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const result = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
  return result;
}
const collection = feature(world as unknown as Topology<{ countries: GeometryCollection }>, world.objects.countries as GeometryCollection);
const MAP_COUNTRIES: readonly MapCountry[] = collection.features.map(item => {
  const shape = item as CountryFeature;
  const [lon, lat] = geoCentroid(shape);
  return { feature: shape, country: { name: shape.properties.name, lat, lon } };
});

export class Globe {
  private projection = geoOrthographic().translate([380, 260]).scale(240).rotate([75, -25, 0]).clipAngle(90);
  private path = geoPath(this.projection);
  private rotation: [number, number, number] = [75, -25, 0];
  private scale = 240;
  private baseScale = 240;
  private width = 760;
  private height = 520;
  private selectedName: string | null = null;
  private weatherLayer: WeatherLayer = 'temperature';
  private weatherKinds?: ReadonlySet<WeatherKind>;
  private resizeObserver: ResizeObserver;
  private spin = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private sphere = element('path', { class: 'ocean', 'aria-hidden': 'true' });
  private graticule = element('path', { class: 'graticule', 'pointer-events': 'none', 'aria-hidden': 'true' });
  private graticuleGeometry = geoGraticule10();
  private countryLayer = element('g', { 'aria-hidden': 'true' });
  private weatherLand = element('path', { id: 'weather-land-shape' });
  private climateLayer = element('g', { class: 'climate-surface', 'clip-path': 'url(#weather-land)', 'pointer-events': 'none', 'aria-hidden': 'true' });
  private climateBase = element('use', { href: '#weather-land-shape', fill: TEMPERATURE_COLORS[0].color });
  private climateContours: { geometry: Geometry; node: SVGPathElement }[] = [];
  private climateSurfaceKey = '';
  private climateTrip?: Trip;
  private countryOutlines = element('use', { href: '#weather-land-shape', class: 'country-outlines', 'pointer-events': 'none', 'aria-hidden': 'true' });
  private weatherAreaLayer = element('g', { class: 'weather-area-layer', 'clip-path': 'url(#weather-land)', 'pointer-events': 'none', 'aria-hidden': 'true' });
  private weatherAreas: { score: CityScore; node: SVGGElement; shapes: { geometry: Geometry; path: SVGPathElement }[] }[] = [];
  private cityLayer = element('g');
  private nonstopLayer = element('g', { class: 'nonstop-route-layer', role: 'group', 'aria-hidden': 'true', 'pointer-events': 'none' });
  private nonstopRoutes: NonstopFlightMap[] = [];
  private nonstopNodes: { map: NonstopFlightMap; node: SVGGElement; arc: SVGPathElement; hit: SVGPathElement }[] = [];
  private nonstopAirports: { airport: RouteAirport; node: SVGGElement; label?: SVGTextElement }[] = [];
  private nonstopCenter: [number, number] | null = null;
  private routeLayer = element('g', { class: 'flight-route-layer', role: 'img', 'aria-hidden': 'true', 'pointer-events': 'none' });
  private routeAirportLayer = element('g', { class: 'route-airports', 'aria-hidden': 'true', 'pointer-events': 'none' });
  private routeMap: FlightMap | null = null;
  private routePaths: SVGPathElement[] = [];
  private routeAirports: { airport: RouteAirport; node: SVGGElement; label: SVGTextElement }[] = [];
  private routeLabelBoxes: LabelBox[] = [];
  private homeLayer = element('g', { class: 'home-marker', 'pointer-events': 'none' });
  private countryPaths: { map: MapCountry; node: SVGPathElement }[] = [];
  private cityNodes: { score: CityScore; rank?: number; node: SVGGElement; circle: SVGCircleElement; label: SVGTextElement; weather: SVGGElement; weatherIcon: SVGPathElement; weatherStem: SVGPathElement }[] = [];
  private home?: Origin;
  private pointers = new Map<number, { x: number; y: number }>();
  private gestureTravel = 0;
  private suppressClickUntil = 0;
  private flight?: { start: number; from: [number, number, number]; to: [number, number, number]; fromScale: number; toScale: number };
  private frame = 0;
  private lastTime = 0;
  private lastDraw = 0;
  private userInteracted = false;

  constructor(private svg: SVGSVGElement, private callbacks: Callbacks) {
    this.resizeObserver = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width < 1 || height < 1) return;
      const previousBaseScale = this.baseScale, zoom = this.scale / previousBaseScale;
      this.width = width; this.height = height;
      this.baseScale = Math.min(width, height) * 0.5;
      this.scale = clamp(this.baseScale * zoom, this.baseScale * 0.79, 60000);
      if (this.flight) {
        const ratio = this.baseScale / previousBaseScale;
        this.flight.fromScale *= ratio; this.flight.toScale *= ratio;
      }
      this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      this.projection.translate([width / 2, height / 2]);
      this.callbacks.hideTooltip();
      this.draw();
    });
    this.resizeObserver.observe(svg);
    const definitions = element('defs'), weatherClip = element('clipPath', { id: 'weather-land' });
    weatherClip.append(element('use', { href: '#weather-land-shape' })); definitions.append(this.weatherLand, weatherClip);
    this.climateLayer.append(this.climateBase);
    this.svg.append(definitions, this.sphere, this.countryLayer, this.climateLayer, this.weatherAreaLayer, this.countryOutlines, this.graticule, this.nonstopLayer, this.routeLayer, this.cityLayer, this.homeLayer, this.routeAirportLayer);
    for (const map of MAP_COUNTRIES) {
      const node = element('path', { class: 'country', 'data-country': map.country.name });
      node.addEventListener('pointermove', event => {
        if (!this.pointers.size) this.callbacks.countryHover(map.country, event.clientX, event.clientY);
      });
      node.addEventListener('pointerleave', () => this.callbacks.hideTooltip());
      node.addEventListener('click', event => {
        if (performance.now() < this.suppressClickUntil) return;
        event.stopPropagation();
        this.flyTo(map.country.lon, map.country.lat);
      });
      this.countryLayer.append(node);
      this.countryPaths.push({ map, node });
    }
    this.homeLayer.append(element('path', { d: 'M-6,0H6M0,-6V6' }), element('text', { x: '10', y: '4' }));
    this.svg.addEventListener('pointerdown', event => this.pointerDown(event));
    this.svg.addEventListener('pointermove', event => this.pointerMove(event));
    this.svg.addEventListener('pointerup', event => this.pointerUp(event));
    this.svg.addEventListener('pointercancel', event => this.pointerUp(event));
    this.svg.addEventListener('lostpointercapture', event => this.pointerUp(event));
    this.svg.addEventListener('wheel', event => {
      event.preventDefault();
      this.zoom(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });
    this.svg.addEventListener('keydown', event => {
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      this.interact();
      const rotationStep = 8 * this.baseScale / this.scale;
      if (event.key === 'ArrowLeft') this.rotation[0] -= rotationStep;
      if (event.key === 'ArrowRight') this.rotation[0] += rotationStep;
      if (event.key === 'ArrowUp') this.rotation[1] = clamp(this.rotation[1] - rotationStep, -90, 90);
      if (event.key === 'ArrowDown') this.rotation[1] = clamp(this.rotation[1] + rotationStep, -90, 90);
      if (event.key === '+' || event.key === '=') this.scale = clamp(this.scale * 1.1, this.baseScale * 0.79, 60000);
      if (event.key === '-') this.scale = clamp(this.scale / 1.1, this.baseScale * 0.79, 60000);
      this.draw();
    });
    this.callbacks.spinChanged(this.spin);
    this.draw();
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  update(cities: readonly CityScore[], ranked: readonly RankedCity[], home: Origin): void {
    this.home = home;
    this.weatherAreaLayer.replaceChildren();
    this.weatherAreas = cities.map(score => {
      const node = element('g', { class: 'weather-area', 'data-city': score.city.name });
      const shapes = [4, 2.6, 1.3].map((radius, i) => {
        const geometry = geoCircle().center([score.city.lon, score.city.lat]).radius(radius).precision(8)();
        const path = element('path', { opacity: String([.22, .3, .45][i]) });
        node.append(path); return { geometry, path };
      });
      this.weatherAreaLayer.append(node);
      return { score, node, shapes };
    });
    this.paintWeatherAreas();
    const ranks = new Map(ranked.slice(0, 10).map(city => [city.city.name, city.rank]));
    this.cityLayer.replaceChildren();
    // Ranked markers are drawn last so small background dots cannot obscure them.
    this.cityNodes = [...cities].sort((a, b) => Number(ranks.has(a.city.name)) - Number(ranks.has(b.city.name))).map(score => {
      const rank = ranks.get(score.city.name);
      const flags = score.weatherFlags.map(weatherFlagLabel).join(', ');
      const node = element('g', { class: 'city-marker', 'data-city': score.city.name, role: 'button', tabindex: rank ? '0' : '-1', 'aria-label': `${destinationName(score.city)}, ${band(score.score).label}. ${climateLabel(score.climate)}.${flags ? ` Seasonal weather: ${flags}.` : ''} Center on globe.` });
      const circle = element('circle', { fill: band(score.score).color, opacity: rank ? '1' : '0.45' });
      const label = element('text', { class: `city-label${rank ? ' top-label' : ''}`, y: '4' });
      label.textContent = destinationName(score.city);
      const weather = element('g', { class: 'weather-marker', 'aria-hidden': 'true' });
      const weatherStem = element('path', { class: 'weather-stem' });
      const weatherIcon = element('path');
      weather.append(weatherStem, element('circle', { r: '8' }), weatherIcon);
      node.append(circle, label, weather);
      node.addEventListener('pointermove', event => {
        if (!this.pointers.size) {
          event.stopPropagation();
          this.callbacks.cityHover(score, event.clientX, event.clientY);
        }
      });
      node.addEventListener('pointerleave', () => this.callbacks.hideTooltip());
      node.addEventListener('focus', () => {
        const bounds = node.getBoundingClientRect();
        this.callbacks.cityHover(score, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      });
      node.addEventListener('blur', () => this.callbacks.hideTooltip());
      node.addEventListener('click', event => {
        if (performance.now() < this.suppressClickUntil) return;
        event.stopPropagation();
        this.flyTo(score.city.lon, score.city.lat);
        this.callbacks.citySelected(score);
      });
      node.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); this.flyTo(score.city.lon, score.city.lat); this.callbacks.citySelected(score);
        }
      });
      this.cityLayer.append(node);
      return { score, rank, node, circle, label, weather, weatherIcon, weatherStem };
    });
    this.homeLayer.querySelector('text')!.textContent = `Home: ${home.name}`;
    this.draw();
  }

  focusLocation(lon: number, lat: number, zoom: number, initial = false): void {
    if (initial && this.userInteracted) return;
    this.flyTo(lon, lat, true, zoom);
  }

  flyTo(lon: number, lat: number, userAction = true, zoom?: number): void {
    if (userAction) this.interact();
    const longitude = this.rotation[0] + (((-lon - this.rotation[0]) % 360 + 540) % 360 - 180);
    const target: [number, number, number] = [longitude, -lat, 0];
    const toScale = zoom === undefined ? this.scale : clamp(this.baseScale * zoom, this.baseScale * .79, 60000);
    if (this.reducedMotion) {
      this.rotation = target;
      this.scale = toScale;
      this.draw();
    } else this.flight = { start: performance.now(), from: [...this.rotation], to: target, fromScale: this.scale, toScale };
  }

  toggleSpin(): void {
    this.userInteracted = true;
    this.flight = undefined;
    this.spin = !this.spin;
    this.callbacks.hideTooltip();
    this.callbacks.spinChanged(this.spin);
  }

  setSelected(name: string | null): void {
    this.selectedName = name;
    this.draw();
  }

  setWeatherLayer(layer: WeatherLayer, kinds: ReadonlySet<WeatherKind>): void {
    this.weatherLayer = layer;
    this.weatherKinds = kinds;
    this.updateClimateSurface();
    this.paintWeatherAreas();
    this.draw();
  }

  setWeatherTrip(trip: Trip): void {
    this.climateTrip = { ...trip };
    this.updateClimateSurface();
  }

  private updateClimateSurface(): void {
    const trip = this.climateTrip;
    if (!trip || (this.weatherLayer !== 'temperature' && this.weatherLayer !== 'wet')) return;
    const key = `${this.weatherLayer}/${trip.start}/${trip.end}`;
    if (key === this.climateSurfaceKey) return;
    const rain = this.weatherLayer === 'wet';
    const contours = rain ? globalRainContours(globalRainForTrip(trip)) : globalTemperatureContours(globalTemperatureForTrip(trip));
    this.climateSurfaceKey = key;
    this.climateLayer.dataset.trip = `${trip.start}/${trip.end}`;
    this.climateLayer.dataset.layer = this.weatherLayer;
    this.climateBase.setAttribute('fill', (rain ? RAIN_COLORS : TEMPERATURE_COLORS)[0].color);
    this.climateLayer.replaceChildren(this.climateBase);
    this.climateContours = contours.map(({ geometry, color, minimum }) => {
      const node = element('path', { fill: color, 'data-minimum': String(minimum) });
      this.climateLayer.append(node);
      return { geometry, node };
    });
  }

  private paintWeatherAreas(): void {
    const fullMap = this.weatherLayer === 'temperature' || this.weatherLayer === 'wet';
    this.climateLayer.style.display = fullMap ? '' : 'none';
    this.countryOutlines.style.display = fullMap ? '' : 'none';
    this.weatherAreaLayer.style.display = this.weatherLayer === 'off' || fullMap ? 'none' : '';
    for (const { score, node } of this.weatherAreas) {
      const color = weatherMapColor(score, this.weatherLayer, this.weatherKinds);
      node.style.display = color ? '' : 'none';
      if (color) node.setAttribute('fill', color);
    }
  }

  setNonstopRoutes(routes: NonstopFlightMap[]): void {
    this.nonstopRoutes = routes;
    this.nonstopLayer.replaceChildren();
    this.nonstopLayer.style.display = routes.length ? '' : 'none';
    this.nonstopLayer.setAttribute('aria-hidden', String(!routes.length));
    if (routes.length) this.nonstopLayer.setAttribute('aria-label', `${routes.length} recorded nonstop routes from Boston to covered destinations in this view. Schedules unverified.`);
    else this.nonstopLayer.removeAttribute('aria-label');
    this.nonstopNodes = routes.map(map => {
      const places = map.destinations.map(destinationName).join(' / ');
      const node = element('g', { class: 'nonstop-route', role: 'button', tabindex: '0', 'aria-pressed': 'false',
        'aria-label': `Boston to ${places}, ${map.label}. Select destination for airlines and flight time.`,
        'aria-controls': 'selected-flight-route selection', 'data-from': map.airports[0].code, 'data-to': map.airports[1].code });
      const arc = element('path', { class: 'nonstop-arc', 'data-from': map.airports[0].code, 'data-to': map.airports[1].code, 'aria-hidden': 'true' });
      const hit = element('path', { class: 'nonstop-route-hit', 'aria-hidden': 'true' });
      const title = element('title'); title.textContent = `Boston → ${places} (${map.airports[1].code})`;
      node.append(title, arc, hit);
      node.addEventListener('click', event => this.selectFlightRoute(map, event));
      node.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); event.stopPropagation();
        this.callbacks.routeSelected(map);
      });
      node.addEventListener('focus', () => this.interact());
      this.nonstopLayer.append(node);
      return { map, node, arc, hit };
    });
    const airports = [...new Map(routes.flatMap(map => map.airports.map(airport => [airport.code, airport] as const))).values()];
    this.nonstopCenter = airports.length ? flightMapCenter({ airports }) : null;
    this.nonstopAirports = airports.map(airport => {
      const origin = airport.code === 'BOS';
      const node = element('g', { class: `nonstop-airport${origin ? ' route-airport' : ''}`, 'data-airport': airport.code, 'aria-hidden': 'true' });
      if (!origin) node.append(element('circle', { class: 'nonstop-airport-hit', r: '9' }));
      node.append(element('circle', { r: origin ? '4' : '2.5', 'pointer-events': 'none' }));
      const label = origin ? element('text', { x: '8', y: '-9' }) : undefined;
      if (label) { label.textContent = 'BOS'; node.append(label); }
      const route = this.nonstopNodes.find(item => item.map.airports[1].code === airport.code);
      if (route) {
        node.addEventListener('click', event => this.selectFlightRoute(route.map, event));
        node.addEventListener('pointerenter', () => route.node.classList.add('hovered'));
        node.addEventListener('pointerleave', () => route.node.classList.remove('hovered'));
      }
      // Airport targets stay above every arc, so a neighboring route cannot intercept their clicks.
      this.nonstopLayer.append(node);
      return { airport, node, label };
    });
    this.draw();
  }

  private selectFlightRoute(map: NonstopFlightMap, event: MouseEvent): void {
    if (performance.now() < this.suppressClickUntil) return;
    event.stopPropagation();
    this.callbacks.routeSelected(map);
  }

  setRoute(map: FlightMap | null): void {
    this.routeMap = map;
    this.nonstopLayer.classList.toggle('has-selection', Boolean(map));
    this.routeLayer.replaceChildren(); this.routeAirportLayer.replaceChildren();
    this.routePaths = []; this.routeAirports = [];
    this.routeLayer.style.display = this.routeAirportLayer.style.display = map ? '' : 'none';
    this.routeLayer.setAttribute('aria-hidden', String(!map));
    if (map) {
      this.routeLayer.setAttribute('aria-label', `${map.direction === 'outbound' ? 'Outbound' : 'Return'} flight route: ${map.label}. Illustrative flight legs; schedules unverified.`);
      this.routeLayer.dataset.direction = map.direction;
      this.routePaths = map.legs.map((_, i) => {
        const path = element('path', { class: 'flight-arc', 'data-from': map.airports[i].code, 'data-to': map.airports[i + 1].code });
        this.routeLayer.append(path);
        return path;
      });
      this.routeAirports = map.airports.map((airport, i) => {
        const node = element('g', { class: `route-airport${i > 0 && i < map.airports.length - 1 ? ' connection-airport' : ''}`, 'data-airport': airport.code });
        const label = element('text'); label.textContent = airport.code;
        node.append(element('circle', { r: '4' }), label);
        this.routeAirportLayer.append(node);
        return { airport, node, label };
      });
    } else this.routeLayer.removeAttribute('aria-label');
    this.draw();
  }

  fitFlightRoute(): void {
    if (!this.routeMap) return;
    const [lon, lat] = flightMapCenter(this.routeMap);
    this.scale = this.baseScale * 0.98;
    this.flyTo(lon, lat);
  }

  fitNonstopRoutes(initial = false): void {
    if (!this.nonstopCenter || (initial && this.userInteracted)) return;
    this.scale = this.baseScale * 0.98;
    this.flyTo(...this.nonstopCenter);
  }

  zoom(factor: number): void {
    this.interact();
    this.scale = clamp(this.scale * factor, this.baseScale * 0.79, 60000);
    this.draw();
  }

  resetView(): void {
    if (this.nonstopCenter) { this.fitNonstopRoutes(); return; }
    this.interact();
    this.scale = this.baseScale;
    this.rotation = [75, -25, 0];
    this.draw();
  }

  fitPlaces(places: readonly CityScore[]): void {
    if (!places.length) return;
    const lon = places.reduce((sum, item) => sum + item.city.lon, 0) / places.length;
    const lat = places.reduce((sum, item) => sum + item.city.lat, 0) / places.length;
    const spread = Math.max(...places.map(item => geoDistance([lon, lat], [item.city.lon, item.city.lat])));
    this.scale = clamp(Math.min(this.width, this.height) * 0.28 / Math.max(spread, 0.002), this.baseScale, 60000);
    this.flyTo(lon, lat);
  }

  private interact(): void {
    this.userInteracted = true;
    this.spin = false;
    this.flight = undefined;
    this.callbacks.spinChanged(false);
    this.callbacks.hideTooltip();
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.interact();
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.gestureTravel = 0;
    this.svg.classList.add('dragging');
    // Capture on the hit target to preserve click-to-center on countries and dots.
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  private pointerMove(event: PointerEvent): void {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
    const ratio = this.width / this.svg.getBoundingClientRect().width;
    this.gestureTravel += Math.hypot(dx, dy);
    if (this.pointers.size === 2) {
      const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)![1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (before > 0) this.scale = clamp(this.scale * after / before, this.baseScale * 0.79, 60000);
    } else {
      this.rotation[0] += dx * ratio * 70 / this.scale;
      this.rotation[1] = clamp(this.rotation[1] - dy * ratio * 70 / this.scale, -90, 90);
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.draw();
  }

  private pointerUp(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    if (this.gestureTravel > 5) this.suppressClickUntil = performance.now() + 300;
    this.pointers.delete(event.pointerId);
    if (!this.pointers.size) this.svg.classList.remove('dragging');
  }

  private tick(time: number): void {
    const delta = this.lastTime ? Math.min(64, time - this.lastTime) : 0;
    this.lastTime = time;
    let needsDraw = false;
    if (this.flight) {
      const progress = Math.min(1, (time - this.flight.start) / 1000);
      const eased = easeCubicInOut(progress);
      this.rotation = this.flight.from.map((value, index) => value + (this.flight!.to[index] - value) * eased) as [number, number, number];
      this.scale = this.flight.fromScale + (this.flight.toScale - this.flight.fromScale) * eased;
      if (progress === 1) this.flight = undefined;
      needsDraw = true;
    } else if (this.spin && !document.hidden) {
      this.rotation[0] += delta * 0.008;
      needsDraw = true;
    }
    if (needsDraw && time - this.lastDraw >= 30) { this.draw(); this.lastDraw = time; }
    this.frame = requestAnimationFrame(next => this.tick(next));
  }

  private draw(): void {
    this.projection.rotate(this.rotation).scale(this.scale);
    this.svg.dataset.scale = this.scale.toFixed(2);
    this.svg.dataset.rotation = this.rotation.map(value => value.toFixed(2)).join(',');
    this.sphere.setAttribute('d', this.path({ type: 'Sphere' }) ?? '');
    this.graticule.setAttribute('d', this.path(this.graticuleGeometry) ?? '');
    for (const { map, node } of this.countryPaths) node.setAttribute('d', this.path(map.feature) ?? '');
    if (this.weatherLayer !== 'off') {
      const land = this.path(collection) ?? '';
      this.weatherLand.setAttribute('d', land);
      if (this.weatherLayer === 'temperature' || this.weatherLayer === 'wet') {
        for (const { geometry, node } of this.climateContours) node.setAttribute('d', this.path(geometry) ?? '');
      } else for (const { node, shapes } of this.weatherAreas) {
        if (node.style.display !== 'none') for (const { geometry, path } of shapes) path.setAttribute('d', this.path(geometry) ?? '');
      }
    }
    const center: [number, number] = [-this.rotation[0], -this.rotation[1]];
    for (const { map, node, arc, hit } of this.nonstopNodes) {
      const path = this.path(map.legs[0]) ?? '';
      arc.setAttribute('d', path); hit.setAttribute('d', path);
      node.style.display = path ? '' : 'none';
      node.setAttribute('tabindex', path ? '0' : '-1');
      node.setAttribute('aria-pressed', String(map.destinations.some(city => city.name === this.selectedName)));
    }
    this.routeMap?.legs.forEach((leg, i) => this.routePaths[i].setAttribute('d', this.path(leg) ?? ''));
    this.routeLabelBoxes = [];
    for (const { airport, node, label } of this.nonstopAirports) {
      const [x, y] = this.projection(airport.coordinates)!;
      const selected = this.routeMap?.airports.some(item => item.code === airport.code);
      const visible = !selected && geoDistance(airport.coordinates, center) < Math.PI / 2 - 0.01 && x >= 0 && x <= this.width && y >= 0 && y <= this.height;
      node.style.display = visible ? '' : 'none';
      if (!visible) continue;
      node.setAttribute('transform', `translate(${x},${y})`);
      if (label) this.routeLabelBoxes.push({ left: x + 5, top: y - 22, right: x + 36, bottom: y - 4 });
    }
    for (const { airport, node, label } of this.routeAirports) {
      const [x, y] = this.projection(airport.coordinates)!;
      const visible = geoDistance(airport.coordinates, center) < Math.PI / 2 - 0.01 && x >= 0 && x <= this.width && y >= 0 && y <= this.height;
      node.style.display = visible ? '' : 'none';
      if (!visible) continue;
      node.setAttribute('transform', `translate(${x},${y})`);
      const left = x > this.width - 55;
      label.setAttribute('x', left ? '-8' : '8');
      label.setAttribute('y', '-9');
      label.setAttribute('text-anchor', left ? 'end' : 'start');
      this.routeLabelBoxes.push({ left: left ? x - 36 : x + 5, top: y - 22, right: left ? x - 5 : x + 36, bottom: y - 4 });
    }
    const radius = Math.min(9, 4.5 * Math.sqrt(this.scale / 240));
    const visibleLabels: { label: SVGTextElement; x: number; y: number; radius: number; rank: number; name: string }[] = [];
    const visibleMarkers: { x: number; y: number; size: number; weather: SVGGElement; stem: SVGPathElement; flagged: boolean }[] = [];
    const regionalPoints: { region: string; x: number; y: number }[] = [];
    const orderedNodes = [...this.cityNodes].sort((a, b) =>
      (a.score.city.name === this.selectedName ? -1 : a.rank ?? 999) -
      (b.score.city.name === this.selectedName ? -1 : b.rank ?? 999));
    for (const { score, rank, node, circle, label, weather, weatherIcon, weatherStem } of orderedNodes) {
      const point: [number, number] = [score.city.lon, score.city.lat];
      const projected = this.projection(point)!;
      const regionalZoom = Boolean(score.city.region) && this.scale / this.baseScale > 4;
      const overlapsRegion = score.city.region && regionalPoints.some(other => other.region === score.city.region && Math.hypot(other.x - projected[0], other.y - projected[1]) < (regionalZoom ? 12 : 28));
      const visible = !overlapsRegion && geoDistance(point, center) < Math.PI / 2 - 0.02 && projected[0] >= -20 && projected[0] <= this.width + 20 && projected[1] >= -20 && projected[1] <= this.height + 20;
      node.style.display = visible ? '' : 'none';
      if (!visible) continue;
      if (score.city.region) regionalPoints.push({ region: score.city.region, x: projected[0], y: projected[1] });
      const selected = score.city.name === this.selectedName;
      const size = regionalZoom ? (selected ? 5 : 4) : rank ? 1.4 * radius : selected ? 1.5 * radius : 0.75 * radius;
      const flag = primaryWeatherFlag(score.weatherFlags, this.weatherLayer, this.weatherKinds);
      weather.style.display = flag ? '' : 'none';
      if (flag) {
        weather.setAttribute('class', `weather-marker weather-${flag.kind}`);
        weather.dataset.weather = flag.kind;
        weatherIcon.setAttribute('d', WEATHER_SYMBOLS[flag.kind]);
      }
      visibleMarkers.push({ x: projected[0], y: projected[1], size, weather, stem: weatherStem, flagged: Boolean(flag) });
      node.classList.toggle('selected', selected);
      const weatherColor = weatherMapColor(score, this.weatherLayer, this.weatherKinds);
      circle.setAttribute('fill', this.weatherLayer === 'off' ? band(score.score).color : weatherColor ?? 'var(--neutral-marker)');
      circle.setAttribute('opacity', rank || selected || weatherColor ? '1' : '0.55');
      node.setAttribute('transform', `translate(${projected[0]},${projected[1]})`);
      circle.setAttribute('r', String(size));
      label.style.display = rank || selected || this.scale / this.baseScale > 1.58 ? '' : 'none';
      label.setAttribute('x', String(size + 5));
      label.setAttribute('y', '4');
      label.setAttribute('text-anchor', 'start');
      node.setAttribute('tabindex', rank || selected || flag || this.scale / this.baseScale > 1.58 ? '0' : '-1');
      if (rank || selected || this.scale / this.baseScale > 1.58) visibleLabels.push({ label, x: projected[0], y: projected[1], radius: size, rank: selected ? 0 : rank ?? 999, name: destinationName(score.city) });
    }
    const weatherBoxes = this.placeWeatherMarkers(visibleMarkers);
    this.placeLabels(visibleLabels, weatherBoxes);
    if (this.home) {
      const point: [number, number] = [this.home.lon, this.home.lat];
      const visible = !this.routeMap && !this.nonstopRoutes.length && geoDistance(point, center) < Math.PI / 2 - 0.02;
      this.homeLayer.style.display = visible ? '' : 'none';
      if (visible) { const [x, y] = this.projection(point)!; this.homeLayer.setAttribute('transform', `translate(${x},${y})`); }
    }
  }

  /** Keep weather badges clear of destination dots and one another at overview scale. */
  private placeWeatherMarkers(markers: { x: number; y: number; size: number; weather: SVGGElement; stem: SVGPathElement; flagged: boolean }[]): LabelBox[] {
    const occupied = markers.map(({ x, y, size }) => ({ x, y, radius: size }));
    const boxes: LabelBox[] = [];
    const angles = [-1, -3, 1, 3, -2, 0, 2, 4].map(value => value * Math.PI / 4);
    for (const marker of markers.filter(item => item.flagged)) {
      let best = { dx: 0, dy: 0, cost: Infinity };
      for (const extra of [0, 12, 24, 36]) for (const angle of angles) {
        const distance = marker.size + 11 + extra;
        const dx = Math.cos(angle) * distance, dy = Math.sin(angle) * distance;
        const x = marker.x + dx, y = marker.y + dy;
        const overlap = occupied.reduce((sum, other) => sum + Math.max(0, other.radius + 11 - Math.hypot(x - other.x, y - other.y)) ** 2, 0);
        const outside = x < 10 || x > this.width - 10 || y < 10 || y > this.height - 10;
        const cost = overlap * 1000 + Number(outside) * 100_000 + extra;
        if (cost < best.cost) best = { dx, dy, cost };
      }
      const { dx, dy } = best, length = Math.hypot(dx, dy);
      marker.weather.setAttribute('transform', `translate(${dx},${dy})`);
      // Start at the destination dot's edge, and stop at the badge's edge.
      const start = 1 - (marker.size + 1) / length, end = 8 / length;
      marker.stem.setAttribute('d', `M${-dx * start},${-dy * start}L${-dx * end},${-dy * end}`);
      const x = marker.x + dx, y = marker.y + dy;
      occupied.push({ x, y, radius: 8 });
      boxes.push({ left: x - 10, top: y - 10, right: x + 10, bottom: y + 10 });
    }
    return boxes;
  }

  /** Keep top-ten names readable without changing their geographic marker positions. */
  private placeLabels(labels: { label: SVGTextElement; x: number; y: number; radius: number; rank: number; name: string }[], weatherBoxes: LabelBox[]): void {
    const occupied: LabelBox[] = [...this.routeLabelBoxes, ...weatherBoxes, ...labels.map(({ x, y, radius }) => ({ left: x - radius - 2, top: y - radius - 2, right: x + radius + 2, bottom: y + radius + 2 }))];
    if (this.home && !this.routeMap && !this.nonstopRoutes.length && geoDistance([this.home.lon, this.home.lat], [-this.rotation[0], -this.rotation[1]]) < Math.PI / 2 - 0.02) {
      const [x, y] = this.projection([this.home.lon, this.home.lat])!;
      occupied.push({ left: x - 8, top: y - 9, right: x + 10 + (`Home: ${this.home.name}`).length * 5.8, bottom: y + 8 });
    }
    for (const item of labels.sort((a, b) => a.rank - b.rank)) {
      const width = item.name.length * 6.1;
      const candidates = [0, -16, 16, -32, 32, -48, 48].flatMap(offset => [
        { dx: item.radius + 5, dy: 4 + offset, anchor: 'start' },
        { dx: -item.radius - 5, dy: 4 + offset, anchor: 'end' },
      ]);
      let best = candidates[0], bestBox: LabelBox | undefined, bestCost = Infinity;
      for (const candidate of candidates) {
        const left = item.x + candidate.dx - (candidate.anchor === 'end' ? width : 0);
        const box = { left, top: item.y + candidate.dy - 11, right: left + width, bottom: item.y + candidate.dy + 3 };
        const overlap = occupied.reduce((sum, other) => sum + Math.max(0, Math.min(box.right, other.right) - Math.max(box.left, other.left)) * Math.max(0, Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top)), 0);
        const outside = box.left < 5 || box.right > this.width - 5 || box.top < 5 || box.bottom > this.height - 5;
        const cost = overlap * 100 + (outside ? 100_000 : 0) + Math.abs(candidate.dy - 4) + (candidate.anchor === 'end' ? 1 : 0);
        if (cost < bestCost) { best = candidate; bestCost = cost; bestBox = box; }
      }
      item.label.setAttribute('x', String(best.dx));
      item.label.setAttribute('y', String(best.dy));
      item.label.setAttribute('text-anchor', best.anchor);
      if (bestBox) occupied.push(bestBox);
    }
  }

  destroy(): void { cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); }
}
