"""Audited public daily observations from Mexico SMN and the Puerto Ayora operator.

The caller supplies the existing station-policy helpers and acceptance function.
No missing observation is inferred, interpolated, or copied from a grid.
"""
import csv
import datetime as dt
import hashlib
import io
import math
import re

FIELDS = ('TMAX', 'TMIN', 'PRCP')
SMN_BASE = 'https://smn.conagua.gob.mx/tools/RESOURCES/Normales_Climatologicas/Diarios/'
SMN_CATALOG = 'https://smn.conagua.gob.mx/es/climatologia/informacion-climatologica/normales-climatologicas-por-estado'
CDF_PAGE = 'https://datazone.darwinfoundation.org/es/clima/puerto-ayora'
CDF_DATA = 'https://datazone.darwinfoundation.org/images/climate/climate_puerto-ayora.csv'
CDF_LICENSE = 'https://creativecommons.org/licenses/by-nc-sa/4.0/'


def _empty():
    return {field: {} for field in FIELDS}


def _add(values, field, date, reading, flag):
    value = float(reading)
    if not math.isfinite(value) or not (value >= 0 if field == 'PRCP' else -100 <= value <= 65):
        raise ValueError('Invalid agency observation')
    if date in values[field]:
        raise ValueError('Duplicate agency observation')
    values[field][date] = (value, flag)


def parse_smn_mexico(raw, station_id):
    """SMN REGISTRO DIARIO HISTÓRICO: NULO is missing, never a dry day.

    These published records carry no per-record QC flags. Unexpected tokens fail
    closed so a new flag/missing-value convention cannot silently become data.
    """
    text = raw.decode('utf-8-sig')
    if 'REGISTRO DIARIO HISTÓRICO' not in text:
        raise ValueError('Not a Mexico SMN daily observation file')
    header = {}
    for line in text.splitlines():
        match = re.match(r'^\s*([^:]+?)\s*:\s*(.*?)\s*$', line)
        if match:
            header[match[1].strip()] = match[2].strip()
        if line.startswith('FECHA'):
            if line.split() != ['FECHA', 'PRECIP', 'EVAP', 'TMAX', 'TMIN']:
                raise ValueError('Unexpected Mexico SMN column order')
            break
    if int(header['ESTACIÓN']) != int(station_id):
        raise ValueError('Mismatched Mexico SMN station')
    metadata = dict(stationId=station_id, stationName=header['NOMBRE'],
                    lat=float(header['LATITUD'].split()[0]),
                    lon=float(header['LONGITUD'].split()[0]),
                    elevation=float(header['ALTITUD'].split()[0]))
    values, dates = _empty(), set()
    for line in text.splitlines():
        if not re.match(r'^\d{4}-\d{2}-\d{2}', line):
            continue
        row = line.split()
        if len(row) != 5:
            raise ValueError('Unexpected Mexico SMN daily row')
        stamp = dt.date.fromisoformat(row[0])
        if not 1991 <= stamp.year <= 2020:
            continue
        date = (stamp.year, stamp.month, stamp.day)
        if date in dates:
            raise ValueError('Duplicate Mexico SMN day')
        dates.add(date)
        for field, index in [('PRCP', 1), ('TMAX', 3), ('TMIN', 4)]:
            if row[index] != 'NULO':
                _add(values, field, date, row[index], 'agency-published')
    if not dates:
        raise ValueError('No baseline observations in Mexico SMN file')
    return values, metadata


def parse_puerto_ayora(raw):
    """Operator-published daily measurements; blank fields remain missing.

    The station page warns of faulty minimum-temperature instruments in
    2020–2021. Exclude the affected baseline year entirely for TMIN. The common
    summarizer then excludes unpaired temperatures without discarding rain.
    """
    reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
    required = {'observation_date', 'max_air_temp', 'min_air_temp', 'precipitation'}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError('Unexpected Puerto Ayora columns')
    values, dates = _empty(), set()
    for row in reader:
        stamp = dt.date.fromisoformat(row['observation_date'])
        if not 1991 <= stamp.year <= 2020:
            continue
        date = (stamp.year, stamp.month, stamp.day)
        if date in dates:
            raise ValueError('Duplicate Puerto Ayora day')
        dates.add(date)
        for field, column in [('TMAX', 'max_air_temp'), ('TMIN', 'min_air_temp'), ('PRCP', 'precipitation')]:
            if field == 'TMIN' and stamp.year == 2020:
                continue
            reading = row[column].strip()
            if reading:
                _add(values, field, date, reading, 'operator-published')
    if not dates:
        raise ValueError('No baseline observations in Puerto Ayora file')
    return values


def _read(ctx, url, name, label):
    raw, retrieved = ctx.cached(url, '../agency-research/americas-next/' + name)
    return raw, dict(url=url, label=label, retrieved=retrieved, sha256=hashlib.sha256(raw).hexdigest())


def supplement(place, result, found, audit, ctx, accept_candidate):
    """Call with the existing agency_sources.accept_candidate as the final arg."""
    if place['name'] in ('Cancún', 'Mexico City'):
        state, code = ('qroo', '23155') if place['name'] == 'Cancún' else ('df', '09048')
        raw, source = _read(ctx, SMN_BASE + state + '/dia' + code + '.txt',
                            'smn-dia' + code + '.txt', 'Mexico SMN historical daily observations')
        values, metadata = parse_smn_mexico(raw, code)
        metadata.update(provider='CONAGUA / Servicio Meteorológico Nacional (Mexico)',
            version='Published daily historical observations; 1991–2020 subset',
            metadataUrl=SMN_CATALOG + '?estado=' + state,
            qualityNote='Agency-published daily observations; no per-record QC flags supplied. NULO values excluded; no infilling. Daily highs and lows must be paired, and all existing proximity and baseline-coverage screens apply.')
        accept_candidate(place, result, found, audit, values, metadata,
                         {v: [source] for v in ('temperature', 'precipitation')}, ctx)
    if place['name'] == 'Galápagos':
        raw, source = _read(ctx, CDF_DATA, 'cdf-puerto-ayora.csv', 'Puerto Ayora daily station observations')
        values = parse_puerto_ayora(raw)
        metadata = dict(stationId='Puerto Ayora', stationName='Puerto Ayora / Charles Darwin Research Station',
            provider='Charles Darwin Foundation (INAMHI-installed station)',
            lat=-0.743708, lon=-90.302647, elevation=2,
            version='Operator-published daily observations; 1991–2020 subset',
            metadataUrl=CDF_PAGE, qualityEvidenceUrl=CDF_PAGE, licenseUrl=CDF_LICENSE,
            licenseName='CC BY-NC-SA 4.0', derivedDataLicense='CC BY-NC-SA 4.0',
            attribution='Galapagos Climatology Database, dataZone, Charles Darwin Foundation. Adapted by this app into monthly 1991–2020 summaries; faulty 2020 minima and missing/unpaired readings excluded. These derived summaries remain licensed CC BY-NC-SA 4.0.',
            qualityNote='Operator-published daily observations; no per-record QC flags supplied. Blank fields excluded. All 2020 minimum temperatures excluded due to the operator’s explicit 2020–2021 instrument-error warning; unpaired highs are excluded by the common temperature screen. Source and derived monthly summaries are CC BY-NC-SA 4.0: attribution, noncommercial use and share-alike terms apply.')
        accept_candidate(place, result, found, audit, values, metadata,
                         {v: [source] for v in ('temperature', 'precipitation')}, ctx)
