#!/usr/bin/env python3
"""Bundle NOAA's 1991–2020 global monthly mean daily maximum temperatures.

Requires numpy and h5py. Pass --source to use an already downloaded NetCDF file.
The original file is retained in the ignored climate cache for reproducibility.
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
URL = 'https://www.psl.noaa.gov/thredds/fileServer/Datasets/ncep.reanalysis/Monthlies/surface_gauss/tmax.2m.mon.ltm.1991-2020.nc'
METADATA = 'https://www.psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis/Monthlies/surface_gauss/tmax.2m.mon.ltm.1991-2020.nc.das'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    args = parser.parse_args()
    cache = ROOT / '.climate-cache' / 'noaa-tmax-1991-2020.nc'
    cache.parent.mkdir(exist_ok=True)
    raw = args.source.read_bytes() if args.source else urllib.request.urlopen(URL, timeout=60).read()
    cache.write_bytes(raw)
    with h5py.File(cache) as dataset:
        tmax = dataset['tmax'][:].astype(np.float64)
        latitudes = dataset['lat'][:]
        longitudes = dataset['lon'][:]
        years = dataset['valid_yr_count'][:]
        assert tmax.shape == (12, 94, 192)
        assert dataset['tmax'].attrs['units'] == b'degK'
        assert dataset['time'].attrs['climo_period'] == b'1991/01/01 - 2020/12/31'
        assert np.all(np.isfinite(tmax)) and np.all((tmax >= 150) & (tmax <= 400))
        assert np.all(years == 30), 'Do not silently fill incomplete climatology cells'
        assert np.all(np.diff(latitudes) < 0)
        assert np.allclose(longitudes, np.arange(192) * 1.875)
        celsius_tenths = np.rint((tmax - 273.15) * 10).astype(np.int16)
        result = {
            'schemaVersion': 1,
            'provider': 'NOAA PSL / NCEP–NCAR Reanalysis 1',
            'variable': 'Monthly mean daily maximum air temperature at 2 m',
            'baseline': '1991–2020',
            'sourceUrl': URL, 'metadataUrl': METADATA,
            'descriptionUrl': 'https://psl.noaa.gov/data/gridded/data.ncep.reanalysis.html',
            'retrieved': datetime.now(timezone.utc).date().isoformat(),
            'sha256': hashlib.sha256(raw).hexdigest(),
            'attribution': 'NCEP–NCAR Reanalysis 1 data provided by NOAA Physical Sciences Laboratory, Boulder, Colorado, USA.',
            'resolution': '192 × 94 Gaussian grid; 1.875° longitude and approximately 1.9° latitude',
            'units': 'degrees Celsius', 'scale': 0.1,
            'width': 192, 'height': 94, 'longitudeStep': 1.875,
            'latitudes': [round(float(value), 5) for value in latitudes],
            'validYearsPerCell': 30,
            'months': celsius_tenths.reshape(12, -1).tolist(),
        }
    target = ROOT / 'src' / 'data' / 'global-temperature.json'
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f'{target.name}: {target.stat().st_size:,} bytes, {result["width"] * result["height"]:,} global cells × 12 months')
    print(f'All cells have 30 years; converted Kelvin to 0.1°C. SHA-256: {result["sha256"]}')


if __name__ == '__main__':
    main()
