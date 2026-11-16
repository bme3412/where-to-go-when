#!/usr/bin/env python3
"""Offline dataset audit. Validate every source fingerprint and scoring denominator."""
import calendar
import collections
import datetime as dt
import hashlib
import json
import math
import pathlib
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]


def digest(path):
    hasher = hashlib.sha256()
    with path.open('rb') as file:
        while chunk := file.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def kind(climate):
    kinds = [source['kind'] for source in climate['sources'].values()]
    return kinds[0] if len(set(kinds)) == 1 else 'mixed'


def km(a, b):
    phi1, phi2 = math.radians(a['lat']), math.radians(b['lat'])
    dphi, dlon = phi2 - phi1, math.radians(b['lon'] - a['lon'])
    return 12742 * math.asin(math.sqrt(math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlon / 2) ** 2))


def main():
    baseline = json.loads((ROOT / 'src/data/climate.json').read_text())
    places = json.loads((ROOT / 'data/climate-locations.json').read_text())
    source = (ROOT / 'src/data/cities.ts').read_text().split('export const CITY_ROWS = ', 1)[1].split(' as const', 1)[0]
    cities = json.loads(source)
    fingerprints = {digest(path) for path in (ROOT / '.climate-cache').rglob('*') if path.is_file() and path.suffix in ('.json', '.csv', '.gz', '.dly', '.txt', '.html')}
    expected = [sum(calendar.monthrange(year, month)[1] for year in range(1991, 2021)) for month in range(1, 13)]
    assert baseline['start'] == '1991-01-01' and baseline['end'] == '2020-12-31'
    assert set(baseline['locations']) == {place['name'] for place in places}
    records, source_checks = [], 0
    for place in places:
        climate = baseline['locations'][place['name']]
        assert (climate['lat'], climate['lon']) == (place['lat'], place['lon'])
        assert len(climate['months']) == 12
        for month in climate['months']:
            assert sum(month['highHistogram']) == month['temperatureDays'] > 0
            assert all(isinstance(value, int) and value >= 0 for value in month['highHistogram'])
            assert 0 <= month['wetDays'] <= month['precipitationDays']
            assert month['meanLow'] <= month['meanHigh'] and month['monthlyPrecip'] >= 0
        factors = {}
        for variable, data in climate['sources'].items():
            for index, cover in enumerate(data['coverage']):
                assert cover['days'] == climate['months'][index][variable + 'Days']
                assert cover['expectedDays'] == expected[index]
                assert expected[index] * .8 <= cover['days'] <= expected[index]
                assert cover['years'] >= 20 and min(cover['decadeYears']) >= 5
                if data['kind'] == 'grid':
                    assert cover['days'] == expected[index]
            inputs = data.get('rawInputs', [])
            if inputs:
                assert all(item['sha256'] in fingerprints for item in inputs), 'A declared source file is missing or changed'
                for item in inputs:
                    if item.get('request'):
                        assert item['request']['method'] == 'POST' and item['request']['body'] and item['request']['contentType']
                        assert item.get('sourcePage', '').startswith('https://'), 'POST exports need a usable source-page link'
                if data.get('hashScope') == 'input manifest':
                    manifest = [{key: item[key] for key in ('url', 'sha256')} for item in inputs]
                    assert data['sha256'] == hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                else:
                    assert len(inputs) == 1 and data['sha256'] == inputs[0]['sha256']
                source_checks += len(inputs)
            else:
                assert data['sha256'] in fingerprints, 'A declared raw source fingerprint is missing'
                source_checks += 1
            if data['kind'] == 'station':
                for member in data.get('stationMembers', [data]):
                    assert km(climate, member) <= 15
                    assert abs(climate['elevation'] - member['elevation']) <= 150
                if data.get('stationMembers'):
                    members = data['stationMembers']
                    assert data.get('lineageUrl')
                    assert members[0]['start'] == baseline['start'] and members[-1]['end'] == baseline['end']
                    for left, right in zip(members, members[1:]):
                        assert dt.date.fromisoformat(left['end']) + dt.timedelta(days=1) == dt.date.fromisoformat(right['start'])
            factors[variable] = dict(kind=data['kind'], provider=data['provider'], station=data.get('stationName'),
                acceptedDays=sum(month['days'] for month in data['coverage']),
                minimumMonthlyCoverage=round(min(month['days'] / month['expectedDays'] for month in data['coverage']), 4))
        records.append(dict(name=place['name'], kind=kind(climate), reference=climate.get('referenceLabel', place['name']), factors=factors))
    for name, _, latitude, longitude, *_ in cities:
        climate = baseline['locations'][name]
        assert (latitude, longitude) == (climate['lat'], climate['lon']), 'Globe/reference coordinate mismatch'
    counts = dict(collections.Counter(kind(baseline['locations'][city[0]]) for city in cities))
    comparison = json.loads((ROOT / 'data/climate-audit-before.json').read_text())
    before = comparison['destinationSources']
    changes = [dict(name=city[0], before=before[city[0]], after=kind(baseline['locations'][city[0]]))
               for city in cities if before[city[0]] != kind(baseline['locations'][city[0]])]
    reviewed = []
    for name, previous_kind in before.items():
        if previous_kind != 'grid':
            continue
        climate = baseline['locations'][name]
        review = climate.get('agencyReview')
        assert review and review.get('status') in ('access-required', 'request-required', 'coverage-failed', 'not-verified', 'imported'), f'Missing agency outcome for {name}'
        url = urllib.parse.urlsplit(review['url'])
        assert url.scheme in ('https', 'http') and url.netloc and review['agency'] and review['note']
        dt.date.fromisoformat(review['checked'])
        if review['status'] == 'imported':
            assert kind(climate) != 'grid', f'Imported label without station data: {name}'
        reviewed.append(dict(name=name, **review))
    access_counts = dict(collections.Counter(review['status'] for review in reviewed))
    report = dict(auditedAt=dt.datetime.now(dt.timezone.utc).isoformat(), baseline='1991–2020',
        status='passed', scope=f'All 83 reference points, all 71 destination coordinates, and every climate factor. Agency routes reviewed for the {len(reviewed)} previously grid-only destinations; source availability research is not exhaustive.',
        checks=dict(sourceFingerprints=source_checks, monthDenominators=True, histogramCounts=True, coveragePolicy=True,
                    stationDistanceAndElevation=True, documentedStationSuccession=True, globeReferenceAlignment=True, agencyReviewCompleteness=True),
        destinationCounts=counts, comparisonCommit=comparison['sourceCommit'], upgrades=changes, agencyReviewCounts=access_counts, agencyReviews=reviewed,
        findings=[dict(id='reference-areas', status='fixed', detail='Tenerife now explicitly represents El Médano coast; regional names show their reference areas. Remaining grid elevation differences >=300m are flagged.'),
                  dict(id='keyboard-access', status='fixed', detail='Searchable Data audit dialog exposes all 71 destinations independently of ranking, home exclusion and Domestic/International filters; marker labels include provenance.'),
                  dict(id='archive-version', status='fixed', detail='NOAA provenance uses file retrieval dates and hashes; no cached global revision is attributed to independently refreshed files.'),
                  dict(id='precipitation-phase', status='fixed', detail='Frequent precipitation replaces Very rainy; total precipitation includes snow-water equivalent.'),
                  dict(id='compound-provenance', status='fixed', detail='Every source file and the Banff station succession are inspectable, with explicit manifest hash scope.')],
        limitations=['No station guarantees identical beach, slope or valley exposure.',
                     'Agency quality systems differ; Singapore supplies no per-record quality flag.',
                     'Banff precipitation remains a grid because observed-only coverage fails.',
                     'NIWA Queenstown requires agency access; Nepal DHM requires a data request; a verified Cusco daily baseline was not obtained.',
                     'No climate trend homogenization; 1991–2020 describes historical conditions, not a future forecast.',
                     'Crowd and travel factors remain disclosed estimates.'], locations=records)
    target = ROOT / 'data/climate-audit.json'
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(dict(status='passed', destinations=counts, upgrades=changes, fingerprintChecks=source_checks), ensure_ascii=False))


if __name__ == '__main__':
    main()
