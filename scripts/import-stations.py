#!/usr/bin/env python3
"""Prefer screened NOAA GHCN-Daily observations; retain NASA POWER per-variable fallback.

Python standard library only. Run after import-climate.py (its cached raw responses
are reused). The public source archives, selection audit and raw hashes make the
build reproducible. Never fills a missing station observation with a modeled one.
"""
import calendar
import concurrent.futures
import csv
import datetime as dt
import hashlib
import importlib.util
import io
import json
import math
import pathlib
import statistics
import time
import urllib.parse
import urllib.request
import agency_europe_africa
import agency_americas
import agency_asia

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / '.climate-cache/stations'
BASE = 'https://www.ncei.noaa.gov/pub/data/ghcn/daily/'
YEARS = range(1991, 2021)
POLICY = dict(maxDistanceKm=15, maxElevationDifferenceM=150,
              minMonthCompleteness=0.9, minCalendarMonthCoverage=0.8,
              minYearsPerMonth=20, minYearsPerDecade=5)
spec = importlib.util.spec_from_file_location('grid_import', ROOT / 'scripts/import-climate.py')
grid = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grid)
agency_spec = importlib.util.spec_from_file_location('agency_sources', ROOT / 'scripts/agency_sources.py')
agencies = importlib.util.module_from_spec(agency_spec)
agency_spec.loader.exec_module(agencies)


def cached(url, name):
    path = CACHE / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        for attempt in range(3):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={
                    'User-Agent': 'VacationClimateBaseline/2.0'}), timeout=120) as response:
                    raw = response.read()
                assert raw and not raw.lstrip().startswith(b'<'), 'Unexpected data response'
                path.write_bytes(raw)
                break
            except (OSError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
    return path.read_bytes(), dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).isoformat()


def distance(a, b):
    p, q = math.radians(a['lat']), math.radians(b['lat'])
    dl = math.radians(b['lon'] - a['lon'])
    return 6371 * 2 * math.asin(math.sqrt(math.sin((q - p) / 2) ** 2 + math.cos(p) * math.cos(q) * math.sin(dl / 2) ** 2))


def eligible(place, station):
    return station['elevation'] != -999.9 and distance(place, station) <= POLICY['maxDistanceKm'] and abs(station['elevation'] - place['elevation']) <= POLICY['maxElevationDifferenceM']


def observation(element, cell):
    """Reject failed QC, missing/presumed zeros, partial-day rain and hourly extrema."""
    value, measurement, quality, source = int(cell[:5]), cell[5], cell[6], cell[7]
    if value == -9999 or quality != ' ' or source == ' ':
        return None
    if element == 'PRCP':
        # GSOD/SSOD precipitation can be incomplete. No A/C/E partial-day totals,
        # H ambiguous zero, I no report, or P missing-presumed-zero values.
        if measurement not in ' BDFGT' or source in 'S2' or value < 0:
            return None
        return (0 if measurement == 'T' else value / 10), source
    if measurement not in ' ' or not -1000 <= value <= 650:
        return None
    return value / 10, source


def parse_daily(raw, station_id):
    values = {key: {} for key in ('TMAX', 'TMIN', 'PRCP')}
    for line in raw.decode('ascii').splitlines():
        if len(line) < 269 or line[:11] != station_id:
            raise ValueError('Malformed or mismatched station record')
        year, month, element = int(line[11:15]), int(line[15:17]), line[17:21]
        if year not in YEARS or element not in values:
            continue
        for day in range(1, calendar.monthrange(year, month)[1] + 1):
            start = 21 + (day - 1) * 8
            item = observation(element, line[start:start + 8])
            if item is not None:
                key = (year, month, day)
                if key in values[element]:
                    raise ValueError('Duplicate station day')
                values[element][key] = item
    return values


