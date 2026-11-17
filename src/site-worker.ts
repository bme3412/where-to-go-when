import html from '../dist/index.html?raw';
import { AIRFARE_ENDPOINT } from './airfare';
import { createAirfareHandler } from './server/airfare';
import { LODGING_ENDPOINT } from './lodging';
import { createLodgingHandler } from './server/lodging';

const airfare = createAirfareHandler();
const lodging = createLodgingHandler();

export default {
  fetch(request: Request, env: { NUITEE_API_KEY?: string; NUITEE_FLIGHTS_ENABLED?: string; NUITEE_CACHE_ALLOWED?: string }): Response | Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === AIRFARE_ENDPOINT) return airfare(request, env.NUITEE_FLIGHTS_ENABLED === 'true' ? env.NUITEE_API_KEY : undefined);
    if (pathname === LODGING_ENDPOINT) return lodging(request, env.NUITEE_API_KEY, env.NUITEE_CACHE_ALLOWED === 'true');
    if (pathname !== '/' && pathname !== '/index.html') return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};
