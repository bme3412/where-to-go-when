import type { Origin, OriginRow } from '../types';

export const ORIGIN_ROWS = [
["Boston",42.36,-71.06,-5],
["New York",40.71,-74.01,-5],
["Washington, DC",38.91,-77.04,-5],
["Miami",25.76,-80.19,-5],
["Chicago",41.88,-87.63,-6],
["Dallas",32.78,-96.8,-6],
["Denver",39.74,-104.99,-7],
["Los Angeles",34.05,-118.24,-8],
["San Francisco",37.77,-122.42,-8],
["Seattle",47.61,-122.33,-8],
["Toronto",43.65,-79.38,-5],
["Mexico City",19.43,-99.13,-6],
["São Paulo",-23.55,-46.63,-3],
["London",51.51,-0.13,0],
["Paris",48.86,2.35,1],
["Frankfurt",50.11,8.68,1],
["Madrid",40.42,-3.7,1],
["Dubai",25.2,55.27,4],
["Johannesburg",-26.2,28.05,2],
["Mumbai",19.08,72.88,5.5],
["Singapore",1.35,103.82,8],
["Hong Kong",22.32,114.17,8],
["Tokyo",35.68,139.69,9],
["Sydney",-33.87,151.21,10]
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

export const ORIGINS: readonly Origin[] = ORIGIN_ROWS.map(([name, lat, lon, tz]) => ({name, lat, lon, tz, country: ORIGIN_COUNTRIES[name]}));
