#!/usr/bin/env python3
"""Query nonstop and one-stop possibilities in Jonty's airline route network.

The graph is built from the local copy of airline_routes.json. A path means
those directed legs exist in the published route network. It is not a schedule:
operating dates, departure times, minimum layovers, and ticketing rules are
absent, so a path is not a bookable itinerary.

Source: https://github.com/Jonty/airline-route-data
"""
import argparse
import datetime
import hashlib
import json
import math
import pathlib
import re

import networkx as nx
import pyarrow as pa
import pyarrow.parquet as pq

ROOT = pathlib.Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / 'data' / 'flights' / 'jonty.json'
ROUTES_PATH = ROOT / 'data' / 'flights' / 'airline_routes.parquet'
AIRPORTS_PATH = ROOT / 'data' / 'flights' / 'airports.parquet'
PLACES_PATH = ROOT / 'data' / 'flights' / 'place_connections.json'
BOSTON_PATH = ROOT / 'src' / 'data' / 'boston-flights.json'
GATEWAYS_PATH = ROOT / 'data' / 'flights' / 'boston-gateways.json'
SOURCE = 'https://github.com/Jonty/airline-route-data'

# Planning assumptions, not observed schedules or minimum connection times.
BOSTON_ASSUMPTIONS = {
    'homeTransferMinutes': 45,
    'departureMinutes': 120,
    'arrivalMinutes': 45,
    'connectionMinutes': 150,
    'groundSpeedKmh': 50,
    'groundDistanceMultiplier': 1.3,
    'minimumGroundMinutes': 30,
}

# Airports farther than this from a place coordinate are not treated as that
# place's airport. The nearest airport is still recorded for inspection.
SERVICE_KM = 80
LOCAL_KM = 56
BUSY_ROUTES = 12
HUB_ROUTES = 120
NON_AIRPORT = re.compile(r'railway|station|heliport|sea ?plane|seaplane|harbour|harbor', re.IGNORECASE)
# The route file's country labels differ from the app's. Hong Kong and Tahiti
# are named places whose airports are not in the app's country string.
AIRPORT_COUNTRIES = {
    'United States of America': {'USA', 'United States'},
    'Czechia': {'Czech Republic'},
    'Vietnam': {'Viet Nam'},
    'South Korea': {'Republic of Korea'},
    'Tanzania': {'United Republic of Tanzania'},
    'Turkey': {'Turkiye', 'Turkey'},
}
PLACE_AIRPORT_COUNTRIES = {
    'Hong Kong': {'Hong Kong SAR'},
    'Tahiti': {'French Polynesia'},
}

PLACE_ROW = re.compile(
    r'\["(?P<name>[^"]*)"(?:,"(?P<country>[^"]*)")?,(?P<lat>-?\d+(?:\.\d+)?),(?P<lon>-?\d+(?:\.\d+)?)'
)
ORIGIN_COUNTRY = re.compile(r"(?:'([^']+)'|([A-Za-zÀ-ÿ]+))\s*:\s*'([^']+)'")


def load_json(path=JSON_PATH):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def route_records(data):
    """One directed edge per airport pair. Duplicate legs keep the faster time."""
    edges = {}
    for origin, airport in data.items():
        for route in airport.get('routes') or []:
            destination = route.get('iata')
            if not destination or destination == origin:
                continue
            airlines = tuple(sorted({
                carrier['iata'] for carrier in route.get('carriers') or [] if carrier.get('iata')
            }))
            key = (origin, destination)
            current = edges.get(key)
            minutes = int(route['min'])
            kilometers = int(route['km'])
            if current is None or minutes < current['duration_min']:
                edges[key] = {
                    'origin': origin,
                    'destination': destination,
                    'distance_km': kilometers,
                    'duration_min': minutes,
                    'airlines': airlines,
                }
            elif minutes == current['duration_min']:
                current['airlines'] = tuple(sorted(set(current['airlines']) | set(airlines)))
                current['distance_km'] = min(current['distance_km'], kilometers)
            else:
                current['airlines'] = tuple(sorted(set(current['airlines']) | set(airlines)))
    return list(edges.values())


def airport_records(data):
    airports = []
    for code, airport in data.items():
        if airport.get('latitude') is None or airport.get('longitude') is None:
            continue
        airports.append({
            'iata': code,
            'city': airport.get('city_name') or '',
            'country': airport.get('country') or '',
            'name': airport.get('name') or '',
            'latitude': float(airport['latitude']),
            'longitude': float(airport['longitude']),
        })
    airports.sort(key=lambda item: item['iata'])
    return airports


