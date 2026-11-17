#!/usr/bin/env python3
"""Bundle NOAA's 1991–2020 global monthly mean precipitation rate.

Requires numpy and h5py. Pass --source to reuse a downloaded NetCDF file.
Precipitation includes the water equivalent of snow; it is not wet-day frequency.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.request

import h5py
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://www.psl.noaa.gov/thredds/fileServer/Datasets/ncep.reanalysis/Monthlies/surface_gauss/prate.sfc.mon.ltm.1991-2020.nc'
METADATA = URL.replace('/fileServer/', '/dodsC/') + '.das'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    args = parser.parse_args()
    cache = ROOT / '.climate-cache' / 'noaa-prate-1991-2020.nc'
    cache.parent.mkdir(exist_ok=True)
    raw = args.source.read_bytes() if args.source else urllib.request.urlopen(URL, timeout=60).read()
    cache.write_bytes(raw)
    with h5py.File(cache) as dataset:
        rate = dataset['prate'][:].astype(np.float64)
        latitudes, longitudes = dataset['lat'][:], dataset['lon'][:]
        assert rate.shape == (12, 94, 192)
        assert dataset['prate'].attrs['units'] == b'Kg/m^2/s'
        assert dataset['time'].attrs['climo_period'] == b'1991/01/01 - 2020/12/31'
        assert np.all(np.isfinite(rate)) and np.all((rate >= 0) & (rate < 0.01))
        assert np.all(dataset['valid_yr_count'][:] == 30), 'Do not silently fill missing rainfall'
        assert np.all(np.diff(latitudes) < 0)
        assert np.allclose(longitudes, np.arange(192) * 1.875)
        # 1 kg/m² of water = 1 mm; convert per second to per day, retain 0.01 mm.
        hundredths = np.rint(rate * 86400 * 100).astype(np.int32)
        result = {
            'schemaVersion': 1,
            'provider': 'NOAA PSL / NCEP–NCAR Reanalysis 1',
            'variable': 'Monthly mean precipitation rate at the surface (rain and snow water equivalent)',
            'baseline': '1991–2020',
            'sourceUrl': URL, 'metadataUrl': METADATA,
            'descriptionUrl': 'https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html',
            'retrieved': datetime.now(timezone.utc).date().isoformat(),
            'sha256': hashlib.sha256(raw).hexdigest(),
            'attribution': 'NCEP–NCAR Reanalysis 1 data provided by NOAA Physical Sciences Laboratory, Boulder, Colorado, USA.',
            'resolution': '192 × 94 Gaussian grid; 1.875° longitude and approximately 1.9° latitude',
            'units': 'mm/day', 'scale': 0.01,
            'width': 192, 'height': 94, 'longitudeStep': 1.875,
            'latitudes': [round(float(value), 5) for value in latitudes],
            'validYearsPerCell': 30,
            'months': hundredths.reshape(12, -1).tolist(),
        }
    target = ROOT / 'src' / 'data' / 'global-rain.json'
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'{target.name}: {target.stat().st_size:,} bytes, 18,048 global cells × 12 months')
    print(f'All cells have 30 years; converted kg/m²/s to 0.01 mm/day. SHA-256: {result["sha256"]}')


if __name__ == '__main__':
    main()
