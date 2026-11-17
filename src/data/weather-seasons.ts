/** Recurring planning windows, checked against these primary sources on 2026-11-17.
 * These describe seasons, never live warnings or the probability of a local storm.
 * Other legacy regional notes remain explicitly labeled as estimates in weather.ts.
 */
export interface WeatherSeason {
  cities: ReadonlySet<string>; label: string; kind: 'wet' | 'storm';
  from: readonly [number, number]; to: readonly [number, number];
  detail: string; sourceLabel: string; sourceUrl: string;
}
const atlantic = {
  from: [6, 1], to: [11, 30], kind: 'storm', sourceLabel: 'NOAA National Hurricane Center',
  sourceUrl: 'https://www.nhc.noaa.gov/refresh.shtml',
  detail: 'June 1–November 30 is the Atlantic hurricane season. This basin-wide calendar does not predict a storm at this destination.',
} as const;

export const WEATHER_SEASONS: readonly WeatherSeason[] = [
  { ...atlantic, cities: new Set(['Miami', 'Cancún', 'Havana', 'San Juan', 'New Orleans', 'Cape Cod', 'New York']), label: 'Hurricane season' },
  { ...atlantic, cities: new Set(['Aruba', 'Cartagena']), label: 'Hurricane season (edge)', detail: `${atlantic.detail} These places retain the app's southern-Caribbean edge classification; exposure differs across the basin.` },
  { cities: new Set(['Hong Kong']), label: 'Typhoon season', kind: 'storm', from: [5, 1], to: [11, 30],
    detail: 'May–November is Hong Kong’s usual tropical-cyclone period; timing and local effects vary.',
    sourceLabel: 'Hong Kong Observatory', sourceUrl: 'https://www.hko.gov.hk/en/informtc/precaution.htm' },
  { cities: new Set(['Tokyo', 'Kyoto']), label: 'Typhoon season', kind: 'storm', from: [8, 1], to: [10, 31],
    detail: 'JMA describes August–October as a period when typhoons sometimes hit Japan. This typical window is not an exclusive season or a local forecast.',
    sourceLabel: 'Japan Meteorological Agency', sourceUrl: 'https://www.jma.go.jp/jma/en/Activities/qmws_2010/CountryReport/CS102_Nagata.pdf' },
  { cities: new Set(['Cairns']), label: 'Cyclone season', kind: 'storm', from: [11, 1], to: [4, 30],
    detail: 'November 1–April 30 is the Australian tropical-cyclone season. Systems can also occur outside this window.',
    sourceLabel: 'Australian Bureau of Meteorology', sourceUrl: 'https://www.bom.gov.au/climate/cyclones/australia/' },
  { cities: new Set(['Fiji']), label: 'Cyclone season', kind: 'storm', from: [11, 1], to: [4, 30],
    detail: 'November–April is the southwest Pacific cyclone season. This recurring calendar is separate from any particular year’s outlook.',
    sourceLabel: 'Fiji Meteorological Service', sourceUrl: 'https://www.met.gov.fj/climate-services/2025-26-tc-outlook/' },
  { cities: new Set(['Mauritius']), label: 'Cyclone season', kind: 'storm', from: [11, 1], to: [5, 15],
    detail: 'November 1–May 15 is the official cyclone season for Mauritius. Storms may occur outside this period.',
    sourceLabel: 'Mauritius Meteorological Services', sourceUrl: 'https://metservice.intnet.mu/climate-services/seasonal-climate-forecast.php' },
  { cities: new Set(['Tahiti']), label: 'Cyclone season', kind: 'storm', from: [11, 1], to: [4, 30],
    detail: 'November–April is the cyclone-season window used by Météo-France in French Polynesia. This is a seasonal planning note.',
    sourceLabel: 'Météo-France Polynésie française', sourceUrl: 'https://meteo.pf/fr/actualites/lactivite-cyclonique-en-un-coup-doeil' },
  { cities: new Set(['Goa']), label: 'Monsoon season', kind: 'wet', from: [6, 1], to: [9, 30],
    detail: 'Goa’s monsoon normally runs from early June through late September. The regional calendar also applies to the app’s Panaji and Palolem entries; local conditions differ.',
    sourceLabel: 'Government of Goa', sourceUrl: 'https://dip.goa.gov.in/climate/' },
];
