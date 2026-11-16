"""Regression tests for missingness, station identity and documented instrument faults."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('americas', pathlib.Path(__file__).with_name('agency_americas.py'))
americas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(americas)


class AmericasSourceTests(unittest.TestCase):
    def smn(self, rows):
        return ('REGISTRO DIARIO HISTÓRICO\n ESTACIÓN : 23155\n NOMBRE : CANCUN\n'
                ' LATITUD : 21.15666667 °\n LONGITUD : -86.82027778 °\n ALTITUD : 9 msnm\n'
                'FECHA\tPRECIP\tEVAP\tTMAX\tTMIN\n' + rows).encode()

    def test_smn_missing_rain_is_not_a_dry_day(self):
        values, meta = americas.parse_smn_mexico(self.smn(
            '1991-01-01\tNULO\tNULO\t30\t20\n1991-01-02\t0\tNULO\tNULO\tNULO\n'), '23155')
        self.assertNotIn((1991, 1, 1), values['PRCP'])
        self.assertEqual(values['PRCP'][(1991, 1, 2)][0], 0)
        self.assertNotIn((1991, 1, 2), values['TMAX'])
        self.assertEqual(meta['elevation'], 9)

    def test_smn_wrong_station_and_unknown_flags_fail_closed(self):
        raw = self.smn('1991-01-01\t0\tNULO\t30\t20\n')
        with self.assertRaises(ValueError):
            americas.parse_smn_mexico(raw, '09048')
        with self.assertRaises(ValueError):
            americas.parse_smn_mexico(self.smn('1991-01-01\tE\tNULO\t30\t20\n'), '23155')

    def test_smn_duplicate_or_invalid_observations_fail(self):
        row = '1991-01-01\t0\tNULO\t30\t20\n'
        for rows in (row + row, '1991-01-01\t-1\tNULO\t30\t20\n',
                     '1991-01-01\t0\tNULO\tnan\t20\n', '1991-02-29\t0\tNULO\t30\t20\n'):
            with self.assertRaises(ValueError):
                americas.parse_smn_mexico(self.smn(rows), '23155')

    def test_cdf_documented_bad_minima_excluded_without_losing_rain(self):
        raw = b'observation_date,min_air_temp,max_air_temp,precipitation\n2019-12-31,20,30,0\n2020-01-01,20,30,5\n2021-01-01,20,30,5\n'
        values = americas.parse_puerto_ayora(raw)
        self.assertIn((2019, 12, 31), values['TMIN'])
        self.assertNotIn((2020, 1, 1), values['TMIN'])
        self.assertEqual(values['PRCP'][(2020, 1, 1)][0], 5)
        self.assertNotIn((2021, 1, 1), values['TMAX'])

    def test_cdf_blanks_are_not_zero_and_duplicates_fail(self):
        header = b'observation_date,min_air_temp,max_air_temp,precipitation\n'
        row = b'1991-01-01,,30,\n'
        values = americas.parse_puerto_ayora(header + row)
        self.assertEqual(values['PRCP'], {})
        self.assertEqual(values['TMIN'], {})
        with self.assertRaises(ValueError):
            americas.parse_puerto_ayora(header + row + row)


if __name__ == '__main__':
    unittest.main()
