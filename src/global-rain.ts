import baseline from './data/global-rain.json';
import { globalFieldAt, globalFieldContours, globalFieldForTrip } from './global-climate';
import type { GlobalField } from './global-climate';
import { RAIN_COLORS } from './weather-map';
import type { Trip } from './types';

export const GLOBAL_RAIN_SOURCE = baseline;
export const globalRainForTrip = (trip: Trip) => globalFieldForTrip(baseline, trip);
export const globalRainAt = (field: GlobalField, lon: number, lat: number) => globalFieldAt(baseline, field, lon, lat);
export const globalRainContours = (field: GlobalField) => globalFieldContours(baseline, field, RAIN_COLORS);
