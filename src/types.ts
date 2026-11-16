export type Months = readonly [number, number, number, number, number, number, number, number, number, number, number, number];
export type CityRow = readonly [string, string, number, number, Months, Months, readonly number[], readonly number[]];
export type OriginRow = readonly [string, number, number, number, Months];
export interface Place { name: string; lat: number; lon: number; tz: number }
export interface Origin extends Place { country: string; high: Months }
export type DestinationScope = 'all' | 'domestic' | 'international';
export interface City extends Place { country: string; high: Months; rain: Months; peak: readonly number[]; shoulder: readonly number[] }
export interface Weights { weather: number; dry: number; crowds: number; travel: number }
export interface Trip { start: string; end: string }
export interface Sample { timestamp: number; month: number }
export interface SampledTrip { tripDays: number; step: number; days: Sample[] }
export interface Travel { km: number; mode: 'drive' | 'flight'; hours: number; timeShift: number; lost: number; usable: number; factor: number }
export type Dealbreaker = 'Too hot' | 'Too cold' | 'Very rainy' | 'Packed';
export interface ScoreBreakdown {
  weatherFit: number;
  dryFit: number;
  crowdFit: number;
  weights: Weights;
  baseScore: number;
  riskDeduction: number;
  travelMultiplier: number;
  travelDeduction: number;
}
export interface CityScore { city: City; score: number; high: number; homeHigh: number; rain: number; crowd: number; tripDays: number; travel: Travel; breakdown: ScoreBreakdown; events: string[]; risks: string[]; dealbreakers: Dealbreaker[] }
export type RankedCity = CityScore & { rank: number };
export interface Country { name: string; lat: number; lon: number }
export interface TripEvent { cities: ReadonlySet<string>; start: number; end: number; crowd: number; name: string; festival: boolean }
export type RiskRow = readonly [ReadonlySet<string>, number, number, number, string];
export type Unit = 'F' | 'C';
