"""Verified European/African agency supplements; never weaken the shared policy.

CHMI's public CSV metadata defines QUALITY=0 as Good, 3 as Estimated, 4 as
Missing, and 5 as Unknown. Only Good observations are eligible here. Metadata
and raw observation files are retained and hashed by the shared source reader.
"""
import csv
import datetime as dt
import importlib.util
import io
import json
import math
import pathlib

BASE = 'https://opendata.chmi.cz/meteorology/climate/historical_csv/'
PRAGUE_STATION = '0-20000-0-11519'
NOA_DATASET = 'e2ae9f71-048f-4565-b24b-f8f15e4c2cf5'
NOA_DATA_URL = ('https://data.climpact.gr/dataset/' + NOA_DATASET +
    '/resource/a3de2376-eca2-4c87-8959-5f35a58dfe64/download/hcd_noa_5.csv')
NOA_METADATA_URL = 'https://data.climpact.gr/api/3/action/package_show?id=' + NOA_DATASET
ELEMENTS = {'TMA': ('TMAX', 'temperature', '20:00'),
            'TMI': ('TMIN', 'temperature', '20:00'),
            'SRA': ('PRCP', 'precipitation', '06:00')}


def parse_chmi(raw, element, station_id=PRAGUE_STATION):
    """Parse one published daily variable, preserving provider calendar dates."""
    target, _, schedule = ELEMENTS[element]
    rows = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
    required = {'STATION', 'ELEMENT', 'TIMEFUNC', 'DT', 'VALUE', 'FLAG', 'QUALITY'}
    if not required.issubset(rows.fieldnames or []):
        raise ValueError('Unexpected CHMI daily CSV schema')
    observations, seen = {}, set()
    for row in rows:
        if row['STATION'] != station_id or row['ELEMENT'] != element:
            raise ValueError('Mismatched CHMI station or element')
        stamp = dt.datetime.fromisoformat(row['DT'].replace('Z', '+00:00'))
        if not 1991 <= stamp.year <= 2020:
            continue
        if row['TIMEFUNC'] != schedule or stamp.strftime('%H:%M') != schedule:
            raise ValueError('Unexpected CHMI daily observation schedule')
        date = (stamp.year, stamp.month, stamp.day)
        if date in seen:
            raise ValueError('Duplicate CHMI daily observation')
        seen.add(date)
        if row['QUALITY'].strip() not in ('0', '0.0') or not row['VALUE'].strip():
            continue
        # T = unmeasurable trace; M = exceptional manual-gauge reading. Both
        # still require provider Good quality. No other measurement flags pass.
        flag = row['FLAG'].strip()
        if flag not in (('', 'T', 'M') if element == 'SRA' else ('',)):
            continue
        value = float(row['VALUE'])
        if not math.isfinite(value) or not (value >= 0 if element == 'SRA' else -100 <= value <= 65):
            raise ValueError('Invalid CHMI daily observation')
        if flag == 'T' and value != 0:
            raise ValueError('Unexpected nonzero CHMI trace amount')
        observations[date] = (value, '0')
    return target, observations


def parse_chmi_locations(raw, station_id=PRAGUE_STATION):
    """Preserve every published location period overlapping the baseline."""
    rows = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
    required = {'WSI', 'GH_ID', 'BEGIN_DATE', 'END_DATE', 'FULL_NAME', 'GEOGR1', 'GEOGR2', 'ELEVATION'}
    if not required.issubset(rows.fieldnames or []):
        raise ValueError('Unexpected CHMI station metadata schema')
    members = []
    for row in rows:
        if row['WSI'] != station_id or row['END_DATE'][:10] < '1991-01-01' or row['BEGIN_DATE'][:10] > '2020-12-31':
            continue
        member = dict(stationId=station_id, stationName=row['FULL_NAME'].replace('  ', ' '),
                      localStationId=row['GH_ID'], lat=float(row['GEOGR2']), lon=float(row['GEOGR1']),
                      elevation=float(row['ELEVATION']), start=max(row['BEGIN_DATE'][:10], '1991-01-01'),
                      end=min(row['END_DATE'][:10], '2020-12-31'))
        if not all(math.isfinite(member[k]) for k in ('lat', 'lon', 'elevation')):
            raise ValueError('Invalid CHMI station location')
        members.append(member)
    members.sort(key=lambda member: member['start'])
    if not members or members[0]['start'] != '1991-01-01' or members[-1]['end'] != '2020-12-31':
        raise ValueError('Incomplete CHMI baseline location history')
    for left, right in zip(members, members[1:]):
        expected = (dt.date.fromisoformat(left['end']) + dt.timedelta(days=1)).isoformat()
        if right['start'] != expected:
            raise ValueError('Gap or overlap in CHMI baseline location history')
    return members