def parse_swiss(raw, station_id):
    values = {key: {} for key in ('TMAX', 'TMIN', 'PRCP')}
    fields = dict(TMAX='tre200dx', TMIN='tre200dn', PRCP='rre150d0')
    reader = csv.DictReader(io.StringIO(raw.decode('cp1252')), delimiter=';')
    assert all(field in reader.fieldnames for field in [*fields.values(), 'station_abbr', 'reference_timestamp'])
    for row in reader:
        assert row['station_abbr'] == station_id, 'Mismatched Swiss station'
        date = dt.datetime.strptime(row['reference_timestamp'], '%d.%m.%Y %H:%M')
        if date.year not in YEARS:
            continue
        key = (date.year, date.month, date.day)
        for element, field in fields.items():
            if row[field] == '':
                continue
            value = float(row[field])
            assert math.isfinite(value), 'Non-finite Swiss observation'
            assert (value >= 0 if element == 'PRCP' else -100 <= value <= 65), 'Invalid Swiss observation'
            assert key not in values[element], 'Duplicate Swiss day'
            values[element][key] = (value, 'MeteoSwiss')
    return values


def supplement_swiss(place, result, found, audit):
    """Direct national archive fills a known GHCN coverage gap, using the same screens."""
    if place['name'] != 'Interlaken':
        return
    base = 'https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/'
    raw, _ = cached(base + 'ogd-smn_meta_stations.csv', 'ogd-smn_meta_stations.csv')
    metadata = next(row for row in csv.DictReader(io.StringIO(raw.decode('cp1252')), delimiter=';') if row['station_abbr'] == 'INT')
    station = dict(lat=float(metadata['station_coordinates_wgs84_lat']), lon=float(metadata['station_coordinates_wgs84_lon']), elevation=float(metadata['station_height_masl']))
    assert eligible(place, station), 'Swiss station no longer passes proximity/elevation screening'
    raw, _ = cached(base + 'ogd-smn_meta_parameters.csv', 'ogd-smn_meta_parameters.csv')
    parameters = {row['parameter_shortname']: row for row in csv.DictReader(io.StringIO(raw.decode('cp1252')), delimiter=';')}
    for field, unit in [('tre200dx', '°C'), ('tre200dn', '°C'), ('rre150d0', 'mm')]:
        assert parameters[field]['parameter_granularity'] == 'D' and parameters[field]['parameter_unit'] == unit
    url = base + 'int/ogd-smn_int_d_historical.csv'
    raw, retrieved = cached(url, 'swiss-int-daily.csv')
    values = parse_swiss(raw, 'INT')
    record = dict(stationId='INT', provider='MeteoSwiss', variables={})
    for variable in ('temperature', 'precipitation'):
        if variable in found:
            continue
        months, coverage, _ = summarize(values, variable)
        record['variables'][variable] = dict(accepted=months is not None, coverage=coverage)
        if months is None:
            continue
        found[variable] = dict(kind='station', provider='MeteoSwiss SwissMetNet', sourceUrl=url,
                               stationId='INT', stationName=metadata['station_name'], **station,
                               distanceKm=round(distance(place, station), 2), elevationDifferenceM=round(station['elevation'] - place['elevation'], 1),
                               retrieved=retrieved, sha256=hashlib.sha256(raw).hexdigest(), version='OGD SwissMetNet historical daily',
                               coverage=coverage, sourceFlags=['MeteoSwiss published historical daily measurements'])
        for current, replacement in zip(result['months'], months):
            current.update(replacement)
    audit.append(record)


def summarize(values, variable):
    rows = {}
    for key, (value, flag) in values['TMAX' if variable == 'temperature' else 'PRCP'].items():
        if variable == 'temperature':
            low = values['TMIN'].get(key)
            if not low or low[0] > value:
                continue
            rows[key] = (value, low[0], flag + low[1])
        else:
            rows[key] = (value, flag)
    summaries, coverage, source_flags = [], [], set()
    for month in range(1, 13):
        accepted = []
        good_years = []
        for year in YEARS:
            entries = [rows[(year, month, day)] for day in range(1, calendar.monthrange(year, month)[1] + 1) if (year, month, day) in rows]
            if len(entries) / calendar.monthrange(year, month)[1] >= POLICY['minMonthCompleteness']:
                good_years.append(year)
                accepted.extend(entries)
        expected = sum(calendar.monthrange(year, month)[1] for year in YEARS)
        decades = [sum(first <= year < first + 10 for year in good_years) for first in (1991, 2001, 2011)]
        cover = dict(days=len(accepted), expectedDays=expected, years=len(good_years), decadeYears=decades)
        coverage.append(cover)
        if len(accepted) / expected < POLICY['minCalendarMonthCoverage'] or len(good_years) < POLICY['minYearsPerMonth'] or min(decades) < POLICY['minYearsPerDecade']:
            summaries.append(None)
            continue
        source_flags.update(''.join(row[-1] for row in accepted))
        readings = [row[0] for row in accepted]
        if variable == 'temperature':
            bins = [round(value * 10) for value in readings]
            first, last = min(bins), max(bins)
            counts = [0] * (last - first + 1)
            for value in bins:
                counts[value - first] += 1
            summaries.append(dict(temperatureDays=len(accepted), meanHigh=round(statistics.mean(readings), 2),
                                  meanLow=round(statistics.mean(row[1] for row in accepted), 2),
                                  highP10=grid.quantile(readings, .1), highP90=grid.quantile(readings, .9),
                                  histogramStart=first, highHistogram=counts))
        else:
            summaries.append(dict(precipitationDays=len(accepted), wetDays=sum(value >= 1 for value in readings),
                                  monthlyPrecip=round(statistics.mean(readings) * expected / 30, 2)))
    return summaries if all(item is not None for item in summaries) else None, coverage, sorted(source_flags)


