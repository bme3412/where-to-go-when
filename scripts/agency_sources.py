"""National-agency supplements. Keep observation flags, lineage and file hashes explicit."""
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import math
import pathlib
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIELDS = ('TMAX', 'TMIN', 'PRCP')


def empty_values():
    return {field: {} for field in FIELDS}


def add_value(values, element, date, value, flag):
    if not 1991 <= date[0] <= 2020:
        return
    dt.date(*date)  # Reject impossible calendar dates, including malformed leap days.
    if not math.isfinite(value) or not (value >= 0 if element == 'PRCP' else -100 <= value <= 65):
        raise ValueError('Invalid agency observation')
    if date in values[element]:
        raise ValueError('Duplicate agency observation')
    values[element][date] = (value, flag)


def read_source(ctx, url, name, label):
    raw, retrieved = ctx.cached(url, '../agency-research/' + name)
    return raw, dict(url=url, label=label, retrieved=retrieved, sha256=hashlib.sha256(raw).hexdigest())


def parse_france(raw, station_id):
    values, metadata = empty_values(), None
    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as compressed:
        for row in csv.DictReader(io.TextIOWrapper(compressed, encoding='utf-8-sig'), delimiter=';'):
            if row['NUM_POSTE'] != station_id or not '19910101' <= row['AAAAMMJJ'] <= '20201231':
                continue
            current = dict(lat=float(row['LAT']), lon=float(row['LON']), elevation=float(row['ALTI']))
            if metadata and current != {k: metadata[k] for k in current}:
                raise ValueError('Station location changed; review its history before combining')
            metadata = dict(**current, stationId=station_id, stationName=row['NOM_USUEL'])
            stamp = row['AAAAMMJJ']
            date = (int(stamp[:4]), int(stamp[4:6]), int(stamp[6:8]))
            for element, field in [('TMAX', 'TX'), ('TMIN', 'TN'), ('PRCP', 'RR')]:
                # 0 protected/final, 1 validated; exclude 2 doubtful and 9 first-level filtered.
                if row[field].strip() and row['Q' + field] in ('0', '1'):
                    add_value(values, element, date, float(row[field]), row['Q' + field])
    if metadata is None:
        raise ValueError('Requested Météo-France station missing from file')
    return values, metadata


def parse_hko(raw, element):
    values = empty_values()
    rows = csv.reader(io.StringIO(raw.decode('utf-8-sig')))
    for row in rows:
        if len(row) < 5 or not row[0].strip().isdigit():
            continue
        date = tuple(int(cell) for cell in row[:3])
        if row[4].strip() != 'C' or row[3].strip() in ('', '***'):
            continue
        reading = row[3].strip()
        if reading == 'Trace':
            if element != 'PRCP':
                raise ValueError('Unexpected trace temperature')
            value = 0.0  # HKO trace <0.05 mm; below the 1 mm wet-day threshold.
        else:
            value = float(reading)
        add_value(values, element, date, value, 'C')
    return values[element]


def parse_canada(pages, station_id, start, end):
    values = empty_values()
    for page in pages:
        for feature in page['features']:
            row = feature['properties']
            if str(row['CLIMATE_IDENTIFIER']) != station_id:
                raise ValueError('Mismatched ECCC station')
            stamp = row['LOCAL_DATE'][:10]
            if not start <= stamp <= end:
                continue
            date = tuple(int(part) for part in stamp.split('-'))
            for element, field in [('TMAX', 'MAX_TEMPERATURE'), ('TMIN', 'MIN_TEMPERATURE'), ('PRCP', 'TOTAL_PRECIPITATION')]:
                value, flag = row[field], row[field + '_FLAG']
                if value is None or flag not in ((None, '', 'T') if element == 'PRCP' else (None, '')):
                    continue
                add_value(values, element, date, 0.0 if flag == 'T' else float(value), flag or 'observed')
    return values


