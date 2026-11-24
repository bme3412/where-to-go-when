export function priceRetryAfter(requests: readonly number[], now: number): string | undefined {
  const next = Math.max((requests.at(-5) ?? -Infinity) + 60_000, (requests.at(-15) ?? -Infinity) + 3_600_000);
  if (next > now) return String(Math.ceil((next - now) / 1000));
}

export function priceRateLimited(error: string, retryAfter?: string | null): Response {
  return Response.json({ error }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': retryAfter || '60' },
  });
}