def inventory():
    raw, _ = cached(BASE + 'ghcnd-inventory.txt', 'ghcnd-inventory.txt')
    available = {}
    for line in raw.decode().splitlines():
        element = line[31:35]
        # Broad prefilter only; actual daily coverage is validated separately.
        if element in ('TMAX', 'TMIN', 'PRCP') and int(line[36:40]) <= 1996 and int(line[41:45]) >= 2015:
            available.setdefault(line[:11], set()).add(element)
    raw, _ = cached(BASE + 'ghcnd-stations.txt', 'ghcnd-stations.txt')
    return [dict(id=line[:11], lat=float(line[12:20]), lon=float(line[21:30]),
                 elevation=float(line[31:37]), name=line[41:71].strip(), elements=sorted(available[line[:11]]))
            for line in raw.decode().splitlines() if line[:11] in available]


def build_place(place, stations, version):
    result = grid.fetch(place)
    for month in result['months']:
        month['temperatureDays'] = month['precipitationDays'] = month.pop('days')
    result['elevation'] = place['elevation']
    for key in ('referenceLabel', 'referenceUrl', 'referenceNote', 'agencyReview'):
        if key in place:
            result[key] = place[key]
    candidates = sorted([s for s in stations if eligible(place, s)], key=lambda s: (distance(place, s), s['id']))
    found, audit = {}, []
    for station in candidates:
        needed = [v for v in ('temperature', 'precipitation') if v not in found and (all(e in station['elements'] for e in ('TMAX', 'TMIN')) if v == 'temperature' else 'PRCP' in station['elements'])]
        if not needed:
            continue
        url = BASE + 'all/' + station['id'] + '.dly'
        raw, fetched = cached(url, station['id'] + '.dly')
        values = parse_daily(raw, station['id'])
        record = dict(stationId=station['id'], distanceKm=round(distance(place, station), 2),
                      elevationDifferenceM=round(station['elevation'] - place['elevation'], 1), variables={})
        for variable in needed:
            months, coverage, flags = summarize(values, variable)
            record['variables'][variable] = dict(accepted=months is not None, coverage=coverage)
            if months is not None:
                found[variable] = dict(kind='station', provider='NOAA GHCN-Daily', sourceUrl=url,
                                       stationId=station['id'], stationName=station['name'],
                                       lat=station['lat'], lon=station['lon'], elevation=station['elevation'],
                                       distanceKm=record['distanceKm'], elevationDifferenceM=record['elevationDifferenceM'],
                                       retrieved=fetched, sha256=hashlib.sha256(raw).hexdigest(), version=version,
                                       coverage=coverage, sourceFlags=flags)
                for current, replacement in zip(result['months'], months):
                    current.update(replacement)
        audit.append(record)
        if len(found) == 2:
            break
    supplement_swiss(place, result, found, audit)
    if len(found) < 2:
        # Pass helpers explicitly; no network, parsing or quality rules run in the browser.
        from types import SimpleNamespace
        context = SimpleNamespace(cached=cached, eligible=eligible, distance=distance, summarize=summarize, agencies=agencies)
        agencies.supplement(place, result, found, audit, context)
        agency_europe_africa.supplement(place, result, found, audit, context)
        agency_americas.supplement(place, result, found, audit, context, agencies.accept_candidate)
        agency_asia.supplement(place, result, found, audit, context)
    for variable in ('temperature', 'precipitation'):
        if variable in found:
            continue
        has_candidates = any((all(e in s['elements'] for e in ('TMAX', 'TMIN')) if variable == 'temperature' else 'PRCP' in s['elements']) for s in candidates)
        has_agency_candidates = any(variable in item.get('variables', {}) for item in audit if item.get('provider'))
        reason = ('Nearby station records did not meet daily quality and monthly coverage requirements for 1991–2020.' if has_candidates or has_agency_candidates else
                  'No station in the screened NOAA archive met the 15 km distance, 150 m elevation and historical inventory requirements.')
        agency_reasons = [item.get('variables', {}).get(variable, {}).get('reason') for item in audit if item.get('provider')]
        if any(agency_reasons):
            reason = ' '.join(dict.fromkeys(value for value in agency_reasons if value))
        found[variable] = dict(kind='grid', provider='NASA POWER / MERRA-2', sourceUrl=result['sourceUrl'],
                               retrieved=result['retrieved'], sha256=result['sha256'], version=result['apiVersion'],
                               reason=reason, coverage=[dict(days=m[variable + 'Days'], expectedDays=m[variable + 'Days'], years=30, decadeYears=[10, 10, 10]) for m in result['months']])
    result['sources'] = found
    print(place['name'] + ': ' + ' / '.join(v + '=' + s['kind'] + (' ' + s['stationId'] if s['kind'] == 'station' else '') for v, s in found.items()), flush=True)
    return result, dict(name=place['name'], elevation=place['elevation'], candidates= audit)


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    places = json.loads((ROOT / 'data/climate-locations.json').read_text())
    by_name = {place['name']: place for place in places}
    reviewed = set()
    for path in sorted((ROOT / 'data').glob('agency-review-*.json')):
        for review in json.loads(path.read_text()):
            name = review['name']
            assert name in by_name and name not in reviewed, 'Unknown or duplicate agency review'
            reviewed.add(name)
            by_name[name]['agencyReview'] = {key: value for key, value in review.items() if key != 'name'}
    query = urllib.parse.urlencode(dict(latitude=','.join(str(p['lat']) for p in places), longitude=','.join(str(p['lon']) for p in places)))
    elevation_url = 'https://api.open-meteo.com/v1/elevation?' + query
    raw, elevation_retrieved = cached(elevation_url, 'elevation-' + hashlib.sha256(query.encode()).hexdigest()[:16] + '.json')
    elevations = json.loads(raw)['elevation']
    assert len(elevations) == len(places) and all(isinstance(e, (int, float)) and math.isfinite(e) for e in elevations)
    for place, elevation in zip(places, elevations):
        place['elevation'] = elevation
    stations = inventory()
    # Individual files can be refreshed independently. A cached global revision
    # cannot identify new bytes: retain each file's retrieval date and hash instead.
    version = 'GHCN-Daily Version 3; individual file identified by retrieval date and SHA-256'
    cached(BASE + 'readme.txt', 'readme.txt')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda p: build_place(p, stations, version), places))
    baseline = dict(start='1991-01-01', end='2020-12-31', years=30, wetDayThresholdMm=1,
                    histogramStepC=.1, gridDegrees=dict(latitude=.5, longitude=.625), stationPolicy=POLICY,
                    elevationSource=dict(provider='Copernicus DEM GLO-90 (2021) via Open-Meteo', sourceUrl=elevation_url,
                                         retrieved=elevation_retrieved, sha256=hashlib.sha256(raw).hexdigest()),
                    locations={result['name']: result for result, _ in results})
    target = ROOT / 'src/data/climate.json'
    temp = target.with_suffix('.json.tmp')
    temp.write_text(json.dumps(baseline, ensure_ascii=False, separators=(',', ':')) + '\n')
    temp.replace(target)
    (ROOT / 'data/station-audit.json').write_text(json.dumps(dict(policy=POLICY, version=version,
        locations=[audit for _, audit in results]), ensure_ascii=False, indent=2) + '\n')
    print(f'Wrote {len(results)} locations; {sum(s["kind"] == "station" for r, _ in results for s in r["sources"].values())} station-backed variables', flush=True)


if __name__ == '__main__':
    main()