def write_parquet(routes, airports, routes_path=ROUTES_PATH, airports_path=AIRPORTS_PATH):
    route_table = pa.table({
        'origin': [row['origin'] for row in routes],
        'destination': [row['destination'] for row in routes],
        'distance_km': [row['distance_km'] for row in routes],
        'duration_min': [row['duration_min'] for row in routes],
        'airlines': [list(row['airlines']) for row in routes],
    })
    airport_table = pa.table({
        'iata': [row['iata'] for row in airports],
        'city': [row['city'] for row in airports],
        'country': [row['country'] for row in airports],
        'name': [row['name'] for row in airports],
        'latitude': [row['latitude'] for row in airports],
        'longitude': [row['longitude'] for row in airports],
    })
    routes_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(route_table, routes_path, compression='zstd')
    pq.write_table(airport_table, airports_path, compression='zstd')
    return route_table.num_rows, airport_table.num_rows


def load_routes(path=ROUTES_PATH):
    table = pq.read_table(path)
    return [
        {
            'origin': origin,
            'destination': destination,
            'distance_km': distance,
            'duration_min': minutes,
            'airlines': tuple(airlines or []),
        }
        for origin, destination, distance, minutes, airlines in zip(
            table.column('origin').to_pylist(),
            table.column('destination').to_pylist(),
            table.column('distance_km').to_pylist(),
            table.column('duration_min').to_pylist(),
            table.column('airlines').to_pylist(),
        )
    ]


def load_airports(path=AIRPORTS_PATH):
    table = pq.read_table(path)
    return {
        code: {
            'iata': code,
            'city': city,
            'country': country,
            'name': name,
            'latitude': latitude,
            'longitude': longitude,
        }
        for code, city, country, name, latitude, longitude in zip(
            table.column('iata').to_pylist(),
            table.column('city').to_pylist(),
            table.column('country').to_pylist(),
            table.column('name').to_pylist(),
            table.column('latitude').to_pylist(),
            table.column('longitude').to_pylist(),
        )
    }


def build_graph(routes):
    graph = nx.DiGraph()
    for route in routes:
        graph.add_edge(
            route['origin'],
            route['destination'],
            distance_km=route['distance_km'],
            duration_min=route['duration_min'],
            airlines=list(route['airlines']),
        )
    return graph


def find_routes(graph, origin, destination):
    """Return airport paths of one and two legs. Same shape as a successor walk."""
    nonstop = []
    one_stop = []
    if graph.has_edge(origin, destination):
        nonstop.append([origin, destination])
    if origin == destination:
        return {'nonstop': nonstop, 'one_stop': one_stop}
    for hub in graph.successors(origin):
        if hub not in (origin, destination) and graph.has_edge(hub, destination):
            one_stop.append([origin, hub, destination])
    return {'nonstop': nonstop, 'one_stop': one_stop}


def describe_path(graph, path):
    legs = []
    for start, end in zip(path, path[1:]):
        edge = graph.edges[start, end]
        legs.append({
            'from': start,
            'to': end,
            'distance_km': edge['distance_km'],
            'duration_min': edge['duration_min'],
            'airlines': list(edge['airlines']),
        })
    return {
        'path': path,
        'distance_km': sum(leg['distance_km'] for leg in legs),
        'duration_min': sum(leg['duration_min'] for leg in legs),
        'legs': legs,
    }


def describe_routes(graph, origin, destination):
    found = find_routes(graph, origin, destination)
    nonstop = [describe_path(graph, path) for path in found['nonstop']]
    one_stop = [describe_path(graph, path) for path in found['one_stop']]
    one_stop.sort(key=lambda item: (item['duration_min'], item['distance_km'], item['path']))
    return {'nonstop': nonstop, 'one_stop': one_stop}


def haversine_km(lat1, lon1, lat2, lon2):
    radians = math.pi / 180
    a = math.sin((lat2 - lat1) * radians / 2) ** 2
    a += math.cos(lat1 * radians) * math.cos(lat2 * radians) * math.sin((lon2 - lon1) * radians / 2) ** 2
    return 12742 * math.asin(math.sqrt(min(1, max(0, a))))


