import type { Origin, OriginRow } from '../types';

export const ORIGIN_ROWS = [
['Boston',42.36,-71.06,-5,[3,4,8,14,20,25,28,27,23,17,11,5]],
['New York',40.71,-74.01,-5,[4,6,10,17,22,27,29,28,24,18,12,6]],
['Washington, DC',38.91,-77.04,-5,[7,9,14,20,25,30,32,31,27,21,15,9]],
['Miami',25.76,-80.19,-5,[24,25,26,28,30,31,32,32,31,29,27,25]],
['Chicago',41.88,-87.63,-6,[0,2,9,16,22,27,29,28,24,17,9,2]],
['Dallas',32.78,-96.8,-6,[14,17,21,25,29,33,36,36,32,26,19,14]],
['Denver',39.74,-104.99,-7,[7,8,12,16,21,28,31,30,25,18,11,6]],
['Los Angeles',34.05,-118.24,-8,[20,20,21,22,23,25,28,29,28,26,23,20]],
['San Francisco',37.77,-122.42,-8,[14,16,17,18,19,21,21,22,23,21,17,14]],
['Seattle',47.61,-122.33,-8,[8,10,12,15,19,22,26,26,22,16,10,8]],
['Toronto',43.65,-79.38,-5,[-1,0,5,12,19,24,27,26,22,14,7,1]],
['Mexico City',19.43,-99.13,-6,[21,23,25,26,26,24,23,23,22,22,21,21]],
['São Paulo',-23.55,-46.63,-3,[28,29,28,26,24,23,23,24,25,26,27,28]],
['London',51.51,-0.13,0,[8,9,12,15,18,21,23,23,20,16,11,8]],
['Paris',48.86,2.35,1,[7,8,12,16,20,23,25,25,21,16,10,7]],
['Frankfurt',50.11,8.68,1,[4,6,11,15,20,23,25,25,20,14,8,5]],
['Madrid',40.42,-3.7,1,[10,12,16,18,22,28,32,31,26,19,13,10]],
['Dubai',25.2,55.27,4,[24,25,28,33,38,40,41,41,39,35,30,26]],
['Johannesburg',-26.2,28.05,2,[26,25,24,21,19,16,17,20,23,25,25,26]],
['Mumbai',19.08,72.88,5.5,[31,31,33,33,34,32,30,29,30,33,34,32]],
['Singapore',1.35,103.82,8,[30,31,32,32,32,31,31,31,31,31,31,30]],
['Hong Kong',22.32,114.17,8,[19,19,22,26,29,31,32,32,31,28,24,20]],
['Tokyo',35.68,139.69,9,[10,10,14,19,23,26,30,31,27,22,17,12]],
['Sydney',-33.87,151.21,10,[26,26,25,23,20,17,17,18,20,22,24,25]]
] as const satisfies readonly OriginRow[];

export const ORIGIN_COUNTRIES = {
  Boston: 'United States of America', 'New York': 'United States of America',
  'Washington, DC': 'United States of America', Miami: 'United States of America',
  Chicago: 'United States of America', Dallas: 'United States of America',
  Denver: 'United States of America', 'Los Angeles': 'United States of America',
  'San Francisco': 'United States of America', Seattle: 'United States of America',
  Toronto: 'Canada', 'Mexico City': 'Mexico', 'São Paulo': 'Brazil',
  London: 'United Kingdom', Paris: 'France', Frankfurt: 'Germany', Madrid: 'Spain',
  Dubai: 'United Arab Emirates', Johannesburg: 'South Africa', Mumbai: 'India',
  Singapore: 'Singapore', 'Hong Kong': 'China', Tokyo: 'Japan', Sydney: 'Australia',
} as const satisfies Record<(typeof ORIGIN_ROWS)[number][0], string>;

// Group separately named territories with their country for this destination filter.
export const DOMESTIC_COUNTRY_GROUPS: Readonly<Record<string, string>> = {
  'Puerto Rico': 'United States of America',
};

export const ORIGINS: readonly Origin[] = ORIGIN_ROWS.map(([name, lat, lon, tz, high]) => ({name, lat, lon, tz, high, country: ORIGIN_COUNTRIES[name]}));