def parse_singapore(raw, year, month):
    text = raw.decode('utf-8-sig' if raw.startswith(b'\xef\xbb\xbf') else 'cp1252')
    values = empty_values()
    for row in csv.DictReader(io.StringIO(text)):
        if row['Station'].strip() != 'Paya Lebar':
            raise ValueError('Mismatched Singapore station')
        date = tuple(int(row[field]) for field in ('Year', 'Month', 'Day'))
        if date[:2] != (year, month):
            raise ValueError('Mismatched Singapore month')
        for element, field in [('TMAX', 'Maximum Temperature (°C)'), ('TMIN', 'Minimum Temperature (°C)'), ('PRCP', 'Daily Rainfall Total (mm)')]:
            reading = row[field].strip()
            if reading in ('', '—', '-'):
                continue
            add_value(values, element, date, float(reading), 'agency-published')
    return values


def accept_candidate(place, result, found, audit, values, metadata, inputs, ctx):
    members = metadata.get('stationMembers', [metadata])
    if not all(ctx.eligible(place, member) for member in members):
        raise ValueError('Agency station fails the distance/elevation policy')
    record = dict(stationId=metadata['stationId'], provider=metadata['provider'], variables={})
    for variable in ('temperature', 'precipitation'):
        if variable in found:
            continue
        months, coverage, flags = ctx.summarize(values, variable)
        record['variables'][variable] = dict(accepted=months is not None, coverage=coverage)
        if months is None:
            continue
        files = inputs[variable]
        digest = files[0]['sha256'] if len(files) == 1 else hashlib.sha256(json.dumps(
            [{k: item[k] for k in ('url', 'sha256')} for item in files], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        found[variable] = dict(metadata, kind='station', coverage=coverage,
            distanceKm=round(max(ctx.distance(place, member) for member in members), 2),
            elevationDifferenceM=round(metadata['elevation'] - place['elevation'], 1),
            sourceUrl=files[0]['url'], retrieved=max(item['retrieved'] for item in files),
            sha256=digest, hashScope='raw file' if len(files) == 1 else 'input manifest',
            rawInputs=files, sourceFlags=metadata.get('qualityNote', 'Provider observations').split('\n'))
        for current, replacement in zip(result['months'], months):
            current.update(replacement)
    audit.append(record)


def supplement(place, result, found, audit, ctx):
    name = place['name']
    if name in ('Paris', 'Tahiti'):
        department, station_id = ('75', '75114001') if name == 'Paris' else ('987', '98715002')
        filename = f'Q_{department}_previous-1950-2024_RR-T-Vent.csv.gz'
        url = 'https://meteofrance.s3.sbg.io.cloud.ovh.net/data/synchro_ftp/BASE/QUOT/' + filename
        raw, source = read_source(ctx, url, filename, 'Météo-France daily archive')
        values, metadata = parse_france(raw, station_id)
        metadata.update(provider='Météo-France', version='Daily climate archive 1950–2024',
            metadataUrl='https://www.data.gouv.fr/datasets/donnees-climatologiques-de-base-quotidiennes',
            qualityNote='Only validated quality flags 0 and 1; doubtful, filtered-only and missing values excluded.')
        accept_candidate(place, result, found, audit, values, metadata, {v: [source] for v in ('temperature', 'precipitation')}, ctx)
    if name == 'Hong Kong':
        values, files = empty_values(), {}
        for element, data_type in [('TMAX', 'CLMMAXT'), ('TMIN', 'CLMMINT'), ('PRCP', 'rainfall')]:
            url = ('https://data.weather.gov.hk/weatherAPI/cis/csvfile/HKO/ALL/daily_HKO_RF_ALL.csv' if element == 'PRCP' else
                   f'https://data.weather.gov.hk/weatherAPI/opendata/opendata.php?dataType={data_type}&rformat=csv&station=HKO')
            raw, files[element] = read_source(ctx, url, f'hko/{data_type}.csv', element)
            values[element] = parse_hko(raw, element)
        metadata = dict(stationId='HKO', stationName='Hong Kong Observatory Headquarters', provider='Hong Kong Observatory',
            lat=22.3, lon=114.16666666666667, elevation=32, version='Published daily climate observations',
            metadataUrl='https://www.hko.gov.hk/en/publica/tn/files/tn107.pdf',
            qualityNote='Only completeness C; incomplete and missing values excluded. Trace <0.05 mm counts below the wet-day threshold.')
        accept_candidate(place, result, found, audit, values, metadata,
            dict(temperature=[files['TMAX'], files['TMIN']], precipitation=[files['PRCP']]), ctx)
    if name == 'Banff':
        values, files = empty_values(), []
        members = [dict(stationId='3050520', stationName='BANFF', lat=51.18333333333333, lon=-115.56666666666666,
                        elevation=1383.7, start='1991-01-01', end='1995-03-31'),
                   dict(stationId='3050519', stationName='BANFF CS', lat=51.193358333333336, lon=-115.55223611111111,
                        elevation=1396.9, start='1995-04-01', end='2020-12-31')]
        for member in members:
            query = urllib.parse.urlencode(dict(f='json', CLIMATE_IDENTIFIER=member['stationId'],
                datetime='1991-01-01T00:00:00Z/2020-12-31T23:59:59Z', limit=10000, sortby='LOCAL_DATE'))
            url, pages, number = 'https://api.weather.gc.ca/collections/climate-daily/items?' + query, [], 1
            while url:
                suffix = '' if number == 1 else f'-page{number}'
                raw, source = read_source(ctx, url, f'mountain/canada-{member["stationId"]}{suffix}.json', member['stationName'])
                page = json.loads(raw); pages.append(page); files.append(source)
                url = next((link['href'] for link in page.get('links', []) if link['rel'] == 'next'), None)
                if url and not url.startswith('https://api.weather.gc.ca/'):
                    raise ValueError('Unexpected ECCC pagination origin')
                number += 1
                if number > 10:
                    raise ValueError('Unexpected ECCC page count')
            parsed = parse_canada(pages, member['stationId'], member['start'], member['end'])
            for field in FIELDS:
                if set(values[field]) & set(parsed[field]):
                    raise ValueError('Overlapping ECCC station succession')
                values[field].update(parsed[field])
        metadata = dict(stationId='3050520 → 3050519', stationName='Banff → Banff CS',
            provider='Environment and Climate Change Canada', version='Published daily observations; agency-documented succession',
            lat=members[-1]['lat'], lon=members[-1]['lon'], elevation=members[-1]['elevation'], stationMembers=members,
            lineageUrl='https://climate.weather.gc.ca/climate_normals/results_1991_2020_e.html?climate_id=3050519#metadata-thread',
            qualityNote='ECCC-documented station succession on 1995-04-01. Only unflagged observations (plus trace precipitation); estimated E values excluded.')
        accept_candidate(place, result, found, audit, values, metadata, {v: files for v in ('temperature', 'precipitation')}, ctx)
    if name == 'Singapore':
        values, files = empty_values(), []
        for year in range(1991, 2021):
            for month in range(1, 13):
                filename = f'DAILYDATA_S06_{year}{month:02d}.csv'
                url = 'https://www.weather.gov.sg/files/dailydata/' + filename
                raw, source = read_source(ctx, url, 'singapore/' + filename, f'Paya Lebar · {year}-{month:02d}')
                files.append(source)
                parsed = parse_singapore(raw, year, month)
                for field in FIELDS:
                    if set(values[field]) & set(parsed[field]):
                        raise ValueError('Overlapping Singapore months')
                    values[field].update(parsed[field])
        metadata = dict(stationId='S06', stationName='Paya Lebar', provider='Meteorological Service Singapore',
            lat=1.3524, lon=103.9007, elevation=34, version='Agency-published daily observations; 360 monthly files',
            metadataUrl='https://www.weather.gov.sg/wp-content/uploads/2016/02/Annual-Climatological-Report-2015.pdf',
            qualityNote='Agency-published observations; no per-record quality flags supplied. Blank/dash values excluded. Baseline-era coordinates from the 2015 agency report; current published coordinates differ by about 0.6 km.')
        accept_candidate(place, result, found, audit, values, metadata, {v: files for v in ('temperature', 'precipitation')}, ctx)
