"""Reviewed JMA and KMA daily observations; no undocumented gap filling or site pooling."""
import calendar
import csv
import datetime as dt
import hashlib
from html.parser import HTMLParser
import io
import json
import math
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / '.climate-cache/agency-research/asia-next'
JMA_URL = 'https://www.data.jma.go.jp/risk/obsdl/show/table'
JMA_PAGE = 'https://www.data.jma.go.jp/risk/obsdl/'
JMA_HELP = 'https://www.data.jma.go.jp/risk/obsdl/top/help3.html'
TOKYO_MOVE = 'https://www.jma.go.jp/jma/kishou/books/sokkou/83/vol83p001.pdf'
TOKYO_REJECTION = ('JMA temperature homogeneity changes on 2014-12-02 when observations move from Otemachi to '
                   'Kitanomaru Park. JMA says different homogeneity segments are not directly comparable; no daily '
                   'adjustment is supplied, and neither segment alone passes the 1991–2020 coverage policy. '
                   'Temperature remains on the regional grid; precipitation stays in one agency homogeneity segment.')
SEOUL_RAIN_REJECTION = ('The public KMA precipitation table contains blank cells without a verified dry-day code. '
                        'Blanks are not converted to zero. A complete, quality-documented 1991–2020 precipitation '
                        'series was not verified; precipitation remains on the regional grid.')


def empty_values():
    return {field: {} for field in ('TMAX', 'TMIN', 'PRCP')}


def add_value(values, element, date, value, flag):
    dt.date(*date)
    if not 1991 <= date[0] <= 2020:
        raise ValueError('Unexpected agency baseline date')
    if not math.isfinite(value) or not (value >= 0 if element == 'PRCP' else -100 <= value <= 65):
        raise ValueError('Invalid agency observation')
    if date in values[element]:
        raise ValueError('Duplicate agency observation')
    values[element][date] = (value, flag)


def jma_request(station_id):
    params = dict(stationNumList=json.dumps(['s' + station_id]), aggrgPeriod='1',
                  elementNumList=json.dumps([['202', ''], ['203', ''], ['101', '']]), interAnnualType='1',
                  ymdList=json.dumps(['1991', '2020', '1', '12', '1', '31']),
                  option=json.dumps(dict(list=['obs'], nyear=0)), downloadFlag='true', rmkFlag='1',
                  disconnectFlag='1', youbiFlag='0', fukenFlag='0', kijiFlag='0', csvFlag='1',
                  jikantaiFlag='0', jikantaiList='[]', ymdLiteral='1')
    return dict(method='POST', contentType='application/x-www-form-urlencoded', body=urllib.parse.urlencode(params))


def parse_jma(raw, station_name, complete=True):
    """Accept complete QC8 only. Check reviewed homogeneity, but do not combine Tokyo temperatures."""
    names = {'Tokyo': '東京', 'Kyoto': '京都'}
    if station_name not in names:
        raise ValueError('Unreviewed JMA station')
    rows = list(csv.reader(io.StringIO(raw.decode('cp932'))))
    expected_fields = ['年月日'] + ['最高気温(℃)'] * 3 + ['最低気温(℃)'] * 3 + ['降水量の合計(mm)'] * 4
    expected_flags = ['', '', '品質情報', '均質番号', '', '品質情報', '均質番号', '', '現象なし情報', '品質情報', '均質番号']
    if len(rows) < 7 or rows[2] != [''] + [names[station_name]] * 10 or rows[3] != expected_fields or rows[5] != expected_flags:
        raise ValueError('Mismatched JMA station, schema or units')
    values, seen = empty_values(), set()
    for row in rows[6:]:
        if len(row) != 11 or not re.fullmatch(r'\d{4}/\d{1,2}/\d{1,2}', row[0]):
            raise ValueError('Malformed JMA row')
        date = tuple(map(int, row[0].split('/')))
        day = dt.date(*date)
        if not 1991 <= day.year <= 2020:
            raise ValueError('Unexpected JMA baseline date')
        if date in seen:
            raise ValueError('Duplicate JMA day')
        seen.add(date)
        for element, vi, qi, hi in [('TMAX', 1, 2, 3), ('TMIN', 4, 5, 6), ('PRCP', 7, 9, 10)]:
            if row[qi] not in ('0', '1', '2', '4', '5', '8'):
                raise ValueError('Unknown JMA quality code')
            expected_homogeneity = '2' if station_name == 'Tokyo' and element != 'PRCP' and day >= dt.date(2014, 12, 2) else '1'
            if row[hi] != expected_homogeneity:
                raise ValueError('Unreviewed JMA homogeneity change')
            if row[qi] != '8':
                continue
            reading = row[vi].strip()
            if not reading:
                raise ValueError('Missing value with JMA complete quality code')
            value = float(reading)
            if element == 'PRCP':
                if row[8] not in ('0', '1') or (row[8] == '1' and value != 0):
                    raise ValueError('Invalid JMA no-phenomenon flag')
            # A temperature discontinuity is not made comparable merely by documenting the move.
            if station_name == 'Tokyo' and element != 'PRCP':
                continue
            add_value(values, element, date, value, '8')
    if complete:
        first, last = dt.date(1991, 1, 1), dt.date(2020, 12, 31)
        expected = {(d.year, d.month, d.day) for d in (first + dt.timedelta(days=i) for i in range((last-first).days + 1))}
        if seen != expected:
            raise ValueError('Incomplete JMA baseline calendar')
    return values


class KmaTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.select = None
        self.selected = {}
        self.in_table = False
        self.rows = []
        self.row = None
        self.cell = None
        self.in_title = False
        self.title = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'select':
            self.select = attrs.get('id')
        if tag == 'option' and 'selected' in attrs and self.select in ('select-stn', 'select-yy', 'select-obs'):
            if self.select in self.selected:
                raise ValueError('Duplicate KMA selection')
            self.selected[self.select] = attrs.get('value')
        if tag == 'p' and 'cmp-table-topinfo' in attrs.get('class', '').split():
            self.in_title = True
        if tag == 'table' and attrs.get('id') == 'weather_table':
            if self.rows or self.in_table:
                raise ValueError('Duplicate KMA weather table')
            self.in_table = True
        if self.in_table and tag == 'tr':
            self.row = []
        if self.in_table and tag in ('th', 'td'):
            self.cell = []

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == 'select':
            self.select = None
        if tag == 'p':
            self.in_title = False
        if self.in_table and tag in ('th', 'td') and self.cell is not None:
            self.row.append(''.join(self.cell).strip())
            self.cell = None
        if self.in_table and tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None
        if tag == 'table':
            self.in_table = False


def parse_kma_year(raw, year, element):
    params = {'TMAX': ('08', '일최고기온(℃)'), 'TMIN': ('10', '일최저기온(℃)'), 'PRCP': ('21', '일강수량(mm)')}
    code, label = params[element]
    parser = KmaTable()
    parser.feed(raw.decode('utf-8-sig'))
    if parser.selected != {'select-stn': '108', 'select-yy': str(year), 'select-obs': code}:
        raise ValueError('Mismatched KMA station, year or element')
    if re.sub(r'\s+', '', ''.join(parser.title)) != f'[{label}]{year}년':
        raise ValueError('Mismatched KMA title or units')
    if not parser.rows or parser.rows[0] != ['일자'] + [f'{month}월' for month in range(1, 13)]:
        raise ValueError('Mismatched KMA month columns')
    values, seen = empty_values(), set()
    for row in parser.rows[1:]:
        if not row or not re.fullmatch(r'\d{1,2}일', row[0]):
            continue  # The annual table ends with a monthly average/total row.
        day = int(row[0][:-1])
        if not 1 <= day <= 31 or day in seen or len(row) != 13:
            raise ValueError('Duplicate or malformed KMA day row')
        seen.add(day)
        for month, reading in enumerate(row[1:], 1):
            if day > calendar.monthrange(year, month)[1]:
                if reading:
                    raise ValueError('KMA value on impossible date')
                continue
            if not reading:
                continue  # Never presume an absent precipitation cell is a dry day.
            if not re.fullmatch(r'-?\d+(?:\.\d+)?', reading):
                raise ValueError('Unknown KMA observation marker')
            add_value(values, element, (year, month, day), float(reading), 'agency-published')
    if seen != set(range(1, 32)):
        raise ValueError('Incomplete KMA day rows')
    return values


def read_public(url, filename, label, request=None):
    path = CACHE / filename
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        headers = {'User-Agent': 'VacationClimateBaseline/2.0'}
        body = None
        if request:
            headers['Content-Type'] = request['contentType']
            body = request['body'].encode()
        with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=120) as response:
            raw = response.read()
        if not raw:
            raise ValueError('Empty agency response')
        path.write_bytes(raw)
        time.sleep(.5)
    raw = path.read_bytes()
    source = dict(url=url, label=label, retrieved=dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).isoformat(),
                  sha256=hashlib.sha256(raw).hexdigest())
    if request:
        source.update(request=request, sourcePage=JMA_PAGE)
    return raw, source