def read_places():
    """Origin and destination coordinates already used by the app."""
    places = {}
    origin_text = (ROOT / 'src' / 'data' / 'origins.ts').read_text(encoding='utf-8')
    city_text = (ROOT / 'src' / 'data' / 'cities.ts').read_text(encoding='utf-8')
    country_block = origin_text.split('ORIGIN_COUNTRIES', 1)[1].split('} as const', 1)[0]
    origin_countries = {}
    for quoted, bare, country in ORIGIN_COUNTRY.findall(country_block):
        origin_countries[quoted or bare] = country
    for name, country, lat, lon in PLACE_ROW.findall(origin_text):
        places[name] = {
            'name': name,
            'role': 'origin',
            'country': origin_countries[name],
            'lat': float(lat),
            'lon': float(lon),
        }
    for name, country, lat, lon in PLACE_ROW.findall(city_text):
        role = 'both' if name in places else 'destination'
        places[name] = {'name': name, 'role': role, 'country': country, 'lat': float(lat), 'lon': float(lon)}
    return places


def accepted_countries(place):
    if place['name'] in PLACE_AIRPORT_COUNTRIES:
        return PLACE_AIRPORT_COUNTRIES[place['name']]
    return {place['country'], *AIRPORT_COUNTRIES.get(place['country'], ())}


def carrier_routes(graph):
    """Count legs that name a carrier. Empty carrier lists do not make an airport commercial."""
    counts = {}
    for origin, destination, edge in graph.edges(data=True):
        if not edge.get('airlines'):
            continue
        counts[origin] = counts.get(origin, 0) + 1
        counts[destination] = counts.get(destination, 0) + 1
    return counts


def select_airports(place, nearby, service_km=SERVICE_KM, local_km=LOCAL_KM):
    """Pick commercial airports for one place.

    `nearby` items have iata, country, name, km, and carrier_routes. A local
    field with only a handful of carrier legs is kept when nothing larger is
    close. Extra airports have to be nearby and busy, or a large hub inside
    the service radius. Rail stations, heliports, and seaplane bases are skipped.
    """
    accepted = accepted_countries(place)
    pool = [
        item for item in nearby
        if item['km'] <= service_km
        and item['country'] in accepted
        and item['carrier_routes'] >= 4
        and not NON_AIRPORT.search(item['name'])
    ]
    if not pool:
        return []
    busy = [item for item in pool if item['carrier_routes'] >= BUSY_ROUTES]
    if busy:
        anchor = min(busy, key=lambda item: (item['km'], -item['carrier_routes']))
        chosen = {anchor['iata']}
        for item in busy:
            if item['km'] <= local_km or item['carrier_routes'] >= HUB_ROUTES:
                chosen.add(item['iata'])
    else:
        # A small island or town field still counts when no busier airport is close.
        tiny = [item for item in pool if item['km'] <= 50]
        if not tiny:
            return []
        chosen = {min(tiny, key=lambda item: (item['km'], -item['carrier_routes']))['iata']}
    ordered = [item['iata'] for item in sorted(pool, key=lambda item: (item['km'], item['iata'])) if item['iata'] in chosen]
    if len(ordered) <= 6:
        return ordered
    ranked = sorted((item for item in pool if item['iata'] in chosen), key=lambda item: (-item['carrier_routes'], item['km']))
    keep = {anchor['iata']}
    for item in ranked:
        keep.add(item['iata'])
        if len(keep) == 6:
            break
    return [code for code in ordered if code in keep]


def assign_airports(places, airports, graph, service_km=SERVICE_KM):
    routes = carrier_routes(graph)
    assigned = {}
    for place in places.values():
        nearby = []
        nearest = None
        for airport in airports.values():
            kilometers = haversine_km(place['lat'], place['lon'], airport['latitude'], airport['longitude'])
            item = {
                'iata': airport['iata'],
                'country': airport['country'],
                'name': airport['name'],
                'km': kilometers,
                'carrier_routes': routes.get(airport['iata'], 0),
            }
            nearby.append(item)
            if nearest is None or kilometers < nearest['km']:
                nearest = item
        chosen = select_airports(place, nearby, service_km=service_km)
        assigned[place['name']] = {
            'airports': chosen,
            'nearest': nearest['iata'],
            'nearest_km': round(nearest['km'], 1),
            'nearest_routes': nearest['carrier_routes'],
            'served': bool(chosen),
        }
    return assigned


