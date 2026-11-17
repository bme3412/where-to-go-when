import { contours } from 'd3';
import type { MultiPolygon } from 'geojson';
import { sampleDays } from './scoring';
import type { Trip } from './types';

export interface MonthlyGrid {
  width: number; height: number; latitudes: readonly number[]; longitudeStep: number;
  scale: number; months: readonly (readonly number[])[];
}
export interface GlobalField { values: Float32Array }
export interface ClimateContour { minimum: number; color: string; geometry: MultiPolygon }
const mod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

/** Apply the app's date sampling to every global grid cell, independent of destination filters. */
export function globalFieldForTrip(baseline: MonthlyGrid, trip: Trip): GlobalField {
  const { width, height, scale, months } = baseline;
  const samples = sampleDays(trip).days, weights = new Float64Array(12);
  for (const { month } of samples) {
    const position = month - .5, first = Math.floor(position), fraction = position - first;
    weights[mod(first, 12)] += (1 - fraction) / samples.length;
    weights[mod(first + 1, 12)] += fraction / samples.length;
  }
  const values = new Float32Array(width * height);
  for (let cell = 0; cell < values.length; cell++) {
    let value = 0;
    for (let month = 0; month < 12; month++) value += months[month][cell] * weights[month] * scale;
    values[cell] = value;
  }
  return { values };
}

/** Bilinear interpolation on the Gaussian latitudes, with a cyclic longitude seam. */
export function globalFieldAt(baseline: MonthlyGrid, field: GlobalField, lon: number, lat: number): number {
  const { width, height, latitudes, longitudeStep } = baseline;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return NaN;
  const x = mod(lon, 360) / longitudeStep, west = Math.floor(x), east = (west + 1) % width;
  const longitudeWeight = x - west;
  let north = 0, south = height - 1;
  while (south - north > 1) {
    const middle = Math.floor((north + south) / 2);
    if (latitudes[middle] >= lat) north = middle;
    else south = middle;
  }
  const latitudeWeight = Math.max(0, Math.min(1, (latitudes[north] - lat) / (latitudes[north] - latitudes[south])));
  const blendRow = (row: number) => field.values[row * width + west] * (1 - longitudeWeight)
    + field.values[row * width + east] * longitudeWeight;
  return blendRow(north) * (1 - latitudeWeight) + blendRow(south) * latitudeWeight;
}

/** Smooth climate boundaries for display; the underlying source remains a ~1.9° grid. */
export function globalFieldContours(baseline: MonthlyGrid, field: GlobalField, colors: readonly { min: number; color: string }[]): ClimateContour[] {
  const columns = 90, rows = 180;
  const bands = colors.slice(1);
  const result: ClimateContour[] = bands.map(band => ({ minimum: band.min, color: band.color,
    geometry: { type: 'MultiPolygon', coordinates: [] } }));
  // Keep each polygon within a quarter of the world. A planar contour spanning
  // all 360° has coincident edges at the date line and can invert on projection.
  for (const west of [-180, -90, 0, 90]) {
    const values = Array.from({ length: columns * rows }, (_, index) =>
      globalFieldAt(baseline, field, west + index % columns + .5, 89.5 - Math.floor(index / columns)));
    const shapes = contours().size([columns, rows]).thresholds(bands.map(band => band.min))(values);
    shapes.forEach((contour, index) => {
      // D3's planar rings need reversing when their downward y axis becomes latitude.
      result[index].geometry.coordinates.push(...contour.coordinates.map(polygon =>
        polygon.map(ring => ring.map(([x, y]) => [west + x, 90 - y]).reverse())));
    });
  }
  return result;
}
