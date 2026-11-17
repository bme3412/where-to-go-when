import { describe, expect, it } from 'vitest';
import { geoContains, geoOrthographic, geoPath } from 'd3';
import { GLOBAL_TEMPERATURE_SOURCE as source, globalTemperatureAt, globalTemperatureContours, globalTemperatureForTrip } from './global-temperature';

const january = globalTemperatureForTrip({ start: '2027-01-16', end: '2027-01-16' });
const july = globalTemperatureForTrip({ start: '2027-07-16', end: '2027-07-16' });

describe('global temperature surface', () => {
  it('bundles complete sourced global coverage without destination-based extrapolation', () => {
    expect(source.baseline).toBe('1991–2020');
    expect(source.validYearsPerCell).toBe(30);
    expect(source.months).toHaveLength(12);
    expect(source.months.every(month => month.length === 192 * 94 && month.every(Number.isFinite))).toBe(true);
    expect(january.values).toHaveLength(18048);
    expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles both hemispheres, polar regions, and the longitude seam', () => {
    expect(globalTemperatureAt(january, -100, 50)).toBeLessThan(globalTemperatureAt(july, -100, 50));
    expect(globalTemperatureAt(january, 25, -30)).toBeGreaterThan(globalTemperatureAt(july, 25, -30));
    expect(globalTemperatureAt(january, 0, 90)).toBeLessThan(0);
    expect(globalTemperatureAt(july, 0, -90)).toBeLessThan(-20);
    expect(globalTemperatureAt(january, -180, 20)).toBeCloseTo(globalTemperatureAt(january, 180, 20), 6);
    expect(globalTemperatureAt(january, -.001, 20)).toBeCloseTo(globalTemperatureAt(january, 359.999, 20), 6);
  });

  it('samples inclusive trips across New Year and rejects invalid dates', () => {
    const trip = globalTemperatureForTrip({ start: '2026-12-31', end: '2027-01-01' });
    const dec = globalTemperatureForTrip({ start: '2026-12-31', end: '2026-12-31' });
    const jan = globalTemperatureForTrip({ start: '2027-01-01', end: '2027-01-01' });
    expect(trip.values[1000]).toBeCloseTo((dec.values[1000] + jan.values[1000]) / 2, 5);
    expect(() => globalTemperatureForTrip({ start: '2027-02-02', end: '2027-02-01' })).toThrow();
  });

  it('preserves temperature thresholds when contour polygons wrap around the globe', () => {
    for (const field of [january, july]) {
      const contours = globalTemperatureContours(field);
      expect(contours.map(contour => contour.minimum)).toEqual([0, 10, 20, 30, 35]);
      const points: [number, number][] = [[-100, 50], [25, -30], [55, 25], [151, -34], [-75, 40], [179, 10], [-179, 10], [0, 89], [0, -89]];
      for (const point of points) for (const contour of contours) {
        const temperature = globalTemperatureAt(field, ...point);
        if (Math.abs(temperature - contour.minimum) > 1) expect(geoContains(contour.geometry, point), `${point} at ${temperature}°C vs ${contour.minimum}°C`).toBe(temperature >= contour.minimum);
      }
      for (const rotate of [[0, 0, 0], [180, 0, 0], [0, 90, 0]] as [number, number, number][]) {
        const path = geoPath(geoOrthographic().rotate(rotate));
        for (const contour of contours) expect(path(contour.geometry) ?? '').not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it('paints the correct side of each contour after spherical projection and clipping', () => {
    for (const field of [january, july]) for (const point of [[-45, 75], [-100, 50], [55, 25], [179, 10], [151, -34]] as [number, number][]) {
      const projection = geoOrthographic().rotate([-point[0], -point[1]]).translate([0, 0]).scale(100);
      for (const contour of globalTemperatureContours(field)) {
        const temperature = globalTemperatureAt(field, ...point);
        if (Math.abs(temperature - contour.minimum) < 1) continue;
        const rings: [number, number][][] = [];
        geoPath(projection).context({
          moveTo(x: number, y: number) { rings.push([[x, y]]); },
          lineTo(x: number, y: number) { rings.at(-1)!.push([x, y]); },
          beginPath() {}, closePath() {}, arc() {},
        })(contour.geometry);
        // SVG's nonzero fill rule at the center of the projected globe.
        let winding = 0;
        for (const ring of rings) for (let i = 0; i < ring.length; i++) {
          const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
          if ((ay <= 0 && by > 0) || (by <= 0 && ay > 0)) {
            const crossing = ax + (bx - ax) * -ay / (by - ay);
            if (crossing > 0) winding += by > ay ? 1 : -1;
          }
        }
        expect(winding !== 0, `${point} painted at ${contour.minimum}°C, actual ${temperature}°C`).toBe(temperature >= contour.minimum);
      }
    }
  });
});
