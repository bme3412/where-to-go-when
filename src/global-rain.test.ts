import { describe, expect, it } from 'vitest';
import { geoContains, geoOrthographic, geoPath } from 'd3';
import { GLOBAL_RAIN_SOURCE as source, globalRainAt, globalRainContours, globalRainForTrip } from './global-rain';
import { RAIN_COLORS, weatherLegend } from './weather-map';

const january = globalRainForTrip({ start: '2027-01-16', end: '2027-01-16' });
const july = globalRainForTrip({ start: '2027-07-16', end: '2027-07-16' });

describe('global precipitation surface', () => {
  it('bundles a complete, sourced monthly precipitation grid in mm/day', () => {
    expect(source.baseline).toBe('1991–2020');
    expect(source.validYearsPerCell).toBe(30);
    expect(source.units).toBe('mm/day');
    expect(source.scale).toBe(.01);
    expect(source.months).toHaveLength(12);
    expect(source.months.every(month => month.length === 192 * 94 && month.every(value => Number.isFinite(value) && value >= 0))).toBe(true);
    expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Math.max(...january.values)).toBeLessThan(40);
  });

  it('moves rainy seasons between hemispheres and keeps the date line continuous', () => {
    // Mumbai's summer monsoon, Darwin's summer rains, and Mediterranean winter rains.
    expect(globalRainAt(july, 73, 19)).toBeGreaterThan(globalRainAt(january, 73, 19) + 4);
    expect(globalRainAt(january, 131, -13)).toBeGreaterThan(globalRainAt(july, 131, -13) + 4);
    expect(globalRainAt(january, 15, 38)).toBeGreaterThan(globalRainAt(july, 15, 38));
    expect(globalRainAt(july, 15, 23)).toBeLessThan(1); // Sahara remains arid.
    expect(globalRainAt(january, -180, 20)).toBeCloseTo(globalRainAt(january, 180, 20), 6);
    expect(globalRainAt(january, -.001, 20)).toBeCloseTo(globalRainAt(january, 359.999, 20), 6);
    expect(Number.isFinite(globalRainAt(january, 0, 90))).toBe(true);
    expect(Number.isFinite(globalRainAt(january, 0, -90))).toBe(true);
  });

  it('averages inclusive dates across months and years without multiplying by trip length', () => {
    const first = globalRainForTrip({ start: '2027-12-31', end: '2027-12-31' });
    const last = globalRainForTrip({ start: '2028-01-01', end: '2028-01-01' });
    const both = globalRainForTrip({ start: '2027-12-31', end: '2028-01-01' });
    for (const cell of [0, 1000, 8000, 18047]) expect(both.values[cell]).toBeCloseTo((first.values[cell] + last.values[cell]) / 2, 5);
    const leap = globalRainForTrip({ start: '2028-02-28', end: '2028-03-01' });
    expect(leap.values.every(Number.isFinite)).toBe(true);
    expect(() => globalRainForTrip({ start: '2027-02-30', end: '2027-03-01' })).toThrow();
    expect(() => globalRainForTrip({ start: '2027-03-01', end: '2027-02-01' })).toThrow();
  });

  it('preserves rainfall bands through spherical clipping and globe rotation', () => {
    for (const field of [january, july]) {
      const contours = globalRainContours(field);
      expect(contours.map(contour => contour.minimum)).toEqual([1, 2, 4, 8, 12]);
      for (const point of [[73, 19], [131, -13], [15, 23], [-60, -5], [179, 10], [-179, 10], [0, 89]] as [number, number][]) {
        const rate = globalRainAt(field, ...point);
        const projection = geoOrthographic().rotate([-point[0], -point[1]]).translate([0, 0]).scale(100);
        for (const contour of contours) {
          if (Math.abs(rate - contour.minimum) < .5) continue;
          expect(geoContains(contour.geometry, point), `${point} / ${rate} mm/day`).toBe(rate >= contour.minimum);
          const rings: [number, number][][] = [];
          geoPath(projection).context({
            moveTo(x: number, y: number) { rings.push([[x, y]]); },
            lineTo(x: number, y: number) { rings.at(-1)!.push([x, y]); },
            beginPath() {}, closePath() {}, arc() {},
          })(contour.geometry);
          let winding = 0;
          for (const ring of rings) for (let i = 0; i < ring.length; i++) {
            const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
            if ((ay <= 0 && by > 0) || (by <= 0 && ay > 0)) {
              const crossing = ax + (bx - ax) * -ay / (by - ay);
              if (crossing > 0) winding += by > ay ? 1 : -1;
            }
          }
          expect(winding !== 0, `${point} painted above ${contour.minimum}, actual ${rate}`).toBe(rate >= contour.minimum);
        }
      }
    }
  });

  it('shows rainfall amount in both temperature units, with separate wet-period icons', () => {
    const legend = weatherLegend('wet', 'F');
    expect(legend).toEqual(weatherLegend('wet', 'C'));
    expect(legend.title).toContain('mm/day');
    expect(legend.items.map(item => item.color)).toEqual(RAIN_COLORS.map(band => band.color));
    expect(legend.note).toContain('snow');
    expect(legend.note).toContain('icons');
    const selected = new Set(['heat', 'storm'] as const);
    expect(weatherLegend('wet', 'C', selected).note).toBe('Rain + snow equivalent');
    expect(weatherLegend('all', 'C', selected).items.map(item => item.label)).toEqual(['Heat', 'Storm season']);
  });
});
