import { BOSTON_FLIGHTS } from './flights';

export const AIRFARE_ENDPOINT = '/api/airfare-estimate';

const originAirports: Readonly<Record<string, string>> = {
  Boston: 'BOS', 'New York': 'JFK', 'Washington, DC': 'IAD', Miami: 'MIA', Chicago: 'ORD',
  Dallas: 'DFW', Denver: 'DEN', 'Los Angeles': 'LAX', 'San Francisco': 'SFO', Seattle: 'SEA',
  Toronto: 'YYZ', 'Mexico City': 'MEX', 'São Paulo': 'GRU', London: 'LHR', Paris: 'CDG',
  Frankfurt: 'FRA', Madrid: 'MAD', Dubai: 'DXB', Johannesburg: 'JNB', Mumbai: 'BOM',
  Singapore: 'SIN', 'Hong Kong': 'HKG', Tokyo: 'HND', Sydney: 'SYD',
};

export function airfareAirports(origin: string, city: string, nonstop: boolean) {
  const from = Object.hasOwn(originAirports, origin) ? originAirports[origin] : undefined;
  const entry = Object.hasOwn(BOSTON_FLIGHTS.destinations, city) ? BOSTON_FLIGHTS.destinations[city] : undefined;
  const route = origin === 'Boston' ? (nonstop ? entry?.nonstopOutbound : entry?.outbound) : undefined;
  const to = route?.path.at(-1) ?? (Object.hasOwn(originAirports, city) ? originAirports[city] : entry?.gateways.find(gateway => gateway.minutes !== null)?.iata);
  return from && to && from !== to ? { from, to } : undefined;
}

export interface AirfareOption {
  kind: 'lowest' | 'shortest' | 'both';
  total: number;
  minutes: number;
  outboundStops: number;
  returnStops: number;
  expiresAt?: string;
}
