export type Months = readonly [number, number, number, number, number, number, number, number, number, number, number, number];
export type CityRow = readonly [string, string, number, number, readonly number[], readonly number[]];
export type OriginRow = readonly [string, number, number, number];
export interface Place { name: string; lat: number; lon: number; tz: number }
export interface Origin extends Place { country: string }
export type DestinationScope = 'all' | 'domestic' | 'international';
export interface City extends Place { region?: string; displayName?: string; country: string; peak: readonly number[]; shoulder: readonly number[] }
export interface Weights { weather: number; dry: number; crowds: number; travel: number }
export interface TemperatureRange { min: number; max: number }
export interface Trip { start: string; end: string }
export interface Sample { timestamp: number; month: number }
export interface SampledTrip { tripDays: number; step: number; days: Sample[] }
export interface Travel { km: number; mode: 'drive' | 'flight'; hours: number; timeShift: number; lost: number; usable: number; factor: number }
export type Dealbreaker = 'Too hot' | 'Too cold' | 'Frequent precipitation' | 'Packed';
export interface ClimateMonth {
  temperatureDays: number; precipitationDays: number; meanHigh: number; meanLow: number; highP10: number; highP90: number;
  monthlyPrecip: number; wetDays: number; histogramStart: number; highHistogram: number[];
}
export interface ClimateCoverage { days: number; expectedDays: number; years: number; decadeYears: number[] }
interface SourceBase {
  provider: string; sourceUrl: string; retrieved: string; sha256: string; version: string;
  coverage: ClimateCoverage[];
  hashScope?: string;
  rawInputs?: { url: string; label: string; retrieved: string; sha256: string; sourcePage?: string;
    request?: { method: 'POST'; contentType: string; body: string } }[];
}
export interface StationSource extends SourceBase {
  kind: 'station'; stationId: string; stationName: string; lat: number; lon: number;
  elevation: number; distanceKm: number; elevationDifferenceM: number; sourceFlags: string[];
  metadataUrl?: string; lineageUrl?: string; qualityNote?: string; sourcePage?: string;
  qualityUrl?: string; qualityEvidenceUrl?: string; licenseUrl?: string; attribution?: string;
  stationMembers?: { stationId: string; stationName: string; lat: number; lon: number; elevation: number; start: string; end: string }[];
}
export interface GridSource extends SourceBase { kind: 'grid'; reason: string }
export type ClimateSource = StationSource | GridSource;
export type AgencyReviewStatus = 'access-required' | 'request-required' | 'coverage-failed' | 'not-verified' | 'imported';
export interface AgencyReview { agency: string; note: string; url: string; status?: AgencyReviewStatus; checked?: string }
export interface CityClimate {
  name: string; lat: number; lon: number; elevation: number; gridElevation: number; sourceUrl: string;
  retrieved: string; sha256: string; apiVersion: string; months: ClimateMonth[];
  sources: { temperature: ClimateSource; precipitation: ClimateSource };
  referenceLabel?: string; referenceUrl?: string; referenceNote?: string;
  agencyReview?: AgencyReview;
}
export interface ScoreBreakdown {
  fits: Weights;
  contributions: Weights;
  weights: Weights;
  temperatureRange: TemperatureRange;
}
export interface CityScore { city: City; climate: CityClimate; score: number; high: number; low: number; homeHigh: number; rain: number; wetFrequency: number; crowd: number; tripDays: number; travel: Travel; breakdown: ScoreBreakdown; events: string[]; risks: string[]; dealbreakers: Dealbreaker[] }
export type RankedCity = CityScore & { rank: number };
export interface Country { name: string; lat: number; lon: number }
export interface TripEvent { cities: ReadonlySet<string>; start: number; end: number; crowd: number; name: string; festival: boolean }
export type RiskRow = readonly [ReadonlySet<string>, number, number, number, string];
export type Unit = 'F' | 'C';
