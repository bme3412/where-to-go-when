import { createAirfareHandler } from '../src/server/airfare';

const airfare = createAirfareHandler();

export const config = { runtime: 'edge' };

export default function handler(request: Request): Promise<Response> {
  return airfare(request, process.env.NUITEE_FLIGHTS_ENABLED === 'true' ? process.env.NUITEE_API_KEY : undefined);
}