def supplement(place, result, found, audit, ctx):
    name = place['name']
    if name in ('Tokyo', 'Kyoto'):
        station_id = '47662' if name == 'Tokyo' else '47759'
        raw, source = read_public(JMA_URL, f'jma-{name.lower()}-1991-2020.csv',
                                  f'JMA {name} daily export · 1991–2020', jma_request(station_id))
        values = parse_jma(raw, name)
        metadata = dict(stationId=station_id, stationName=name, provider='Japan Meteorological Agency',
            version='Agency daily export; 1991–2020; complete QC8 only', sourcePage=JMA_PAGE,
            qualityEvidenceUrl=JMA_HELP, licenseUrl='https://www.jma.go.jp/jma/kishou/info/coment.html',
            attribution='Derived from Japan Meteorological Agency historical observations. Quality filtering and climate summaries computed by this app; not an official JMA product.',
            qualityNote='Only normal, complete quality code 8; quasi-normal, insufficient, doubtful and missing records excluded. '
                        'Daily totals and extrema use the 24:00 JST boundary. A recorded absence is zero; 0.0 mm with a phenomenon is a trace below 0.5 mm, below the 1 mm wet-day threshold. '
                        'Trace volume is treated as zero; no missing days are filled.')
        if name == 'Tokyo':
            members = [dict(stationId='47662', stationName='Tokyo · Otemachi', lat=35.69, lon=139.76, elevation=6,
                            start='1991-01-01', end='2014-12-01'),
                       dict(stationId='47662', stationName='Tokyo · Kitanomaru Park', lat=35.69166666666667, lon=139.75, elevation=25,
                            start='2014-12-02', end='2020-12-31')]
            metadata.update(lat=members[-1]['lat'], lon=members[-1]['lon'], elevation=members[-1]['elevation'],
                            stationMembers=members, lineageUrl=TOKYO_MOVE, metadataUrl=TOKYO_MOVE,
                            qualityNote=metadata['qualityNote'] + '\n' + TOKYO_REJECTION)
        else:
            metadata.update(lat=35.01333333333333, lon=135.73166666666665, elevation=40.8,
                            lineageUrl='https://www.data.jma.go.jp/kyoto/7_about_us/history/index.html',
                            metadataUrl='https://www.data.jma.go.jp/kyoto/7_about_us/history/index.html',
                            qualityNote=metadata['qualityNote'] + '\nAll three variables retain one agency homogeneity segment across the baseline. '
                                        'Kyoto observations have been at the Nishinokyo site since 1913; the 2014 operations-office move did not move the observation site.')
        ctx.agencies.accept_candidate(place, result, found, audit, values, metadata,
                                      {v: [source] for v in ('temperature', 'precipitation')}, ctx)
        if name == 'Tokyo' and 'temperature' in audit[-1]['variables']:
            audit[-1]['variables']['temperature']['reason'] = TOKYO_REJECTION
    if name == 'Seoul':
        values, inputs = empty_values(), []
        for year in range(1991, 2021):
            for element, code in [('TMAX', '08'), ('TMIN', '10')]:
                url = f'https://www.weather.go.kr/w/weather/land/past-obs/obs-by-element.do?stn=108&yy={year}&obs={code}'
                raw, source = read_public(url, f'kma-108-{year}-{code}.html', f'Seoul {element} · {year}')
                parsed = parse_kma_year(raw, year, element)
                if set(values[element]) & set(parsed[element]):
                    raise ValueError('Overlapping KMA annual tables')
                values[element].update(parsed[element]); inputs.append(source)
        metadata = dict(stationId='108', stationName='Seoul · Songwol-dong', provider='Korea Meteorological Administration',
            lat=37.57142, lon=126.9658, elevation=85.67, version='Public daily temperature tables; 60 annual files',
            metadataUrl='https://minwon.kma.go.kr/main/obvStn.do',
            lineageUrl='https://www.kma.go.kr/metropolitan/html/info/business06.jsp',
            licenseUrl='https://www.data.go.kr/data/15059093/openapi.do',
            attribution='Data provided by the Korea Meteorological Administration (기상청 제공). Climate summaries computed by this app from public daily temperature tables; not an official KMA product.',
            qualityNote='Agency-published daily maximum and minimum temperatures; these public tables supply no per-record quality codes. '
                        'KMA labels the historical public tables as reference material, not official certification. Blank cells are excluded. '
                        'Observations remained at Songwol-dong when the agency headquarters moved in 1998. '
                        'No precipitation observations are imported from these temperature tables. '
                        'The underlying daily ASOS product is published under KOGL Type 1 attribution terms; observations were retrieved from its public annual presentation tables, not the API.')
        ctx.agencies.accept_candidate(place, result, found, audit, values, metadata,
                                      dict(temperature=inputs, precipitation=[]), ctx)
        if 'precipitation' in audit[-1]['variables']:
            audit[-1]['variables']['precipitation']['reason'] = SEOUL_RAIN_REJECTION