def connect_places(graph, origin_airports, destination_airports):
    origins = [code for code in origin_airports if code in graph]
    destinations = [code for code in destination_airports if code in graph]
    origin_set = set(origins)
    destination_set = set(destinations)
    nonstop = []
    best = {}
    count = 0
    for origin in origins:
        for destination in destinations:
            if origin == destination or not graph.has_edge(origin, destination):
                continue
            described = describe_path(graph, [origin, destination])
            nonstop.append(described)
    nonstop.sort(key=lambda item: (item['duration_min'], item['distance_km'], item['path']))
    for origin in origins:
        for hub in graph.successors(origin):
            if hub in origin_set or hub in destination_set:
                continue
            for destination in destinations:
                if not graph.has_edge(hub, destination):
                    continue
                described = describe_path(graph, [origin, hub, destination])
                count += 1
                key = (described['duration_min'], described['distance_km'], tuple(described['path']))
                if len(best) < 3 or key < max(best):
                    best[key] = described
                    if len(best) > 3:
                        del best[max(best)]
    fastest = [best[key] for key in sorted(best)]
    return {'nonstop': nonstop, 'one_stop_count': count, 'fastest_one_stop': fastest}


def place_connections(graph, places, assignment):
    origins = [name for name, place in places.items() if place['role'] in ('origin', 'both')]
    destinations = [name for name, place in places.items() if place['role'] in ('destination', 'both')]
    links = {}
    for origin in origins:
        if not assignment[origin]['served']:
            continue
        origin_links = {}
        for destination in destinations:
            if origin == destination or not assignment[destination]['served']:
                continue
            found = connect_places(
                graph,
                assignment[origin]['airports'],
                assignment[destination]['airports'],
            )
            if not found['nonstop'] and not found['one_stop_count']:
                kind = 'none'
            elif found['nonstop']:
                kind = 'nonstop'
            else:
                kind = 'one_stop'
            fastest = found['fastest_one_stop'][0] if found['fastest_one_stop'] else None
            origin_links[destination] = {
                'kind': kind,
                'nonstop': [
                    {'path': item['path'], 'duration_min': item['duration_min'], 'distance_km': item['distance_km'],
                     'airlines': [leg['airlines'] for leg in item['legs']]}
                    for item in found['nonstop']
                ],
                'one_stop_count': found['one_stop_count'],
                'fastest_one_stop': None if fastest is None else {
                    'path': fastest['path'],
                    'duration_min': fastest['duration_min'],
                    'distance_km': fastest['distance_km'],
                    'airlines': [leg['airlines'] for leg in fastest['legs']],
                },
            }
        links[origin] = origin_links
    return links


def export_network(json_path=JSON_PATH):
    data = load_json(json_path)
    routes = route_records(data)
    airports = airport_records(data)
    route_count, airport_count = write_parquet(routes, airports)
    return {'airports': airport_count, 'routes': route_count, 'json_airports': len(data)}


def estimated_gateway(place, airport):
    kilometers = haversine_km(place['lat'], place['lon'], airport['latitude'], airport['longitude'])
    minutes = kilometers * BOSTON_ASSUMPTIONS['groundDistanceMultiplier'] / BOSTON_ASSUMPTIONS['groundSpeedKmh'] * 60
    return {
        'iata': airport['iata'],
        'minutes': max(BOSTON_ASSUMPTIONS['minimumGroundMinutes'], math.ceil(minutes / 5) * 5),
        'mode': 'ground',
        'basis': 'distance',
        'note': 'Approximate local transfer from airport distance; roads, traffic and transit schedules are not checked.',
        'sourceUrl': None,
        'checked': None,
    }