def parse_noa(raw):
    """Read NOA's published Thissio observations, not monthly summary products."""
    rows = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
    fields = {'TMAX': 'Tmax (oC)', 'TMIN': 'Tmin (oC)', 'PRCP': 'Precipitation (mm)'}
    if not {'DATE', *fields.values()}.issubset(rows.fieldnames or []):
        raise ValueError('Unexpected NOA daily CSV schema or units')
    values, seen = {element: {} for element in fields}, set()
    for row in rows:
        stamp = dt.datetime.strptime(row['DATE'], '%d-%m-%Y')
        if not 1991 <= stamp.year <= 2020:
            continue
        date = (stamp.year, stamp.month, stamp.day)
        if date in seen:
            raise ValueError('Duplicate NOA daily observation')
        seen.add(date)
        for element, field in fields.items():
            if not row[field].strip():
                continue
            value = float(row[field])
            if not math.isfinite(value) or not (value >= 0 if element == 'PRCP' else -100 <= value <= 65):
                raise ValueError('Invalid NOA daily observation')
            values[element][date] = (value, 'P')
    return values


def supplement(place, result, found, audit, ctx):
    """Integration hook matching agency_sources.supplement's signature."""
    if place['name'] not in ('Prague', 'Athens') or len(found) == 2:
        return
    path = pathlib.Path(__file__).with_name('agency_sources.py')
    spec = importlib.util.spec_from_file_location('agency_source_helpers', path)
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    if place['name'] == 'Athens':
        raw, source = helpers.read_source(ctx, NOA_DATA_URL,
            'europe-africa-next/hcd_noa_5.csv', 'NOA Thissio daily historical observations')
        values = parse_noa(raw)
        raw_metadata, metadata_source = helpers.read_source(ctx, NOA_METADATA_URL,
            'europe-africa-next/athens-package.json', 'NOA CLIMPACT dataset metadata')
        package = json.loads(raw_metadata)
        if not package.get('success') or package['result']['id'] != NOA_DATASET or not any(
                resource['url'] == NOA_DATA_URL for resource in package['result']['resources']):
            raise ValueError('Mismatched NOA dataset metadata')
        metadata = dict(stationId='NOA-THISSIO', stationName='Athens Thissio – Hill of Nymphs',
            provider='National Observatory of Athens (CLIMPACT)',
            version='Daily historical climatic data since 1901; CC-BY 4.0',
            lat=37.972, lon=23.717, elevation=107,
            metadataUrl='https://data.climpact.gr/dataset/' + NOA_DATASET,
            qualityEvidenceUrl='https://data.climpact.gr/dataset/' + NOA_DATASET,
            licenseUrl='https://creativecommons.org/licenses/by/4.0/',
            attribution='National Observatory of Athens, Daily historical climatic data at Thissio (Athens) since 1901, '
            'CLIMPACT, CC-BY 4.0. This app calculates the 1991–2020 subset and monthly summaries.',
            qualityNote='Agency-published observations; no per-record quality flags supplied. '
            'NOA documents a continuous station record without relocations. Maximum/minimum temperatures '
            'use conventional screen thermometers until 2013 and Pt-100 sensors afterwards; rainfall '
            'uses a cup gauge until 1998 and a tipping-bucket gauge afterwards. '
            'Published rainfall days start/end at 20:00 local standard time; agency dates are retained.')
        helpers.accept_candidate(place, result, found, audit, values, metadata,
            {variable: [source, metadata_source] for variable in ('temperature', 'precipitation')}, ctx)
        return
    cache_prefix = 'europe-africa-next/chmi/'
    raw, metadata_source = helpers.read_source(ctx, BASE + 'metadata/meta1.csv',
        cache_prefix + 'metadata-meta1.csv', 'CHMI station location history')
    members = parse_chmi_locations(raw)
    values, inputs = helpers.empty_values(), {'temperature': [], 'precipitation': []}
    for element, (target, folder, _) in ELEMENTS.items():
        filename = f'dly-{PRAGUE_STATION}-{element}.csv'
        raw, source = helpers.read_source(ctx, BASE + f'data/daily/{folder}/' + filename,
                                        cache_prefix + filename, f'CHMI Karlov {element}')
        _, values[target] = parse_chmi(raw, element)
        inputs[folder].append(source)
    # Persist flag and unit definitions as provenance alongside the location file.
    supporting = [metadata_source]
    for number in (2, 3, 4):
        filename = f'meta{number}.csv'
        _, source = helpers.read_source(ctx, BASE + 'metadata/' + filename,
            cache_prefix + ('meta2.csv' if number == 2 else 'metadata-' + filename),
            'CHMI measurement / quality metadata')
        supporting.append(source)
    for files in inputs.values():
        files.extend(supporting)
    metadata = dict(stationId=PRAGUE_STATION, stationName='Praha Karlov',
        provider='Czech Hydrometeorological Institute',
        version='Published daily climate observations; Good quality only',
        lat=members[-1]['lat'], lon=members[-1]['lon'], elevation=members[-1]['elevation'],
        stationMembers=members, metadataUrl=BASE + 'metadata/meta1.csv',
        qualityUrl=BASE + 'metadata/meta4.csv', lineageUrl=BASE + 'metadata/meta1.csv',
        qualityNote='Only CHMI QUALITY=0 (Good); estimated, suspect, poor, missing and unknown-quality values excluded. '
        'Agency dates retained: maximum/minimum temperature at 20:00 UTC, precipitation at 06:00 UTC. '
        'Trace rainfall is published as 0 mm. Agency metadata records a Karlov location change on 2003-01-01; '
        'both positions are retained and independently checked against the distance/elevation policy.')
    helpers.accept_candidate(place, result, found, audit, values, metadata, inputs, ctx)
