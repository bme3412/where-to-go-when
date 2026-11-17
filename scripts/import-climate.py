#!/usr/bin/env python3
"""Build the offline climate baseline from NASA POWER daily point data.

Run from the repository root. Cached responses avoid repeat downloads. No key or
account is needed. Only two requests run concurrently; errors retain the cache.
"""
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import math
import pathlib
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / '.climate-cache'
START, END = '19910101', '20201231'
EXPECTED = (dt.date(2020, 12, 31) - dt.date(1991, 1, 1)).days + 1
PARAMETERS = ['T2M_MAX', 'T2M_MIN', 'PRECTOTCORR']
BASELINE_DATES = {(dt.date(1991, 1, 1) + dt.timedelta(days=index)).strftime('%Y%m%d') for index in range(EXPECTED)}


def validate_calendar(values):
    assert all(set(values[parameter]) == BASELINE_DATES for parameter in PARAMETERS), 'Invalid or incomplete daily calendar'


def source_url(place):
    params = dict(parameters=','.join(PARAMETERS), community='AG', longitude=place['lon'],
                  latitude=place['lat'], start=START, end=END, format='JSON')
    params['time-standard'] = 'LST'
    return 'https://power.larc.nasa.gov/api/temporal/daily/point?' + urllib.parse.urlencode(params)


def quantile(values, fraction):
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    low = int(position)
    return round(ordered[low] + (ordered[min(low + 1, len(ordered) - 1)] - ordered[low]) * (position - low), 2)


def series_fingerprints(values):
    """Compare complete dated readings, independent of requested point or API metadata."""
    return {factor: hashlib.sha256(json.dumps({key: values[key] for key in keys},
            sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            for factor, keys in [('temperature', ['T2M_MAX', 'T2M_MIN']),
                                 ('precipitation', ['PRECTOTCORR'])]}


def aggregate(place, raw, fetched):
    data = json.loads(raw)
    header = data['header']
    assert header['start'] == START and header['end'] == END, 'Unexpected baseline'
    assert header['time_standard'] == 'LST', 'Unexpected day boundary'
    assert 'MERRA2' in header['sources'], 'Unexpected climate source'
    assert data['parameters']['T2M_MAX']['units'] == 'C'
    assert data['parameters']['T2M_MIN']['units'] == 'C'
    assert data['parameters']['PRECTOTCORR']['units'] == 'mm/day'
    values = data['properties']['parameter']
    validate_calendar(values)
    dates = sorted(values['T2M_MAX'])
    assert len(dates) == EXPECTED and dates[0] == START and dates[-1] == END, 'Incomplete date coverage'
    months = [[] for _ in range(12)]
    for date in dates:
        row = [values[p].get(date) for p in PARAMETERS]
        assert all(isinstance(x, (float, int)) and math.isfinite(x) and x != header['fill_value'] for x in row), f'Missing value on {date}'
        assert -90 <= row[0] <= 65 and -100 <= row[1] <= row[0] and row[2] >= 0, f'Invalid value on {date}'
        months[int(date[4:6]) - 1].append(row)
    summaries = []
    for rows in months:
        highs, lows, precipitation = zip(*rows)
        bins = [int(math.floor(value * 10 + 0.5)) for value in highs]
        first, last = min(bins), max(bins)
        counts = [0] * (last - first + 1)
        for value in bins:
            counts[value - first] += 1
        summaries.append(dict(days=len(rows), meanHigh=round(statistics.mean(highs), 2),
                              meanLow=round(statistics.mean(lows), 2),
                              highP10=quantile(highs, 0.1), highP90=quantile(highs, 0.9),
                              monthlyPrecip=round(sum(precipitation) / 30, 2),
                              wetDays=sum(value >= 1 for value in precipitation),
                              histogramStart=first, highHistogram=counts))
    return dict(name=place['name'], lat=place['lat'], lon=place['lon'],
                gridElevation=data['geometry']['coordinates'][2],
                sourceUrl=source_url(place), retrieved=fetched,
                sha256=hashlib.sha256(raw).hexdigest(), apiVersion=header['api']['version'],
                months=summaries, seriesSha256=series_fingerprints(values))


def fetch(place):
    url = source_url(place)
    key = hashlib.sha256(url.encode()).hexdigest()[:20]
    path = CACHE / f'{key}.json'
    if path.exists():
        raw = path.read_bytes()
    else:
        for attempt in range(3):
            try:
                request = urllib.request.Request(url, headers={'User-Agent': 'VacationClimateBaseline/1.0'})
                with urllib.request.urlopen(request, timeout=120) as response:
                    raw = response.read()
                # Validate before allowing a response into the cache.
                aggregate(place, raw, dt.datetime.now(dt.timezone.utc).isoformat())
                path.write_bytes(raw)
                break
            except (urllib.error.URLError, TimeoutError) as error:
                if attempt == 2:
                    raise
                print(f'Retrying {place["name"]}: {type(error).__name__}', flush=True)
                time.sleep(5 * (attempt + 1))
    fetched = dt.datetime.fromtimestamp(path.stat().st_mtime, dt.timezone.utc).isoformat()
    result = aggregate(place, raw, fetched)
    print(f'Validated {place["name"]}: {EXPECTED} days', flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', help='Fetch a single named location into the cache')
    parser.add_argument('--seed-san-diego', type=pathlib.Path, help='Reuse the already validated initial response')
    args = parser.parse_args()
    CACHE.mkdir(exist_ok=True)
    places = json.loads((ROOT / 'data/climate-locations.json').read_text())
    if args.seed_san_diego:
        place = next(p for p in places if p['name'] == 'San Diego')
        key = hashlib.sha256(source_url(place).encode()).hexdigest()[:20]
        raw = args.seed_san_diego.read_bytes()
        aggregate(place, raw, dt.datetime.now(dt.timezone.utc).isoformat())
        (CACHE / f'{key}.json').write_bytes(raw)
    if args.only:
        places = [p for p in places if p['name'] == args.only]
        if not places:
            raise ValueError('Unknown location')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(fetch, places))
    if args.only:
        return
    output = dict(source='NASA POWER', model='MERRA-2', start='1991-01-01', end='2020-12-31',
                  years=30, timeStandard='LST', gridDegrees=dict(latitude=0.5, longitude=0.625),
                  wetDayThresholdMm=1, histogramStepC=0.1,
                  methodologyUrl='https://power.larc.nasa.gov/docs/methodology/',
                  apiDocsUrl='https://power.larc.nasa.gov/docs/services/api/temporal/daily/',
                  locations={result['name']: result for result in results})
    target = ROOT / 'src/data/climate.json'
    temp = target.with_suffix('.json.tmp')
    temp.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n')
    temp.replace(target)
    print(f'Wrote {target}: {len(results)} locations, {target.stat().st_size:,} bytes', flush=True)


if __name__ == '__main__':
    main()
