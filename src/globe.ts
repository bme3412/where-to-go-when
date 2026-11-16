import { easeCubicInOut, geoCentroid, geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';
import type { Feature, Geometry } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { band } from './format';
import { climateLabel } from './climate';
import { clamp } from './scoring';
import type { CityScore, Country, Origin, RankedCity } from './types';

type CountryFeature = Feature<Geometry, { name: string }>;
interface MapCountry { feature: CountryFeature; country: Country }
interface Callbacks {
  cityHover: (city: CityScore, x: number, y: number) => void;
  countryHover: (country: Country, x: number, y: number) => void;
  citySelected: (city: CityScore) => void;
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
  private resizeObserver: ResizeObserver;
  private spin = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private sphere = element('path', { class: 'ocean', 'aria-hidden': 'true' });
  private graticule = element('path', { class: 'graticule', 'pointer-events': 'none', 'aria-hidden': 'true' });
  private graticuleGeometry = geoGraticule10();
  private countryLayer = element('g', { 'aria-hidden': 'true' });
  private cityLayer = element('g');
  private homeLayer = element('g', { class: 'home-marker', 'pointer-events': 'none' });
  private countryPaths: { map: MapCountry; node: SVGPathElement }[] = [];
  private cityNodes: { score: CityScore; rank?: number; node: SVGGElement; circle: SVGCircleElement; number: SVGTextElement; label: SVGTextElement }[] = [];
  private home?: Origin;
  private pointers = new Map<number, { x: number; y: number }>();
  private gestureTravel = 0;
  private suppressClickUntil = 0;
  private flight?: { start: number; from: [number, number, number]; to: [number, number, number] };
  private frame = 0;
  private lastTime = 0;
  private lastDraw = 0;
  private userInteracted = false;

  constructor(private svg: SVGSVGElement, private callbacks: Callbacks) {
    this.resizeObserver = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width < 1 || height < 1) return;
      const zoom = this.scale / this.baseScale;
      this.width = width; this.height = height;
      this.baseScale = Math.min(width, height) * 0.49;
      this.scale = clamp(this.baseScale * zoom, this.baseScale * 0.79, 1000);
      this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      this.projection.translate([width / 2, height / 2]);
      this.callbacks.hideTooltip();
      this.draw();
    });
    this.resizeObserver.observe(svg);
    this.svg.append(this.sphere, this.countryLayer, this.graticule, this.cityLayer, this.homeLayer);
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
      if (event.key === 'ArrowLeft') this.rotation[0] -= 8;
      if (event.key === 'ArrowRight') this.rotation[0] += 8;
      if (event.key === 'ArrowUp') this.rotation[1] = clamp(this.rotation[1] - 8, -90, 90);
      if (event.key === 'ArrowDown') this.rotation[1] = clamp(this.rotation[1] + 8, -90, 90);
      if (event.key === '+' || event.key === '=') this.scale = clamp(this.scale * 1.1, this.baseScale * 0.79, 1000);
      if (event.key === '-') this.scale = clamp(this.scale / 1.1, this.baseScale * 0.79, 1000);
      this.draw();
    });
    this.callbacks.spinChanged(this.spin);
    this.draw();
    this.frame = requestAnimationFrame(time => this.tick(time));
  }

  update(cities: readonly CityScore[], ranked: readonly RankedCity[], home: Origin): void {
    this.home = home;
    const ranks = new Map(ranked.slice(0, 10).map(city => [city.city.name, city.rank]));
    this.cityLayer.replaceChildren();
    // Ranked markers are drawn last so small background dots cannot obscure them.
    this.cityNodes = [...cities].sort((a, b) => Number(ranks.has(a.city.name)) - Number(ranks.has(b.city.name))).map(score => {
      const rank = ranks.get(score.city.name);
      const node = element('g', { class: 'city-marker', 'data-city': score.city.name, role: 'button', tabindex: rank ? '0' : '-1', 'aria-label': `${score.city.name}, ${band(score.score).label}, score ${Math.round(score.score)}. ${climateLabel(score.climate)}. Center on globe.` });
      const circle = element('circle', { fill: band(score.score).color, opacity: rank ? '1' : '0.45' });
      const number = element('text', { class: 'rank-number', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      number.textContent = rank ? String(rank) : '';
      const label = element('text', { class: `city-label${rank ? ' top-label' : ''}`, y: '4' });
      label.textContent = score.city.name;
      node.append(circle, number, label);
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
      return { score, rank, node, circle, number, label };
    });
    this.homeLayer.querySelector('text')!.textContent = `Home: ${home.name}`;
    this.draw();
  }

  initialFlyTo(lon: number, lat: number): void {
    if (!this.userInteracted) this.flyTo(lon, lat, false);
  }

  flyTo(lon: number, lat: number, userAction = true): void {
    if (userAction) this.interact();
    const longitude = this.rotation[0] + (((-lon - this.rotation[0]) % 360 + 540) % 360 - 180);
    const target: [number, number, number] = [longitude, -lat, 0];
    if (this.reducedMotion) {
      this.rotation = target;
      this.draw();
    } else this.flight = { start: performance.now(), from: [...this.rotation], to: target };
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

  zoom(factor: number): void {
    this.interact();
    this.scale = clamp(this.scale * factor, this.baseScale * 0.79, 1000);
    this.draw();
  }

  resetView(): void {
    this.interact();
    this.scale = this.baseScale;
    this.rotation = [75, -25, 0];
    this.draw();
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
      if (before > 0) this.scale = clamp(this.scale * after / before, this.baseScale * 0.79, 1000);
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
    const center: [number, number] = [-this.rotation[0], -this.rotation[1]];
    const radius = Math.min(9, 4.5 * Math.sqrt(this.scale / 240));
    const visibleLabels: { label: SVGTextElement; x: number; y: number; radius: number; rank: number; name: string }[] = [];
    for (const { score, rank, node, circle, number, label } of this.cityNodes) {
      const point: [number, number] = [score.city.lon, score.city.lat];
      const visible = geoDistance(point, center) < Math.PI / 2 - 0.02;
      node.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const projected = this.projection(point)!;
      const selected = score.city.name === this.selectedName;
      const size = rank ? 1.9 * radius : selected ? 1.5 * radius : 0.75 * radius;
      node.classList.toggle('selected', selected);
      circle.setAttribute('opacity', rank || selected ? '1' : '0.45');
      node.setAttribute('transform', `translate(${projected[0]},${projected[1]})`);
      circle.setAttribute('r', String(size));
      number.setAttribute('font-size', String(Math.max(9, size * 1.15)));
      label.style.display = rank || selected || this.scale / this.baseScale > 1.58 ? '' : 'none';
      label.setAttribute('x', String(size + 5));
      label.setAttribute('y', '4');
      label.setAttribute('text-anchor', 'start');
      if (rank || selected) visibleLabels.push({ label, x: projected[0], y: projected[1], radius: size, rank: selected ? 0 : rank!, name: score.city.name });
    }
    this.placeLabels(visibleLabels);
    if (this.home) {
      const point: [number, number] = [this.home.lon, this.home.lat];
      const visible = geoDistance(point, center) < Math.PI / 2 - 0.02;
      this.homeLayer.style.display = visible ? '' : 'none';
      if (visible) { const [x, y] = this.projection(point)!; this.homeLayer.setAttribute('transform', `translate(${x},${y})`); }
    }
  }

  /** Keep top-ten names readable without changing their geographic marker positions. */
  private placeLabels(labels: { label: SVGTextElement; x: number; y: number; radius: number; rank: number; name: string }[]): void {
    type Box = { left: number; top: number; right: number; bottom: number };
    const occupied: Box[] = labels.map(({ x, y, radius }) => ({ left: x - radius - 2, top: y - radius - 2, right: x + radius + 2, bottom: y + radius + 2 }));
    if (this.home && geoDistance([this.home.lon, this.home.lat], [-this.rotation[0], -this.rotation[1]]) < Math.PI / 2 - 0.02) {
      const [x, y] = this.projection([this.home.lon, this.home.lat])!;
      occupied.push({ left: x - 8, top: y - 9, right: x + 10 + (`Home: ${this.home.name}`).length * 5.8, bottom: y + 8 });
    }
    for (const item of labels.sort((a, b) => a.rank - b.rank)) {
      const width = item.name.length * 6.1;
      const candidates = [0, -16, 16, -32, 32, -48, 48].flatMap(offset => [
        { dx: item.radius + 5, dy: 4 + offset, anchor: 'start' },
        { dx: -item.radius - 5, dy: 4 + offset, anchor: 'end' },
      ]);
      let best = candidates[0], bestBox: Box | undefined, bestCost = Infinity;
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
