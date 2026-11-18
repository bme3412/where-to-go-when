import { ONWARD_TRANSFERS } from './data/onward-transfers';
import snapshot from './data/boston-flights.json';
import type { BostonDestination, BostonTrip, FlightJourney, FlightRoute, Travel } from './types';

// The exporter validates the local source; only this small BOS subset is bundled.
export const BOSTON_FLIGHTS = snapshot as {
  schemaVersion: number; origin: string; generatedAt: string;
  source: { name: string; url: string; sha256: string; snapshotDate: string | null; note: string };
  gatewaysSha256: string;
  assumptions: {
    homeTransferMinutes: number; departureMinutes: number; arrivalMinutes: number; connectionMinutes: number;
    groundSpeedKmh: number; groundDistanceMultiplier: number; minimumGroundMinutes: number;
  };
  airports: Record<string, { name: string; city: string; lat: number; lon: number }>;
  airlines: Record<string, string>;
  destinations: Record<string, BostonDestination>;
};

function journey(route: FlightRoute | null, destination: BostonDestination, outbound: boolean, city: string): FlightJourney | null {
  if (!route) return null;
  const airport = outbound ? route.path.at(-1) : route.path[0];
  let gateway = destination.gateways.find(item => item.iata === airport);
  if (!gateway) return null;
  const transfer = ONWARD_TRANSFERS[city];
  if (gateway.minutes === null && transfer && transfer.gateway === airport) {
    gateway = { ...gateway, minutes: transfer.minutes, basis: 'reviewed', note: transfer.leg, sourceUrl: transfer.source, checked: '2026-11-18' };
  }
  const a = BOSTON_FLIGHTS.assumptions;
  const connectionMinutes = Math.max(0, route.legs.length - 1) * a.connectionMinutes;
  const totalMinutes = gateway.minutes === null ? null
    : route.flightMinutes + connectionMinutes + a.homeTransferMinutes + a.departureMinutes + a.arrivalMinutes + gateway.minutes;
  return { route, gateway, connectionMinutes, totalMinutes };
}

export function bostonTrip(destinationName: string, nonstopOnly = false): BostonTrip {
  const destination = BOSTON_FLIGHTS.destinations[destinationName];
  if (!destination) return { outbound: null, inbound: null, note: 'This destination has no entry in the Boston snapshot.', hasGateway: false };
  return {
    outbound: journey(nonstopOnly ? destination.nonstopOutbound : destination.outbound, destination, true, destinationName),
    inbound: journey(nonstopOnly ? destination.nonstopInbound : destination.inbound, destination, false, destinationName),
    note: ONWARD_TRANSFERS[destinationName] ? null : destination.note,
    hasGateway: destination.gateways.length > 0,
  };
}

/** Applies to flight journeys, not nearby drives, and requires both directed legs. */
export function isNonstopBostonTrip(travel: Travel): boolean {
  const out = travel.flights?.outbound?.route, back = travel.flights?.inbound?.route;
  return travel.mode === 'flight' && out?.legs.length === 1 && back?.legs.length === 1
    && out.path.length === 2 && back.path.length === 2 && out.path[0] === 'BOS' && back.path[1] === 'BOS';
}