def best_boston_route(graph, gateways, outbound, nonstop_only=False):
    """Choose by flight + connection + destination transfer, separately each way.

    Search each gateway independently so a short ground transfer can outweigh
    a slightly longer flight. Unknown transfers rank after known transfers.
    """
    candidates = []
    gateway_codes = {gateway['iata'] for gateway in gateways}
    if 'BOS' not in graph:
        return None
    for gateway in gateways:
        code = gateway['iata']
        if code not in graph:
            continue
        found = find_routes(graph, 'BOS' if outbound else code, code if outbound else 'BOS')
        for path in found['nonstop'] if nonstop_only else [*found['nonstop'], *found['one_stop']]:
            # A second airport in the destination city is not a useful hub.
            if set(path[1:-1]) & gateway_codes:
                continue
            route = describe_path(graph, path)
            stops = len(route['path']) - 2
            flight_and_connection = route['duration_min'] + stops * BOSTON_ASSUMPTIONS['connectionMinutes']
            key = (gateway['minutes'] is None, flight_and_connection + (gateway['minutes'] or 0), stops, tuple(route['path']))
            candidates.append((key, route))
    if not candidates:
        return None
    route = min(candidates, key=lambda item: item[0])[1]
    return {
        'path': route['path'],
        'flightMinutes': route['duration_min'],
        'legs': [
            {'from': leg['from'], 'to': leg['to'], 'minutes': leg['duration_min'], 'airlines': leg['airlines']}
            for leg in route['legs']
        ],
    }


def boston_snapshot(data, places, overrides, source_sha256, generated_at, gateways_sha256):
    airports = {airport['iata']: airport for airport in airport_records(data) if not NON_AIRPORT.search(airport['name'])}
    if 'BOS' not in airports:
        raise ValueError('The source snapshot must contain Boston Logan (BOS).')
    # A usable flight leg needs named carriers, endpoints and a positive time.
    graph = build_graph([
        route for route in route_records(data)
        if route['origin'] in airports and route['destination'] in airports
        and route['airlines'] and route['duration_min'] > 0
    ])
    assignment = assign_airports(places, airports, graph)
    destinations = {}
    for name, place in sorted(places.items()):
        if name == 'Boston' or place['role'] not in ('destination', 'both'):
            continue
        override = overrides.get(name, {})
        if 'gateways' in override:
            gateways = override['gateways']
        else:
            codes = override.get('airportCodes', assignment[name]['airports'])
            gateways = [estimated_gateway(place, airports[code]) for code in codes]
        for gateway in gateways:
            if gateway['iata'] not in airports or (gateway['minutes'] is not None and gateway['minutes'] < 0):
                raise ValueError(f'Invalid gateway for {name}: {gateway}')
        destinations[name] = {
            'gateways': gateways,
            'outbound': best_boston_route(graph, gateways, True),
            'inbound': best_boston_route(graph, gateways, False),
            'nonstopOutbound': best_boston_route(graph, gateways, True, nonstop_only=True),
            'nonstopInbound': best_boston_route(graph, gateways, False, nonstop_only=True),
            'note': override.get('note'),
        }
    used_airports = {'BOS'}
    used_airlines = set()
    for destination in destinations.values():
        used_airports.update(gateway['iata'] for gateway in destination['gateways'])
        for direction in ('outbound', 'inbound', 'nonstopOutbound', 'nonstopInbound'):
            route = destination[direction]
            if route:
                used_airports.update(route['path'])
                used_airlines.update(code for leg in route['legs'] for code in leg['airlines'])
    airline_names = {
        airline['iata']: airline.get('name') or airline['iata']
        for airport in data.values() for route in airport.get('routes', [])
        for airline in route.get('carriers', []) if airline.get('iata') in used_airlines
    }
    return {
        'schemaVersion': 2,
        'origin': 'BOS',
        'generatedAt': generated_at,
        'source': {
            'name': 'Jonty airline-route-data', 'url': SOURCE,
            'sha256': source_sha256, 'snapshotDate': None,
            'note': 'Local route snapshot; its acquisition date and upstream revision are unknown. Export time does not establish route freshness. Dates, schedules, fares and ticketing are absent.',
        },
        'gatewaysSha256': gateways_sha256,
        'assumptions': BOSTON_ASSUMPTIONS,
        'airports': {code: {'name': airports[code]['name'], 'city': airports[code]['city'], 'lat': airports[code]['latitude'], 'lon': airports[code]['longitude']} for code in sorted(used_airports)},
        'airlines': dict(sorted(airline_names.items())),
        'destinations': destinations,
    }


