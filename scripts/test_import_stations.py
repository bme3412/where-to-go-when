"""Data-quality regression tests: python3 -m unittest discover -s scripts."""
import calendar
import gzip
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('stations', pathlib.Path(__file__).with_name('import-stations.py'))
stations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stations)


class StationQualityTests(unittest.TestCase):
    def test_grid_calendar_rejects_invalid_dates_and_mismatched_factor_keys(self):
        values = {parameter: dict.fromkeys(stations.grid.BASELINE_DATES, 1) for parameter in stations.grid.PARAMETERS}
        stations.grid.validate_calendar(values)
        values['PRECTOTCORR']['19910132'] = values['PRECTOTCORR'].pop('19910102')
        with self.assertRaises(AssertionError):
            stations.grid.validate_calendar(values)

    def test_grid_comparison_checks_complete_daily_factors_independently(self):
        first = {'T2M_MAX': {'19910101': 25, '19910102': 30},
                 'T2M_MIN': {'19910101': 18, '19910102': 20},
                 'PRECTOTCORR': {'19910101': 0, '19910102': 2}}
        reordered = {key: dict(reversed(list(values.items()))) for key, values in first.items()}
        self.assertEqual(stations.grid.series_fingerprints(first), stations.grid.series_fingerprints(reordered))
        swapped_rain = {**first, 'PRECTOTCORR': {'19910101': 2, '19910102': 0}}
        before, after = stations.grid.series_fingerprints(first), stations.grid.series_fingerprints(swapped_rain)
        self.assertEqual(before['temperature'], after['temperature'])
        self.assertNotEqual(before['precipitation'], after['precipitation'])

    def cell(self, value, measurement=' ', quality=' ', source='0'):
        return f'{value:5d}{measurement}{quality}{source}'

    def test_missing_or_failed_values_are_not_observations(self):
        for element in ('TMAX', 'TMIN', 'PRCP'):
            self.assertIsNone(stations.observation(element, self.cell(-9999)))
            self.assertIsNone(stations.observation(element, self.cell(10, quality='X')))

    def test_missing_and_partial_rain_is_never_zero(self):
        for flag in ('A', 'C', 'E', 'H', 'I', 'P'):
            self.assertIsNone(stations.observation('PRCP', self.cell(0, measurement=flag)))
        for source in ('S', '2'):
            self.assertIsNone(stations.observation('PRCP', self.cell(0, source=source)))
        self.assertEqual(stations.observation('PRCP', self.cell(0, measurement='T')), (0, '0'))
        self.assertEqual(stations.observation('PRCP', self.cell(10)), (1, '0'))

    def test_hourly_temperature_extrema_are_excluded(self):
        self.assertIsNone(stations.observation('TMAX', self.cell(250, measurement='H')))
        self.assertEqual(stations.observation('TMIN', self.cell(-35)), (-3.5, '0'))

    def test_proximity_does_not_override_elevation(self):
        place = dict(lat=46.69, lon=7.86, elevation=580)
        self.assertFalse(stations.eligible(place, dict(lat=46.69, lon=7.86, elevation=1800)))
        self.assertFalse(stations.eligible(place, dict(lat=47.69, lon=7.86, elevation=580)))
        self.assertFalse(stations.eligible(place, dict(lat=46.69, lon=7.86, elevation=-999.9)))
        self.assertTrue(stations.eligible(place, dict(lat=46.69, lon=7.87, elevation=578)))

    def make_values(self, start=1991, end=2020, missing_day=None):
        values = {k: {} for k in ('TMAX', 'TMIN', 'PRCP')}
        for year in range(start, end + 1):
            for month in range(1, 13):
                for day in range(1, calendar.monthrange(year, month)[1] + 1):
                    key = (year, month, day)
                    values['TMAX'][key] = (20, '0')
                    values['TMIN'][key] = (10, '0')
                    if day != missing_day:
                        values['PRCP'][key] = (2, '0')
        return values

    def test_rain_missingness_keeps_its_own_denominator(self):
        values = self.make_values(missing_day=1)
        temperature, _, _ = stations.summarize(values, 'temperature')
        precipitation, _, _ = stations.summarize(values, 'precipitation')
        self.assertEqual(temperature[0]['temperatureDays'], 930)
        self.assertEqual(precipitation[0]['precipitationDays'], 900)
        self.assertEqual(precipitation[0]['wetDays'], 900)
        self.assertEqual(precipitation[0]['monthlyPrecip'], 62)

    def test_short_or_seasonally_incomplete_series_rejected(self):
        self.assertIsNone(stations.summarize(self.make_values(2001, 2020), 'temperature')[0])
        values = self.make_values()
        values['PRCP'] = {k: v for k, v in values['PRCP'].items() if k[1] != 7}
        self.assertIsNone(stations.summarize(values, 'precipitation')[0])

    def test_baseline_and_flag_parser(self):
        line = 'TEST0000001' + '199102' + 'PRCP' + ''.join(self.cell(10) if d < 28 else self.cell(-9999) for d in range(31))
        data = stations.parse_daily((line + '\n').encode(), 'TEST0000001')
        self.assertEqual(len(data['PRCP']), 28)
        self.assertEqual(data['PRCP'][(1991, 2, 28)][0], 1)
        with self.assertRaises(ValueError):
            stations.parse_daily(line.encode(), 'WRONG000001')

    def test_swiss_empty_rain_does_not_become_zero(self):
        raw = b'station_abbr;reference_timestamp;tre200dx;tre200dn;rre150d0\nINT;01.01.1991 00:00;4.2;-1.1;\nINT;02.01.1991 00:00;5.1;0.2;0\n'
        values = stations.parse_swiss(raw, 'INT')
        self.assertEqual(len(values['TMAX']), 2)
        self.assertEqual(len(values['PRCP']), 1)
        self.assertNotIn((1991, 1, 1), values['PRCP'])
        self.assertEqual(values['PRCP'][(1991, 1, 2)][0], 0)
        with self.assertRaises(AssertionError):
            stations.parse_swiss(raw, 'BER')

    def test_france_rejects_doubtful_filtered_and_missing_values(self):
        text = 'NUM_POSTE;NOM_USUEL;LAT;LON;ALTI;AAAAMMJJ;TX;QTX;TN;QTN;RR;QRR\n'
        text += '123;Station;48;2;50;19910101;20;1;10;0;0;1\n'
        text += '123;Station;48;2;50;19910102;20;9;10;2;50;2\n'
        text += '123;Station;48;2;50;19910103;20;1;10;1;;1\n'
        values, metadata = stations.agencies.parse_france(gzip.compress(text.encode()), '123')
        self.assertEqual(metadata['elevation'], 50)
        self.assertNotIn((1991, 1, 2), values['TMAX'])
        self.assertNotIn((1991, 1, 2), values['TMIN'])
        self.assertEqual(values['PRCP'], {(1991, 1, 1): (0, '1')})

    def test_hko_complete_trace_and_zero_are_distinct_from_missing(self):
        raw = b'title\ntitle\nYear,Month,Day,Value,Completeness\n1991,1,1,Trace,C\n1991,1,2,5,#\n1991,1,3,***,C\n1991,1,4,0,C\n'
        values = stations.agencies.parse_hko(raw, 'PRCP')
        self.assertEqual(set(values), {(1991, 1, 1), (1991, 1, 4)})
        self.assertEqual(values[(1991, 1, 1)][0], 0)

    def test_canada_estimates_and_dates_outside_station_succession_are_excluded(self):
        rows = []
        for date, flag, rain in [('1995-03-31', None, 3), ('1995-04-01', 'E', 3), ('1995-04-02', None, None), ('1995-04-03', None, 0)]:
            rows.append(dict(properties=dict(CLIMATE_IDENTIFIER='3050519', LOCAL_DATE=date,
                MAX_TEMPERATURE=10, MAX_TEMPERATURE_FLAG=flag, MIN_TEMPERATURE=0, MIN_TEMPERATURE_FLAG=flag,
                TOTAL_PRECIPITATION=rain, TOTAL_PRECIPITATION_FLAG=flag)))
        values = stations.agencies.parse_canada([{'features': rows}], '3050519', '1995-04-01', '2020-12-31')
        self.assertEqual(len(values['TMAX']), 2)
        self.assertEqual(values['PRCP'], {(1995, 4, 3): (0, 'observed')})
        with self.assertRaises(ValueError):
            stations.agencies.parse_canada([{'features': rows}, {'features': rows}], '3050519', '1995-04-01', '2020-12-31')

    def test_singapore_both_encodings_and_missing_rain(self):
        text = 'Station,Year,Month,Day,Maximum Temperature (°C),Minimum Temperature (°C),Daily Rainfall Total (mm)\nPaya Lebar,1991,1,1,30,24,—\nPaya Lebar,1991,1,2,31,-,0\n'
        for raw in (text.encode('cp1252'), text.encode('utf-8-sig')):
            values = stations.agencies.parse_singapore(raw, 1991, 1)
            self.assertEqual(len(values['TMAX']), 2)
            self.assertEqual(len(values['TMIN']), 1)
            self.assertEqual(values['PRCP'], {(1991, 1, 2): (0, 'agency-published')})
        with self.assertRaises(ValueError):
            stations.agencies.parse_singapore(text.encode('cp1252'), 1991, 2)


if __name__ == '__main__':
    unittest.main()
