"""Route-graph queries over a tiny directed network. python3 -m unittest discover -s scripts."""
import importlib.util
import hashlib
import json
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('airline_routes', pathlib.Path(__file__).with_name('airline_routes.py'))
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)


class AirlineRouteTests(unittest.TestCase):
    def network(self):
        data = {
            'BOS': {'latitude': '42.36', 'longitude': '-71.01', 'city_name': 'Boston', 'country': 'United States', 'name': 'Logan', 'routes': [
                {'iata': 'CDG', 'km': 5590, 'min': 420, 'carriers': [{'iata': 'AF', 'name': 'Air France'}]},
                {'iata': 'LHR', 'km': 5260, 'min': 400, 'carriers': [{'iata': 'BA', 'name': 'British Airways'}]},
                {'iata': 'DUB', 'km': 4800, 'min': 370, 'carriers': []},
            ]},
            'LHR': {'latitude': '51.47', 'longitude': '-0.46', 'city_name': 'London', 'country': 'United Kingdom', 'name': 'Heathrow', 'routes': [
                {'iata': 'CDG', 'km': 350, 'min': 75, 'carriers': [{'iata': 'BA', 'name': 'British Airways'}]},
            ]},
            'DUB': {'latitude': '53.42', 'longitude': '-6.27', 'city_name': 'Dublin', 'country': 'Ireland', 'name': 'Dublin', 'routes': []},
            'CDG': {'latitude': '49.01', 'longitude': '2.55', 'city_name': 'Paris', 'country': 'France', 'name': 'Charles de Gaulle', 'routes': [
                {'iata': 'BOS', 'km': 5590, 'min': 450, 'carriers': [{'iata': 'AF', 'name': 'Air France'}]},
            ]},
            'ORY': {'latitude': '48.72', 'longitude': '2.36', 'city_name': 'Paris', 'country': 'France', 'name': 'Orly', 'routes': []},
        }
        graph = routes.build_graph(routes.route_records(data))
        return data, graph

    def test_nonstop_and_one_stop_follow_directed_edges(self):
        _, graph = self.network()
        found = routes.find_routes(graph, 'BOS', 'CDG')
        self.assertEqual(found['nonstop'], [['BOS', 'CDG']])
        self.assertEqual(found['one_stop'], [['BOS', 'LHR', 'CDG']])
        reverse = routes.find_routes(graph, 'CDG', 'BOS')
        self.assertEqual(reverse['nonstop'], [['CDG', 'BOS']])
        self.assertEqual(reverse['one_stop'], [])

    def test_duplicate_legs_keep_the_faster_time_and_union_carriers(self):
        data = {'BOS': {'routes': [
            {'iata': 'CDG', 'km': 5600, 'min': 430, 'carriers': [{'iata': 'DL'}]},
            {'iata': 'CDG', 'km': 5590, 'min': 420, 'carriers': [{'iata': 'AF'}]},
            {'iata': 'CDG', 'km': 5700, 'min': 420, 'carriers': [{'iata': 'AA'}]},
        ]}}
        edge = routes.route_records(data)[0]
        self.assertEqual(edge['duration_min'], 420)
        self.assertEqual(edge['distance_km'], 5590)
        self.assertEqual(edge['airlines'], ('AA', 'AF'))

    def test_place_connection_ignores_a_hub_inside_either_metro(self):
        _, graph = self.network()
        found = routes.connect_places(graph, ['BOS'], ['CDG', 'ORY'])
        self.assertEqual(found['nonstop'][0]['path'], ['BOS', 'CDG'])
        self.assertEqual(found['one_stop_count'], 1)
        self.assertEqual(found['fastest_one_stop'][0]['path'], ['BOS', 'LHR', 'CDG'])

    def test_place_airports_keep_commercial_fields_and_drop_other_cities(self):
        paris = {'name': 'Paris', 'country': 'France'}
        nearby = [
            {'iata': 'QQS', 'country': 'France', 'name': 'St Pancras Railway Station', 'km': 2, 'carrier_routes': 0},
            {'iata': 'LBG', 'country': 'France', 'name': 'Le Bourget', 'km': 13, 'carrier_routes': 0},
            {'iata': 'ORY', 'country': 'France', 'name': 'Orly', 'km': 15, 'carrier_routes': 357},
            {'iata': 'CDG', 'country': 'France', 'name': 'Charles de Gaulle', 'km': 23, 'carrier_routes': 565},
            {'iata': 'BVA', 'country': 'France', 'name': 'Beauvais', 'km': 69, 'carrier_routes': 161},
        ]
        self.assertEqual(routes.select_airports(paris, nearby), ['ORY', 'CDG', 'BVA'])

        boston = {'name': 'Boston', 'country': 'United States of America'}
        boston_airports = [
            {'iata': 'BOS', 'country': 'USA', 'name': 'Logan', 'km': 3, 'carrier_routes': 314},
            {'iata': 'HHR', 'country': 'USA', 'name': 'Hawthorne', 'km': 17, 'carrier_routes': 4},
            {'iata': 'OWD', 'country': 'USA', 'name': 'Norwood', 'km': 18, 'carrier_routes': 2},
            {'iata': 'PVD', 'country': 'USA', 'name': 'Providence', 'km': 77, 'carrier_routes': 77},
        ]
        self.assertEqual(routes.select_airports(boston, boston_airports), ['BOS'])

        hong_kong = {'name': 'Hong Kong', 'country': 'China'}
        hong_kong_airports = [
            {'iata': 'HKG', 'country': 'Hong Kong SAR', 'name': 'Hong Kong International', 'km': 24, 'carrier_routes': 291},
            {'iata': 'SZX', 'country': 'China', 'name': 'Shenzhen', 'km': 51, 'carrier_routes': 328},
        ]
        self.assertEqual(routes.select_airports(hong_kong, hong_kong_airports), ['HKG'])

        galapagos = {'name': 'Galápagos', 'country': 'Ecuador'}
        islands = [
            {'iata': 'GPS', 'country': 'Ecuador', 'name': 'Baltra', 'km': 34, 'carrier_routes': 5},
        ]
        self.assertEqual(routes.select_airports(galapagos, islands), ['GPS'])

    def test_boston_route_selection_includes_ground_time_and_connections(self):
        graph = routes.build_graph([
            {'origin': 'BOS', 'destination': 'CDG', 'duration_min': 400, 'distance_km': 5500, 'airlines': ['AF']},
            {'origin': 'BOS', 'destination': 'ORY', 'duration_min': 430, 'distance_km': 5500, 'airlines': ['AF']},
            {'origin': 'BOS', 'destination': 'DUB', 'duration_min': 300, 'distance_km': 4800, 'airlines': ['EI']},
            {'origin': 'DUB', 'destination': 'ORY', 'duration_min': 60, 'distance_km': 700, 'airlines': ['EI']},
        ])
        gateways = [{'iata': 'CDG', 'minutes': 120}, {'iata': 'ORY', 'minutes': 30}]
        # ORY wins after the ground transfer, despite its longer nonstop flight.
        # The superficially faster DUB connection loses after the layover.
        self.assertEqual(routes.best_boston_route(graph, gateways, True)['path'], ['BOS', 'ORY'])
        self.assertIsNone(routes.best_boston_route(graph, gateways, False))

    def test_unknown_transfer_is_not_a_free_transfer(self):
        _, graph = self.network()
        gateways = [{'iata': 'CDG', 'minutes': None}, {'iata': 'LHR', 'minutes': 180}]
        self.assertEqual(routes.best_boston_route(graph, gateways, True)['path'], ['BOS', 'LHR'])

    def test_nonstop_alternative_survives_a_faster_connection(self):
        _, graph = self.network()
        graph.edges['BOS', 'CDG']['duration_min'] = 900
        gateways = [{'iata': 'CDG', 'minutes': 30}]
        self.assertEqual(routes.best_boston_route(graph, gateways, True)['path'], ['BOS', 'LHR', 'CDG'])
        self.assertEqual(routes.best_boston_route(graph, gateways, True, nonstop_only=True)['path'], ['BOS', 'CDG'])
        self.assertIsNone(routes.best_boston_route(graph, [{'iata': 'LHR', 'minutes': 30}], False, nonstop_only=True))

    def test_boston_export_filters_unattributed_legs_and_preserves_directions(self):
        data, _ = self.network()
        data['DUB']['routes'] = [{'iata': 'CDG', 'min': 5, 'km': 100, 'carriers': [{'iata': 'AF'}]}]
        places = {
            'Boston': {'name': 'Boston', 'role': 'both', 'lat': 42.36, 'lon': -71.01, 'country': 'United States'},
            'Paris': {'name': 'Paris', 'role': 'destination', 'lat': 48.85, 'lon': 2.35, 'country': 'France'},
            'Dublin': {'name': 'Dublin', 'role': 'destination', 'lat': 53.42, 'lon': -6.27, 'country': 'Ireland'},
        }
        payload = routes.boston_snapshot(data, places, {'Paris': {'airportCodes': ['CDG']}, 'Dublin': {'airportCodes': ['DUB']}}, 'a' * 64, '2026-11-17T00:00:00Z', 'b' * 64)
        paris = payload['destinations']['Paris']
        self.assertEqual(paris['outbound']['path'], ['BOS', 'CDG'])
        self.assertEqual(paris['inbound']['flightMinutes'], 450)
        self.assertEqual(paris['nonstopOutbound']['path'], ['BOS', 'CDG'])
        self.assertEqual(paris['nonstopInbound']['path'], ['CDG', 'BOS'])
        self.assertEqual(payload['airports']['BOS']['lat'], 42.36)
        self.assertEqual(payload['airports']['BOS']['lon'], -71.01)
        self.assertIsNone(payload['destinations']['Dublin']['outbound'])
        self.assertEqual(list(payload['destinations']), ['Dublin', 'Paris'])
        self.assertIsNone(payload['source']['snapshotDate'])

    def test_bundled_boston_snapshot_reproduces_from_local_inputs(self):
        raw = routes.JSON_PATH.read_bytes()
        gateways = routes.GATEWAYS_PATH.read_bytes()
        bundled = json.loads(routes.BOSTON_PATH.read_text())
        actual = routes.boston_snapshot(json.loads(raw), routes.read_places(), json.loads(gateways), hashlib.sha256(raw).hexdigest(), bundled['generatedAt'], hashlib.sha256(gateways).hexdigest())
        self.assertEqual(actual, bundled)
