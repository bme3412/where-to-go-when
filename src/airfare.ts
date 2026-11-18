import { BOSTON_FLIGHTS } from './flights';

export const AIRFARE_ENDPOINT = '/api/airfare-estimate';

const preferredAirports: Readonly<Record<string, string>> = {
  Abidjan: 'ABJ', Belgrade: 'BEG', Dhigurah: 'MLE', Maafushi: 'MLE', Galle: 'CMB',
  'El Chaltén': 'FTE', Petra: 'AMM', 'Puerto Villamil': 'GPS', Rome: 'FCO',
  Boston: 'BOS', 'New York': 'JFK', 'Washington, DC': 'IAD', Miami: 'MIA', Chicago: 'ORD',
  Dallas: 'DFW', Denver: 'DEN', 'Los Angeles': 'LAX', 'San Francisco': 'SFO', Seattle: 'SEA',
  Toronto: 'YYZ', 'Mexico City': 'MEX', 'São Paulo': 'GRU', London: 'LHR', Paris: 'CDG',
  Frankfurt: 'FRA', Madrid: 'MAD', Dubai: 'DXB', Johannesburg: 'JNB', Mumbai: 'BOM',
  Singapore: 'SIN', 'Hong Kong': 'HKG', Tokyo: 'HND', Sydney: 'SYD',
};

export function airportForCity(city: string) {
  if (Object.hasOwn(preferredAirports, city)) return preferredAirports[city];
  if (!Object.hasOwn(BOSTON_FLIGHTS.destinations, city)) return undefined;
  const gateways = BOSTON_FLIGHTS.destinations[city].gateways;
  return (gateways.find(gateway => gateway.minutes !== null) ?? gateways[0])?.iata;
}

export function airfareAirports(origin: string, city: string, nonstop: boolean) {
  const from = airportForCity(origin);
  if (city === origin) return undefined;
  const entry = Object.hasOwn(BOSTON_FLIGHTS.destinations, city) ? BOSTON_FLIGHTS.destinations[city] : undefined;
  const route = origin === 'Boston' ? (nonstop ? entry?.nonstopOutbound : entry?.outbound) : undefined;
  const to = route?.path.at(-1) ?? airportForCity(city);
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
