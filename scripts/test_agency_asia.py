"""QC, missingness, provenance and site-history safeguards for the Asia supplement."""
import calendar
import csv
import io
import unittest
import urllib.parse

from agency_asia import parse_jma, parse_kma_year, jma_request


class JmaTests(unittest.TestCase):
    def raw(self, rows, station='京都'):
        out = io.StringIO()
        csv.writer(out).writerows([
            ['ダウンロードした時刻：2026/11/17 08:23:14'], [], [''] + [station] * 10,
            ['年月日'] + ['最高気温(℃)'] * 3 + ['最低気温(℃)'] * 3 + ['降水量の合計(mm)'] * 4,
            [''] * 11,
            ['', '', '品質情報', '均質番号', '', '品質情報', '均質番号', '', '現象なし情報', '品質情報', '均質番号'],
            *rows])
        return out.getvalue().encode('cp932')

    def row(self, day='1991/1/1', qc='8', rain='0', absence='1', homogeneous='1'):
        return [day, '20.1', qc, homogeneous, '10.2', qc, homogeneous, rain, absence, qc, '1']

    def test_only_complete_quality8_is_accepted(self):
        rows = [self.row(f'1991/1/{i+1}', qc=qc) for i, qc in enumerate(('0', '1', '2', '4', '5', '8'))]
        result = parse_jma(self.raw(rows), 'Kyoto', complete=False)
        self.assertEqual(result['TMAX'], {(1991, 1, 6): (20.1, '8')})
        self.assertEqual(result['PRCP'], {(1991, 1, 6): (0.0, '8')})

    def test_no_rain_and_trace_are_both_below_wet_day_threshold_but_missing_is_not_dry(self):
        rows = [self.row(), self.row('1991/1/2', rain='0.0', absence='0'), self.row('1991/1/3', qc='1', rain='', absence='')]
        result = parse_jma(self.raw(rows), 'Kyoto', complete=False)
        self.assertEqual(len(result['PRCP']), 2)
        self.assertEqual(set(value for value, _ in result['PRCP'].values()), {0.0})
        for row in [self.row(rain='', qc='8'), self.row(rain='3', absence='1')]:
            with self.assertRaises(ValueError):
                parse_jma(self.raw([row]), 'Kyoto', complete=False)

    def test_tokyo_discontinuous_temperatures_never_enter_distribution(self):
        rows = [self.row('2014/12/1'), self.row('2014/12/2', homogeneous='2')]
        result = parse_jma(self.raw(rows, '東京'), 'Tokyo', complete=False)
        self.assertEqual(result['TMAX'], {})
        self.assertEqual(result['TMIN'], {})
        self.assertEqual(len(result['PRCP']), 2)
        with self.assertRaisesRegex(ValueError, 'homogeneity'):
            parse_jma(self.raw([self.row('2014/12/2')], '東京'), 'Tokyo', complete=False)

    def test_duplicate_impossible_dates_units_and_station_are_rejected(self):
        for raw in [self.raw([self.row(), self.row()]), self.raw([self.row('1991/2/29')]),
                    self.raw([self.row()], '東京'), self.raw([self.row()]).replace(b'(mm)', b'(in)')]:
            with self.assertRaises(ValueError):
                parse_jma(raw, 'Kyoto', complete=False)
        with self.assertRaisesRegex(ValueError, 'baseline calendar'):
            parse_jma(self.raw([self.row()]), 'Kyoto')

    def test_post_request_retains_all_export_parameters_without_authentication(self):
        request = jma_request('47759')
        self.assertEqual(request['method'], 'POST')
        params = urllib.parse.parse_qs(request['body'])
        self.assertEqual(params['stationNumList'], ['["s47759"]'])
        self.assertEqual(params['rmkFlag'], ['1'])
        self.assertEqual(params['disconnectFlag'], ['1'])
        self.assertEqual(params['ymdList'], ['["1991", "2020", "1", "12", "1", "31"]'])
        self.assertNotIn('auth', request['body'].lower())


class KmaTests(unittest.TestCase):
    def raw(self, value='20.3', year=1991, station='108', code='08', label='일최고기온(℃)'):
        header = ''.join(f'<th>{month}월</th>' for month in range(1, 13))
        rows = []
        for day in range(1, 32):
            cells = ''.join(f'<td><span>{value if day <= calendar.monthrange(year, month)[1] else "&nbsp;"}</span></td>' for month in range(1, 13))
            rows.append(f'<tr><td>{day}일</td>{cells}</tr>')
        selects = ''.join(f'<select id="select-{key}"><option selected="selected" value="{item}">x</option></select>'
                          for key, item in [('stn', station), ('yy', str(year)), ('obs', code)])
        return (selects + f'<p class="cmp-table-topinfo">[ {label} ] {year}년</p>'
                + f'<table id="weather_table"><tr><th>일자</th>{header}</tr>{"".join(rows)}'
                + '<tr><td>평균</td><td>9999</td></tr></table>').encode()

    def test_day_month_mapping_units_and_summary_row(self):
        result = parse_kma_year(self.raw(), 1991, 'TMAX')
        self.assertEqual(len(result['TMAX']), 365)
        self.assertEqual(result['TMAX'][(1991, 12, 31)], (20.3, 'agency-published'))
        self.assertNotIn((1991, 2, 29), result['TMAX'])

    def test_blank_rain_never_becomes_zero(self):
        result = parse_kma_year(self.raw(value='&nbsp;', code='21', label='일강수량(mm)'), 1991, 'PRCP')
        self.assertEqual(result['PRCP'], {})
        result = parse_kma_year(self.raw(value='0.0', code='21', label='일강수량(mm)'), 1991, 'PRCP')
        self.assertEqual(len(result['PRCP']), 365)

    def test_mismatched_station_year_element_or_units_fail(self):
        for raw in [self.raw(station='119'), self.raw(year=1992), self.raw(code='10'), self.raw(label='일최고기온(℉)')]:
            with self.assertRaises(ValueError):
                parse_kma_year(raw, 1991, 'TMAX')

    def test_invalid_numeric_markers_and_incomplete_rows_fail(self):
        for raw in [self.raw(value='nan'), self.raw(value='9999'), self.raw(value='20.3*'),
                    self.raw().replace(b'31\xec\x9d\xbc', b'30\xec\x9d\xbc')]:
            with self.assertRaises(ValueError):
                parse_kma_year(raw, 1991, 'TMAX')


if __name__ == '__main__':
    unittest.main()