def export_boston(json_path=JSON_PATH, gateways_path=GATEWAYS_PATH, output_path=BOSTON_PATH):
    raw = json_path.read_bytes()
    overrides = gateways_path.read_bytes()
    payload = boston_snapshot(
        json.loads(raw), read_places(), json.loads(overrides),
        hashlib.sha256(raw).hexdigest(), datetime.datetime.now(datetime.timezone.utc).isoformat(),
        hashlib.sha256(overrides).hexdigest(),
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    return payload


def format_leg(leg):
    airlines = ', '.join(leg['airlines']) if leg['airlines'] else 'carrier not listed'
    return f"{leg['from']}→{leg['to']} {leg['duration_min']} min, {leg['distance_km']} km ({airlines})"


def format_route(route):
    via = ' → '.join(route['path'])
    return f"{via}: {route['duration_min']} min, {route['distance_km']} km"


def main():
    parser = argparse.ArgumentParser(description='Query nonstop and one-stop airline route possibilities.')
    parser.add_argument('command', choices=('export', 'query', 'places', 'boston'))
    parser.add_argument('origin', nargs='?', help='Origin IATA code, used by query.')
    parser.add_argument('destination', nargs='?', help='Destination IATA code, used by query.')
    parser.add_argument('--limit', type=int, default=25, help='One-stop paths to print.')
    args = parser.parse_args()

    if args.command == 'boston':
        payload = export_boston()
        both = sum(bool(row['outbound'] and row['inbound']) for row in payload['destinations'].values())
        print(f"Wrote {BOSTON_PATH.relative_to(ROOT)}: {len(payload['destinations'])} destinations, {both} with routes in both directions.")
        return

    if args.command == 'export':
        stats = export_network()
        print(f"Wrote {stats['routes']} routes and {stats['airports']} airports.")
        print(f"Routes: {ROUTES_PATH.relative_to(ROOT)}")
        print(f"Airports: {AIRPORTS_PATH.relative_to(ROOT)}")
        return

    if not ROUTES_PATH.exists() or not AIRPORTS_PATH.exists():
        export_network()
    graph = build_graph(load_routes())

    if args.command == 'query':
        if not args.origin or not args.destination:
            parser.error('query requires an origin and a destination IATA code')
        origin, destination = args.origin.upper(), args.destination.upper()
        missing = [code for code in (origin, destination) if code not in graph]
        if missing:
            raise SystemExit(f"Unknown airport code: {', '.join(missing)}")
        found = describe_routes(graph, origin, destination)
        print(f"{origin} → {destination}")
        print(f"Nonstop: {len(found['nonstop'])}. One-stop paths: {len(found['one_stop'])}.")
        print('Route-network possibilities, not bookable itineraries.')
        print('Minutes are the sum of the stored leg times and do not include a layover.')
        for route in found['nonstop']:
            print(f"  nonstop {format_route(route)}")
            for leg in route['legs']:
                print(f"    {format_leg(leg)}")
        shown = found['one_stop'][:max(0, args.limit)]
        for route in shown:
            print(f"  one-stop {format_route(route)}")
        remaining = len(found['one_stop']) - len(shown)
        if remaining:
            print(f"  … {remaining} slower one-stop paths not shown.")
        return

    places = read_places()
    airports = load_airports()
    assignment = assign_airports(places, airports, graph)
    links = place_connections(graph, places, assignment)
    payload = {
        'source': SOURCE,
        'service_km': SERVICE_KM,
        'note': (
            'Directed route-network possibilities from Jonty airline_routes.json. '
            'A listed path does not establish a bookable itinerary: operating dates, '
            'departure times, layover rules, and ticketing constraints are not in this file. '
            'duration_min is the sum of stored leg times and does not include a layover.'
        ),
        'places': {
            name: {**places[name], **assignment[name]}
            for name in sorted(places)
        },
        'connections': links,
    }
    PLACES_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    origins = sorted(name for name, place in places.items() if place['role'] in ('origin', 'both'))
    print(f"Wrote {PLACES_PATH.relative_to(ROOT)}")
    print(f"Airports within {SERVICE_KM} km:")
    for name in sorted(places):
        item = assignment[name]
        codes = ', '.join(item['airports']) if item['airports'] else 'none'
        print(f"  {name}: {codes} (nearest {item['nearest']} {item['nearest_km']} km)")
    print('Reachable destinations from each home city:')
    for origin in origins:
        rows = links.get(origin, {})
        counts = {kind: sum(1 for row in rows.values() if row['kind'] == kind) for kind in ('nonstop', 'one_stop', 'none')}
        unserved = sum(1 for name, place in places.items() if place['role'] in ('destination', 'both') and name != origin and not assignment[name]['served'])
        print(f"  {origin}: {counts['nonstop']} nonstop, {counts['one_stop']} one-stop only, {counts['none']} no path, {unserved} without a nearby airport")


if __name__ == '__main__':
    main()
