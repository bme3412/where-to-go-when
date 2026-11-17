import baseline from './data/global-temperature.json';
import { globalFieldAt, globalFieldContours, globalFieldForTrip } from './global-climate';
import type { GlobalField } from './global-climate';
import { TEMPERATURE_COLORS } from './weather-map';
import type { Trip } from './types';

export const GLOBAL_TEMPERATURE_SOURCE = baseline;
export const globalTemperatureForTrip = (trip: Trip) => globalFieldForTrip(baseline, trip);
export const globalTemperatureAt = (field: GlobalField, lon: number, lat: number) => globalFieldAt(baseline, field, lon, lat);
export const globalTemperatureContours = (field: GlobalField) => globalFieldContours(baseline, field, TEMPERATURE_COLORS);
