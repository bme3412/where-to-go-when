"""Build monthly dry daylight hours from ERA5 via Open-Meteo (destination-local time)."""
import calendar
import concurrent.futures
import datetime as dt
import hashlib
import json
import pathlib
import subprocess
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIRST, LAST = 1991, 2020
THRESHOLD = 0.1  # mm in an hour
cache = ROOT / '.climate-cache' / 'beach-hours'
cache.mkdir(exist_ok=True)
places = json.loads((ROOT / 'data/climate-locations.json').read_text())
coasts = json.loads((ROOT / 'src/data/beach-bases.json').read_text())


def aggregate(place):
    params = dict(latitude=place['lat'], longitude=place['lon'], start_date=f'{FIRST}-01-01',
                  end_date=f'{LAST}-12-31', hourly='precipitation,is_day', models='era5', timezone='auto')
    url = 'https://archive-api.open-meteo.com/v1/archive?' + urllib.parse.urlencode(params)
    path = cache / (hashlib.sha256(url.encode()).hexdigest() + '.json')
    if not path.exists():
        result = subprocess.run(['curl', '-fsSL', '--retry', '2', '--max-time', '180', url], capture_output=True, check=True)
        path.write_bytes(result.stdout)
    raw = path.read_bytes()
    payload = json.loads(raw)
    hourly = payload['hourly']
    assert payload['hourly_units']['precipitation'] == 'mm'
    times, rain, daylight = (hourly[k] for k in ('time', 'precipitation', 'is_day'))
    start = dt.datetime(FIRST, 1, 1)
    days = (dt.datetime(LAST+1, 1, 1) - start).days
    assert len(times) == len(rain) == len(daylight) == days * 24
    months = [dict(days=sum(calendar.monthrange(y, m)[1] for y in range(FIRST,LAST+1)),
                   light=0, dry=0) for m in range(1, 13)]
    for i, (stamp, mm, light) in enumerate(zip(times, rain, daylight)):
        assert dt.datetime.fromisoformat(stamp) == start + dt.timedelta(hours=i)
        assert mm is not None and 0 <= mm < 1000 and light in (0, 1)
        month = months[int(stamp[5:7])-1]
        month['light'] += light
        month['dry'] += int(light and mm < THRESHOLD)
    print(place['name'], 'validated', flush=True)
    return place['name'], dict(url=url, sha256=hashlib.sha256(raw).hexdigest(), months=months)


if __name__ == '__main__':
    selected = [p for p in places if p['name'] in coasts]
    assert len(selected) == len(coasts), "Unknown or duplicate beach base"
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        records = dict(pool.map(aggregate, selected))
    (ROOT / 'src/data/beach-hours.json').write_text(json.dumps(records, ensure_ascii=False, indent=2)+'\n')
