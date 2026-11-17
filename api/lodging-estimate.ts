import { createLodgingHandler } from '../src/server/lodging';

const lodging = createLodgingHandler();

export const config = { runtime: 'edge' };

export default function handler(request: Request): Promise<Response> {
  return lodging(request, process.env.NUITEE_API_KEY, process.env.NUITEE_CACHE_ALLOWED === 'true');
}
