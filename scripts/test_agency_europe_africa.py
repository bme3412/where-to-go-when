"""Quality and history checks for the independently sourced CHMI supplement."""
import unittest

from agency_europe_africa import parse_chmi, parse_chmi_locations, parse_noa, PRAGUE_STATION


class ChmiTests(unittest.TestCase):
    def raw(self, rows):
        return ('STATION,ELEMENT,TIMEFUNC,DT,VALUE,FLAG,QUALITY,\n' + '\n'.join(rows)).encode()

    def row(self, date, value='20', quality='0.0', element='TMA', flag='', station=PRAGUE_STATION):
        schedule = '06:00' if element == 'SRA' else '20:00'
        return f'{station},{element},{schedule},{date}T{schedule}Z,{value},{flag},{quality},'

    def test_estimated_and_other_non_good_values_cannot_enter_baseline(self):
        rows = [self.row(f'1991-01-0{i+1}', quality=str(i)+'.0') for i in range(6)]
        element, values = parse_chmi(self.raw(rows), 'TMA')
        self.assertEqual(element, 'TMAX')
        self.assertEqual(values, {(1991, 1, 1): (20.0, '0')})

    def test_trace_and_manual_rain_need_good_quality(self):
        rows = [self.row('1991-01-01', '0', element='SRA', flag='T'),
                self.row('1991-01-02', '2.1', element='SRA', flag='M'),
                self.row('1991-01-03', '0', quality='3.0', element='SRA', flag='T')]
        _, values = parse_chmi(self.raw(rows), 'SRA')
        self.assertEqual(values, {(1991, 1, 1): (0.0, '0'), (1991, 1, 2): (2.1, '0')})

    def test_duplicates_even_if_first_value_is_estimated_are_rejected(self):
        rows = [self.row('1991-01-01', quality='3.0'), self.row('1991-01-01')]
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            parse_chmi(self.raw(rows), 'TMA')

    def test_mismatched_station_or_element_is_rejected(self):
        for row in [self.row('1991-01-01', station='other'), self.row('1991-01-01', element='TMI')]:
            with self.assertRaisesRegex(ValueError, 'Mismatched'):
                parse_chmi(self.raw([row]), 'TMA')

    def test_invalid_values_and_dates_are_rejected(self):
        for row in [self.row('1991-02-29'), self.row('1991-01-01', value='nan'),
                    self.row('1991-01-01', value='-1', element='SRA')]:
            with self.assertRaises(ValueError):
                parse_chmi(self.raw([row]), 'SRA' if ',SRA,' in row else 'TMA')

    def test_location_periods_are_preserved_and_must_cover_baseline(self):
        header = 'WSI,GH_ID,BEGIN_DATE,END_DATE,FULL_NAME,GEOGR1,GEOGR2,ELEVATION,\n'
        one = f'{PRAGUE_STATION},P1PKAR01,1920-01-01T00:00Z,2002-12-31T23:59Z,Praha  Karlov,14.4186,50.0675,260.5,\n'
        two = f'{PRAGUE_STATION},P1PKAR01,2003-01-01T00:00Z,2024-08-31T23:59Z,Praha  Karlov,14.427778,50.069167,260.5,\n'
        members = parse_chmi_locations((header + one + two).encode())
        self.assertEqual(len(members), 2)
        self.assertEqual(members[0]['start'], '1991-01-01')
        self.assertEqual(members[-1]['end'], '2020-12-31')
        self.assertEqual(members[0]['lat'], 50.0675)
        with self.assertRaisesRegex(ValueError, 'Incomplete'):
            parse_chmi_locations((header + one).encode())
        with self.assertRaisesRegex(ValueError, 'Gap or overlap'):
            parse_chmi_locations((header + one + two.replace('2003-01-01', '2003-01-02')).encode())


class NoaTests(unittest.TestCase):
    def raw(self, rows):
        return ('\ufeffDATE,T (oC),Tmax (oC),Tmin (oC),RH (%),Precipitation (mm)\n' + '\n'.join(rows)).encode()

    def test_day_month_order_units_and_missing_values(self):
        values = parse_noa(self.raw(['02-01-1991,10,14.3,5.9,67,0.2',
                                   '03-01-1991,10,,6,67,']))
        self.assertEqual(values['TMAX'], {(1991, 1, 2): (14.3, 'P')})
        self.assertEqual(values['PRCP'], {(1991, 1, 2): (0.2, 'P')})
        self.assertEqual(len(values['TMIN']), 2)

    def test_duplicate_invalid_date_and_invalid_values_rejected(self):
        for rows in [['01-01-1991,10,14,6,67,0'] * 2,
                     ['29-02-1991,10,14,6,67,0'],
                     ['01-01-1991,10,14,6,67,-9999'],
                     ['01-01-1991,10,nan,6,67,0']]:
            with self.assertRaises(ValueError):
                parse_noa(self.raw(rows))

    def test_schema_or_units_changes_rejected(self):
        with self.assertRaisesRegex(ValueError, 'schema or units'):
            parse_noa(self.raw([]).replace(b'Precipitation (mm)', b'Precipitation (in)'))


if __name__ == '__main__':
    unittest.main()
