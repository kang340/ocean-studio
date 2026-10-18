"""Map-ready slices of downloaded gridded files.

Only the requested time / depth slice and spatial window is read. Slices are
reduced to a display grid with NaN-aware block means (circular means for
direction fields). Missing cells stay missing: nothing is filled or invented.
"""
from __future__ import annotations
import json, math, struct, threading, time, warnings
from collections import OrderedDict
from pathlib import Path
import numpy as np
from core.science import open_local, axes, ALIASES
from core.variables import canonical
from core.timeutils import parse_utc, normalize_utc, is_gregorian, calendar_ordinal

# netCDF4 / HDF5 / eccodes are not thread-safe; every read of a local file goes through this lock.
LOCK = threading.RLock()
OCEAN_PROVIDERS = {'hycom', 'copernicus'}

# ---------------------------------------------------------------- variable roles
VELOCITY_KINDS = {'wind_u', 'wind_v', 'current_u', 'current_v', 'ice_u', 'ice_v'}
_SPEED_UNITS = {'m/s': 1.0, 'm s-1': 1.0, 'm s**-1': 1.0, 'm.s-1': 1.0, 'meter second-1': 1.0, 'meters/second': 1.0, 'm/sec': 1.0, 'ms-1': 1.0, 'm s^-1': 1.0,
                'cm/s': 0.01, 'cm s-1': 0.01, 'cm s**-1': 0.01, 'cm.s-1': 0.01, 'centimeter second-1': 0.01, 'cm/sec': 0.01,
                'mm/s': 0.001, 'mm s-1': 0.001, 'km/h': 1 / 3.6, 'km h-1': 1 / 3.6, 'kn': 0.514444, 'kt': 0.514444, 'knot': 0.514444, 'knots': 0.514444}

def speed_scale(units):
    """Factor to m/s for a velocity unit spelling, or None when the unit is not a recognised speed."""
    return _SPEED_UNITS.get(' '.join(str(units or '').strip().lower().split()))

def kind_of(name, attrs, canon=None, provider='custom'):
    n = name.lower(); s = str(attrs.get('standard_name', '')).lower(); c = (canon or '').lower()
    ln = str(attrs.get('long_name', '')).lower(); units = str(attrs.get('units', '')).lower()
    ocean = provider in OCEAN_PROVIDERS
    def has(*parts): return any(p in s or p in ln for p in parts)
    # An explicit CF standard_name decides first; variable names and the provider are only fallbacks
    # (a custom file may call an ocean current 'u').
    for key, role in (('eastward_sea_water_velocity', 'current_u'), ('northward_sea_water_velocity', 'current_v'),
                      ('surface_geostrophic_eastward_sea_water_velocity', 'current_u'), ('surface_geostrophic_northward_sea_water_velocity', 'current_v'),
                      ('eastward_wind', 'wind_u'), ('northward_wind', 'wind_v'),
                      ('eastward_sea_ice_velocity', 'ice_u'), ('northward_sea_ice_velocity', 'ice_v')):
        if key in s: return role
    if c in ('wind_u_10m', 'wind_u_pressure') or n in ('u10', 'ugrd', 'u10m', '10u', 'u100', 'uwnd') or 'eastward_wind' in s or has('u component of wind', 'u-component of wind') or (n == 'u' and not ocean):
        return 'wind_u'
    if c in ('wind_v_10m', 'wind_v_pressure') or n in ('v10', 'vgrd', 'v10m', '10v', 'v100', 'vwnd') or 'northward_wind' in s or has('v component of wind', 'v-component of wind') or (n == 'v' and not ocean):
        return 'wind_v'
    if c in ('sea_ice_u',) or n in ('usi', 'siu', 'uice'): return 'ice_u'
    if c in ('sea_ice_v',) or n in ('vsi', 'siv', 'vice'): return 'ice_v'
    if c in ('surface_stress_u',) or n in ('surtx', 'tauu', 'ewss'): return 'stress_u'
    if c in ('surface_stress_v',) or n in ('surty', 'tauv', 'nsss'): return 'stress_v'
    if c in ('current_u', 'surface_current_u') or n in ('water_u', 'uo', 'ssu', 'ugos', 'uoe', 'u_current', 'ucur', 'u') or 'eastward_sea_water_velocity' in s:
        return 'current_u'
    if c in ('current_v', 'surface_current_v') or n in ('water_v', 'vo', 'ssv', 'vgos', 'von', 'v_current', 'vcur', 'v') or 'northward_sea_water_velocity' in s:
        return 'current_v'
    if c == 'wave_direction' or n in ('dirpw', 'mwd', 'vmdr', 'mdww', 'mdts', 'wvdir', 'dp') or 'wave_from_direction' in s or ('wave' in ln and 'direction' in ln):
        return 'wave_direction'
    if c == 'wave_height' or n in ('swh', 'htsgw', 'vhm0', 'hs', 'shww', 'shts') or 'significant_height' in s or ('wave' in ln and 'height' in ln):
        return 'wave_height'
    if c in ('wave_peak_period', 'wave_mean_period') or n in ('perpw', 'mpww', 'mwp', 'pp1d', 'vtpk', 'vtm10', 'vtm02', 'wvper', 'mpts') or (('wave' in ln or 'wave' in s) and 'period' in (ln + s)):
        return 'wave_period'
    if c in ('sea_temperature', 'sea_surface_temperature', 'bottom_temperature') or n in ('thetao', 'water_temp', 'sst', 'tob', 'analysed_sst', 'temp', 'to', 'votemper') or ('sea_water' in s and 'temperature' in s) or 'sea_surface_temperature' in s:
        return 'sea_temperature'
    if (c or '').startswith('air_temperature') or n in ('t2m', 'tmp', 't', '2t', 'air', 'skt') or s in ('air_temperature', 'surface_temperature'):
        return 'air_temperature'
    if c in ('sea_salinity', 'sea_surface_salinity', 'bottom_salinity') or n in ('so', 'salinity', 'sss', 'sob', 'psal', 'vosaline') or 'salinity' in s:
        return 'salinity'
    if c in ('air_pressure', 'surface_pressure') or n in ('prmsl', 'msl', 'sp', 'mslp', 'pres', 'slp') or 'air_pressure' in s:
        return 'pressure'
    if c == 'precipitation' or n in ('tp', 'apcp', 'prate', 'precip', 'pr', 'cp', 'lsp') or 'precipitation' in s or 'precipitation' in ln:
        return 'precipitation'
    if c == 'sea_surface_height' or n in ('zos', 'surf_el', 'ssh', 'sla', 'adt') or 'sea_surface_height' in s:
        return 'ssh'
    if c in ('sea_ice_concentration',) or n in ('siconc', 'sic', 'ci', 'icec') or 'sea_ice_area_fraction' in s:
        return 'sea_ice'
    if 'humidity' in (c + s + ln) or n in ('r2', 'rh', 'r'):
        return 'humidity'
    if 'cloud' in (c + s + ln) or n in ('tcc', 'tcdc'):
        return 'cloud'
    if 'chl' in n or 'chlorophyll' in (s + ln + c):
        return 'chlorophyll'
    if n in ('mlotst', 'mld') or 'mixed_layer' in (s + c):
        return 'mixed_layer'
    if 'speed' in (s + ln) and units in ('m/s', 'm s-1', 'm s**-1'):
        return 'speed'
    return 'generic'

VECTOR_PAIRS = [('wind_u', 'wind_v', 'wind', '风场'), ('current_u', 'current_v', 'current', '海流'),
                ('ice_u', 'ice_v', 'ice_drift', '海冰漂移'), ('stress_u', 'stress_v', 'stress', '表面应力')]

def _pair_vectors(variables):
    vectors = []
    for ku, kv, kind, label in VECTOR_PAIRS:
        us = [v for v in variables if v['kind'] == ku and v['mapable']]
        vs = [v for v in variables if v['kind'] == kv and v['mapable']]
        used = set()
        for u in us:
            candidates = [v for v in vs if v['name'] not in used and v['spatial'] == u['spatial']]
            if not candidates: continue
            # Prefer the partner whose name differs only by the u/v letter (water_u ↔ water_v).
            swap = u['name'].replace('u', 'v'); swap2 = u['name'].replace('U', 'V')
            best = next((v for v in candidates if v['name'] in (swap, swap2)), candidates[0]); used.add(best['name'])
            vectors.append({'id': f"{kind}:{u['name']}:{best['name']}", 'kind': kind, 'label': label, 'u': u['name'], 'v': best['name'], 'units': u['units']})
    for d in [v for v in variables if v['kind'] == 'wave_direction' and v['mapable']]:
        height = next((v for v in variables if v['kind'] == 'wave_height' and v['spatial'] == d['spatial']), None)
        vectors.append({'id': f"wave:{d['name']}", 'kind': 'wave', 'label': '浪向', 'direction': d['name'], 'magnitude': height['name'] if height else None,
                        'convention': 'from', 'units': height['units'] if height else ''})
    return vectors

# ---------------------------------------------------------------- open-file cache
_open: 'OrderedDict[tuple, list]' = OrderedDict()
_describe: dict = {}
IDLE_SECONDS = 240

def dataset(path):
    """Shared lazily-opened dataset; callers must hold LOCK while touching it."""
    p = Path(path); key = (str(p), p.stat().st_mtime_ns); now = time.monotonic()
    for k in [k for k, item in _open.items() if (now - item[1] > IDLE_SECONDS) or (k[0] == key[0] and k != key)]:
        _close(_open.pop(k)[0])
    if key in _open:
        item = _open.pop(key); item[1] = now; _open[key] = item; return item[0]
    ds = open_local(p); _open[key] = [ds, now]
    while len(_open) > 6: _close(_open.popitem(last=False)[1][0])
    return ds

def _close(ds):
    try: ds.close()
    except Exception: pass

def close_idle():
    with LOCK:
        now = time.monotonic()
        for k in [k for k, item in _open.items() if now - item[1] > IDLE_SECONDS]: _close(_open.pop(k)[0])

# ---------------------------------------------------------------- axes helpers
def _is_time(c):
    if np.issubdtype(c.dtype, np.datetime64): return True
    return c.dtype == object and c.size > 0 and hasattr(c.values.reshape(-1)[0], 'isoformat')

def _iso(values):
    a = np.atleast_1d(values)
    if np.issubdtype(a.dtype, np.datetime64): return [s + 'Z' for s in np.datetime_as_string(a.astype('datetime64[s]'), unit='s')]
    return [x.isoformat() for x in a]

def _time_of(ds, v):
    for d in v.dims:
        if d in ds.coords and _is_time(ds[d]): return d, _iso(ds[d].values)
        for n, c in ds.coords.items():
            if c.dims == (d,) and _is_time(c) and not n.endswith('_run'): return d, _iso(c.values)
    for n in ('valid_time', 'time', 'Time'):
        if n in ds.coords and ds[n].ndim == 0 and _is_time(ds[n]): return None, _iso(ds[n].values)
    return None, []

def _depth_of(ds, v, ax):
    names = set(ALIASES['depth']) | ({ax['depth']} if 'depth' in ax else set()) | {'isobaricInhPa', 'level', 'lev', 'plev'}
    for d in v.dims:
        c = ds[d] if d in ds.variables else None
        if d in names or (c is not None and (c.attrs.get('positive') in ('up', 'down') or c.attrs.get('axis') == 'Z')):
            values = np.asarray(c.values if c is not None else np.arange(ds.sizes[d]), dtype=float)
            return d, [round(float(x), 4) for x in values], (c.attrs.get('units', '') if c is not None else ''), (c.attrs.get('positive', '') if c is not None else '')
    return None, None, '', ''

class Grid:
    """Longitude normalised to an ascending, contiguous axis (wrapping at ±180 or across the date line)."""
    def __init__(self, lon, lat):
        x = ((np.asarray(lon, dtype=float) + 180) % 360) - 180
        order = np.argsort(x, kind='stable'); xs = x[order]
        keep = np.concatenate([[True], np.diff(xs) > 1e-9]) if xs.size else np.array([], bool)
        self.xorder, self.x = order[keep], xs[keep]
        self.step = float(np.median(np.diff(self.x))) if self.x.size > 1 else 1.0
        if self.x.size > 1:
            gaps = np.append(np.diff(self.x), self.x[0] + 360 - self.x[-1]); k = int(np.argmax(gaps))
            if gaps[k] > 3 * self.step and k != self.x.size - 1:
                idx = np.r_[k + 1:self.x.size, 0:k + 1]; xx = self.x[idx].copy(); xx[self.x.size - k - 1:] += 360
                self.x, self.xorder = xx, self.xorder[idx]
        self.global_x = self.x.size > 1 and (self.x[-1] - self.x[0] + self.step) >= 359.5
        y = np.asarray(lat, dtype=float); self.yorder = np.argsort(y, kind='stable'); self.y = y[self.yorder]
        self.ystep = float(np.median(np.abs(np.diff(self.y)))) if self.y.size > 1 else 1.0

    def bounds(self):
        w = self.x[0] - self.step / 2; e = self.x[-1] + self.step / 2
        if self.global_x: w, e = -180.0, 180.0
        return [round(float(w), 5), round(float(max(-90, self.y[0] - self.ystep / 2)), 5), round(float(e), 5), round(float(min(90, self.y[-1] + self.ystep / 2)), 5)]

    def columns(self, west=None, east=None, pad=1, strict=False):
        """Sorted-axis positions and display longitudes covering [west, east].

        strict: only cell centres inside the box, no padding, empty when nothing intersects (statistics)."""
        n = self.x.size
        if west is None or east is None or (east - west) >= 359.9 and west <= east:
            pos = np.arange(n); xs = self.x.copy()
            if self.global_x:  # close the seam so a global field renders without a gap at ±180
                pos = np.append(pos, 0); xs = np.append(xs, self.x[0] + 360)
            return pos, xs
        if east < west: east += 360
        tiles = np.concatenate([self.x - 360, self.x, self.x + 360]); pos = np.tile(np.arange(n), 3)
        inside = np.flatnonzero((tiles >= west) & (tiles <= east))
        if strict:
            if not inside.size: return np.array([], int), np.array([], float)
            pad = 0
            if not self.global_x: copies = inside // n; inside = inside[copies == int(np.bincount(copies).argmax())]
            inside = inside[:n]  # a box wider than the globe counts every column once
            return pos[inside], tiles[inside]
        if not inside.size:
            near = int(np.argmin(np.minimum(np.abs(tiles - west), np.abs(tiles - east)))); inside = np.array([near])
        if self.global_x:
            lo = max(0, inside[0] - pad); hi = min(tiles.size - 1, inside[-1] + pad)
        else:  # a regional grid is never repeated: keep the copy holding most of the window
            copies = inside // n; best = int(np.bincount(copies).argmax()); inside = inside[copies == best]
            lo = max(best * n, inside[0] - pad); hi = min(best * n + n - 1, inside[-1] + pad)
        sel = np.arange(lo, hi + 1)
        return pos[sel], tiles[sel]

    def rows(self, south=None, north=None, pad=1, strict=False):
        if south is None or north is None: return np.arange(self.y.size)
        inside = np.flatnonzero((self.y >= south) & (self.y <= north))
        if strict: return inside
        if not inside.size: inside = np.array([int(np.argmin(np.abs(self.y - (south + north) / 2)))])
        return np.arange(max(0, inside[0] - pad), min(self.y.size, inside[-1] + pad + 1))

    def locate(self, lon, lat):
        """Bracketing sorted positions and bilinear weights for one point, or None outside the grid."""
        if self.y.size < 1 or lat < self.y[0] - self.ystep / 2 or lat > self.y[-1] + self.ystep / 2: return None
        candidates = [lon, lon + 360, lon - 360]
        x = next((c for c in candidates if self.x[0] <= c <= self.x[-1]), None)
        if x is None and self.global_x:
            x = next((c for c in candidates if self.x[-1] <= c <= self.x[0] + 360), None)
        if x is None:
            x = next((c for c in candidates if self.x[0] - self.step / 2 <= c <= self.x[-1] + self.step / 2), None)
            if x is None: return None
        n = self.x.size
        i0 = int(np.clip(np.searchsorted(self.x, x, side='right') - 1, 0, n - 1))
        if self.global_x and x >= self.x[-1]: i1, fx = 0, (x - self.x[-1]) / self.step
        elif i0 >= n - 1 or x <= self.x[0]: i1, fx = i0, 0.0; i0 = 0 if x <= self.x[0] else i0
        else: i1 = i0 + 1; fx = (x - self.x[i0]) / (self.x[i1] - self.x[i0])
        m = self.y.size; j0 = int(np.clip(np.searchsorted(self.y, lat, side='right') - 1, 0, m - 1))
        if j0 >= m - 1 or lat <= self.y[0]: j1, fy = j0, 0.0
        else: j1 = j0 + 1; fy = (lat - self.y[j0]) / (self.y[j1] - self.y[j0])
        return (i0, i1, float(np.clip(fx, 0, 1))), (j0, j1, float(np.clip(fy, 0, 1)))

_grids: dict = {}
def grid_for(ds, lon, lat, key):
    k = (key, lon, lat)
    if k not in _grids:
        if len(_grids) > 32: _grids.clear()
        _grids[k] = Grid(ds[lon].values, ds[lat].values)
    return _grids[k]

# ---------------------------------------------------------------- dataset description
def describe(path, provider='custom'):
    p = Path(path); key = (str(p), p.stat().st_mtime_ns, provider)
    if key in _describe: return _describe[key]
    with LOCK:
        ds = dataset(p); ax = axes(ds); lon, lat = ax.get('longitude'), ax.get('latitude')
        regular = bool(lon and lat and ds[lon].ndim == 1 and ds[lat].ndim == 1 and ds[lon].dims != ds[lat].dims)
        times, depths, variables = {}, {}, []
        def register(store, prefix, value):
            for k, v in store.items():
                if v == value: return k
            k = f'{prefix}{len(store)}'; store[k] = value; return k
        for n, v in ds.data_vars.items():
            if not np.issubdtype(v.dtype, np.number) or v.ndim == 0: continue
            attrs = v.attrs; canon = attrs.get('canonical_name') or canonical(provider, n)
            mapable = regular and ds[lon].dims[0] in v.dims and ds[lat].dims[0] in v.dims
            reason = None
            if not mapable:
                reason = '二维曲线网格暂不支持地图渲染' if lon and lat and ds[lon].ndim == 2 else '非规则经纬网格（站点 / 轨迹记录）'
            tdim, tvals = _time_of(ds, v); zdim, zvals, zunits, zpos = _depth_of(ds, v, ax)
            kind = kind_of(n, attrs, canon, provider); units = str(attrs.get('units', '')); scale = 1.0; source_units = None
            if kind in VELOCITY_KINDS:  # every read returns m/s; unknown spellings are kept and flagged, never relabelled
                f = speed_scale(units)
                if f is not None and f != 1.0: scale, source_units, units = f, units, 'm/s'
                elif f is None: source_units = units
            variables.append({'name': n, 'label': str(attrs.get('long_name') or n), 'units': units, 'scale': scale, 'source_units': source_units,
                              'units_known': kind not in VELOCITY_KINDS or speed_scale(source_units or units) is not None,
                              'standard_name': str(attrs.get('standard_name', '')), 'canonical': canon,
                              'kind': kind, 'dims': list(v.dims), 'shape': list(v.shape),
                              'mapable': bool(mapable), 'reason': reason,
                              'spatial': [ds[lat].dims[0], ds[lon].dims[0]] if mapable else None,
                              'time_axis': register(times, 't', tvals) if tvals else None, 'time_dim': tdim,
                              'depth_axis': register(depths, 'z', {'values': zvals, 'units': zunits, 'positive': zpos}) if zvals else None, 'depth_dim': zdim})
        grid = None
        if regular:
            g = grid_for(ds, lon, lat, key)
            grid = {'bounds': g.bounds(), 'nx': int(g.x.size), 'ny': int(g.y.size), 'dx': round(g.step, 6), 'dy': round(g.ystep, 6),
                    'global': bool(g.global_x), 'longitude': lon, 'latitude': lat}
        info = {'grid': grid, 'variables': variables, 'vectors': _pair_vectors(variables), 'times': times, 'depths': depths,
                'dimensions': {k: int(v) for k, v in ds.sizes.items()},
                'attrs': {k: str(ds.attrs[k])[:400] for k in ('title', 'source', 'institution', 'Conventions', 'history', 'references', 'product_id', 'GRIB_centreDescription') if k in ds.attrs}}
    if len(_describe) > 64: _describe.clear()
    _describe[key] = info
    return info

def same_grid(a, b, tol=None):
    """Two map grids are one product grid: same shape, spacing, global flag and the same bounds (within half a cell).
    Shape alone is not enough: two regional boxes of equal size elsewhere would be mixed into one time axis."""
    if not a or not b: return False
    if (a['nx'], a['ny']) != (b['nx'], b['ny']) or abs(a['dx'] - b['dx']) > 1e-6 or abs(a.get('dy', 0) - b.get('dy', 0)) > 1e-6: return False
    if bool(a.get('global')) != bool(b.get('global')): return False
    t = tol if tol is not None else max(abs(a['dx']), abs(a.get('dy') or a['dx'])) / 2
    return all(abs(x - y) <= t + 1e-9 for x, y in zip(a['bounds'], b['bounds']))

def _nearest_time(values, t):
    """Index of the axis value nearest to t. Works on cftime axes (360_day, noleap: 2001-02-30 is a valid step)."""
    if not values or not t: return 0
    target = normalize_utc(str(t))[0]  # raises ValueError on a malformed target (→ HTTP 400)
    if is_gregorian(str(t)) and all(is_gregorian(str(v)) for v in values):  # exact UTC distances, sub-second kept
        tg = parse_utc(str(t)); d = [abs(parse_utc(str(v)) - tg) for v in values]
        return min(range(len(d)), key=d.__getitem__)
    keys = []
    for value in values:
        try: keys.append(normalize_utc(str(value))[0])
        except ValueError: keys.append(None)  # an unreadable axis value never matches but does not fail the query
    if target in keys: return keys.index(target)
    # other calendars: distance on calendar fields. A Feb 30 or no day 31 on the axis means 30-day months (360_day);
    # otherwise 31-day months keep the order exact with approximate spacing across month ends.
    known = [k for k in keys if k is not None]
    md = 30 if any(k[1] == 2 and k[2] == 30 for k in known) and not any(k[2] == 31 for k in known) else 31
    cand = [(abs(calendar_ordinal(k, md) - calendar_ordinal(target, md)), i) for i, k in enumerate(keys) if k is not None]
    if not cand: raise ValueError('文件时间轴无法解析，无法按时间选择')
    return min(cand)[1]

def _nearest_depth(values, depth):
    if not values or depth is None: return 0
    return int(np.argmin(np.abs(np.asarray(values) - float(depth))))

def _context(path, provider):
    info = describe(path, provider)
    if not info['grid']: raise ValueError('该文件不是规则经纬网格，无法进行地图渲染')
    p = Path(path); ds = dataset(p)
    g = grid_for(ds, info['grid']['longitude'], info['grid']['latitude'], (str(p), p.stat().st_mtime_ns, provider))
    return info, ds, g

def _variable(info, name):
    v = next((x for x in info['variables'] if x['name'] == name), None)
    if not v: raise ValueError(f'变量不存在: {name}')
    if not v['mapable']: raise ValueError(f'{name}: {v["reason"]}')
    return v
def _selection(ds, info, v, time, depth, time_index=None, depth_index=None):
    sel = {}; ti = zi = None
    for d in ds[v['name']].dims:
        if d in v['spatial']: continue
        if d == v['time_dim']:
            ti = time_index if time_index is not None else _nearest_time(info['times'][v['time_axis']], time)
            ti = int(np.clip(ti, 0, ds.sizes[d] - 1)); sel[d] = ti
        elif d == v['depth_dim']:
            zi = depth_index if depth_index is not None else _nearest_depth(info['depths'][v['depth_axis']]['values'], depth)
            zi = int(np.clip(zi, 0, ds.sizes[d] - 1)); sel[d] = zi
        else: sel[d] = 0
    if ti is None and v['time_axis']: ti = 0
    return sel, ti, zi

def _read(ds, v, sel, g, rows, cols):
    """Physical values on (ascending latitude, display longitude) for the requested window."""
    latdim, londim = v['spatial']; arr = ds[v['name']].isel(sel)
    jy = g.yorder[rows]; ix = g.xorder[cols]
    jlo, jhi = int(jy.min()), int(jy.max()); ilo, ihi = int(ix.min()), int(ix.max())
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        block = arr.isel({latdim: slice(jlo, jhi + 1), londim: slice(ilo, ihi + 1)}).transpose(latdim, londim).values
    a = _runs(_runs(np.asarray(block, dtype=np.float32), jy - jlo, 0), ix - ilo, 1)
    if not a.flags.writeable or a.base is not None: a = a.copy()
    a[~np.isfinite(a) | (np.abs(a) > 1e30)] = np.nan
    if v.get('scale', 1.0) != 1.0: a *= np.float32(v['scale'])  # velocity in cm/s, kn ... → m/s
    return a

def _runs(a, idx, axis):
    """a.take(idx, axis) using contiguous slices (rotated longitudes, reversed latitudes) instead of a gather."""
    n = a.shape[axis]
    if idx.size == n and idx[0] == 0 and idx[-1] == n - 1 and np.all(np.diff(idx) == 1): return a
    if idx.size == n and idx[0] == n - 1 and np.all(np.diff(idx) == -1): return np.flip(a, axis)
    breaks = np.flatnonzero(np.diff(idx) != 1) + 1
    if breaks.size > 8: return np.take(a, idx, axis=axis)
    parts = [a[(slice(None),) * axis + (slice(int(r[0]), int(r[-1]) + 1),)] for r in np.split(idx, breaks)]
    return parts[0] if len(parts) == 1 else np.concatenate(parts, axis=axis)

def _factor(ny, nx, max_cells):
    return max(1, int(math.ceil(math.sqrt(ny * nx / max(1, max_cells)))))

def _block(a, fy, fx, circular=False):
    if fy == 1 and fx == 1: return a
    if circular:
        rad = np.deg2rad(a); s = _block(np.sin(rad), fy, fx); c = _block(np.cos(rad), fy, fx)
        return ((np.rad2deg(np.arctan2(s, c)) + 360) % 360).astype(np.float32)
    ny, nx = a.shape; py, px = (-ny) % fy, (-nx) % fx
    shape = ((ny + py) // fy, fy, (nx + px) // fx, fx)
    b = (np.pad(a, ((0, py), (0, px)), constant_values=np.nan) if py or px else a).reshape(shape)
    valid = np.isfinite(b); count = valid.sum(axis=(1, 3), dtype=np.int32)
    total = np.nansum(b, axis=(1, 3), dtype=np.float32)
    if py or px:
        cells = np.full(count.shape, fy * fx, np.int32)
        if py: cells[-1, :] = (fy - py) * fx
        if px: cells[:, -1] = cells[:, -1] // fx * (fx - px)
    else: cells = fy * fx
    # A display cell is defined only when at least half of its source cells are; keeps coastlines in place.
    with np.errstate(invalid='ignore', divide='ignore'):
        out = np.where(count * 2 >= cells, total / np.maximum(count, 1), np.nan)
    return out.astype(np.float32)

def _coords(x, f):
    if f == 1: return x
    p = (-x.size) % f
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        return np.nanmean(np.pad(x.astype(float), (0, p), constant_values=np.nan).reshape(-1, f), axis=1)

def _stats(a):
    good = a[np.isfinite(a)]
    if not good.size: return {'min': None, 'max': None, 'mean': None, 'p02': None, 'p98': None, 'valid': 0}
    sample = good if good.size <= 400000 else good[:: int(math.ceil(good.size / 400000))]
    p02, p98 = np.percentile(sample, [2, 98])
    return {'min': float(good.min()), 'max': float(good.max()), 'mean': float(good.mean()), 'p02': float(p02), 'p98': float(p98), 'valid': int(good.size)}

_field_cache: 'OrderedDict[tuple, bytes]' = OrderedDict(); _field_bytes = [0]
FIELD_CACHE_BYTES = 320 * 1024 ** 2

def _window(g, bbox):
    if not bbox:
        cols, xs = g.columns(); return g.rows(), cols, xs
    w, s, e, n = bbox; cols, xs = g.columns(w, e)
    return g.rows(s, n), cols, xs

def field(path, provider, names, time=None, depth=None, bbox=None, max_cells=1_000_000, time_index=None, depth_index=None):
    """Binary map slice: 4-byte little-endian header length, JSON header, float32 arrays (row-major, south→north)."""
    p = Path(path); max_cells = int(np.clip(max_cells, 2_000, 4_000_000))
    key = (str(p), p.stat().st_mtime_ns, provider, tuple(names), time, depth, time_index, depth_index,
           tuple(round(float(x), 3) for x in bbox) if bbox else None, max_cells)
    with LOCK:
        if key in _field_cache:
            data = _field_cache.pop(key); _field_cache[key] = data; return data
        info, ds, g = _context(p, provider)
        variables = [_variable(info, n) for n in names]
        if len({tuple(v['spatial']) for v in variables}) > 1: raise ValueError('所选变量不在同一网格上')
        rows, cols, xs = _window(g, bbox)
        f = _factor(rows.size, cols.size, max_cells)
        out, meta, picked = [], [], {}
        for v in variables:
            sel, ti, zi = _selection(ds, info, v, time, depth, time_index, depth_index)
            a = _block(_read(ds, v, sel, g, rows, cols), f, f, circular=v['kind'] == 'wave_direction')
            out.append(a); meta.append({'name': v['name'], 'units': v['units'], 'kind': v['kind'], 'label': v['label'], 'stats': _stats(a)})
            if ti is not None and 'time' not in picked: picked.update(time=info['times'][v['time_axis']][ti], time_index=ti)
            if zi is not None and 'depth' not in picked: picked.update(depth=info['depths'][v['depth_axis']]['values'][zi], depth_index=zi)
        x = _coords(xs.astype(float), f); y = _coords(g.y[rows], f)
        dx = float(np.median(np.diff(x))) if x.size > 1 else g.step * f; dy = float(np.median(np.diff(y))) if y.size > 1 else g.ystep * f
        header = {'variables': meta, 'nx': int(x.size), 'ny': int(y.size), 'lon': [round(float(v), 5) for v in x], 'lat': [round(float(v), 5) for v in y],
                  'bounds': [float(x[0] - dx / 2), float(max(-90, y[0] - dy / 2)), float(x[-1] + dx / 2), float(min(90, y[-1] + dy / 2))],
                  'dx': dx, 'dy': dy, 'factor': f, 'source_shape': [int(rows.size), int(cols.size)], 'global': bool(g.global_x and not bbox),
                  'time': picked.get('time'), 'time_index': picked.get('time_index'), 'depth': picked.get('depth'), 'depth_index': picked.get('depth_index')}
        raw = json.dumps(header, separators=(',', ':')).encode(); raw += b' ' * ((-len(raw)) % 4)
        data = struct.pack('<I', len(raw)) + raw + b''.join(np.ascontiguousarray(a, dtype='<f4').tobytes() for a in out)
        _field_cache[key] = data; _field_bytes[0] += len(data)
        while _field_bytes[0] > FIELD_CACHE_BYTES and len(_field_cache) > 1:
            _field_bytes[0] -= len(_field_cache.popitem(last=False)[1])
        return data
# ---------------------------------------------------------------- point / series / profile
def _bilinear(box, fx, fy, nearest_only=False):
    """box (..., 2, 2) indexed [j, i]. Bilinear where all four neighbours exist, else nearest valid neighbour."""
    w = np.array([[(1 - fx) * (1 - fy), fx * (1 - fy)], [(1 - fx) * fy, fx * fy]])
    flat = box.reshape(box.shape[:-2] + (4,)); wf = w.reshape(4); ok = np.isfinite(flat)
    full = ok.all(axis=-1) & (not nearest_only)
    with np.errstate(invalid='ignore'):
        bil = np.where(full, (np.where(ok, flat, 0) * wf).sum(axis=-1), np.nan)
    order = np.argsort(-wf); near = np.full(flat.shape[:-1], np.nan)
    for k in order[::-1]: near = np.where(ok[..., k], flat[..., k], near)
    value = np.where(full, bil, near)
    method = np.where(full, 'bilinear', np.where(np.isfinite(near), 'nearest', 'missing'))
    return value, method

def _corner_read(ds, v, sel, g, loc, lead=None):
    (i0, i1, fx), (j0, j1, fy) = loc; latdim, londim = v['spatial']
    jj = [int(g.yorder[j0]), int(g.yorder[j1])]; ii = [int(g.xorder[i0]), int(g.xorder[i1])]
    arr = ds[v['name']].isel(sel).isel({latdim: jj, londim: ii})
    order = ([lead] if lead else []) + [latdim, londim]
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        a = np.asarray(arr.transpose(*order).values, dtype=float)
    a[~np.isfinite(a) | (np.abs(a) > 1e30)] = np.nan
    if v.get('scale', 1.0) != 1.0: a *= v['scale']
    return _bilinear(a, fx, fy, nearest_only=v['kind'] == 'wave_direction')

def point(path, provider, lon, lat, time=None, depth=None, names=None, series=False, profile=False):
    with LOCK:
        info, ds, g = _context(Path(path), provider)
        loc = g.locate(float(lon), float(lat))
        result = {'lon': float(lon), 'lat': float(lat), 'inside': loc is not None, 'values': [], 'series': [], 'profiles': []}
        if loc is None: return result
        (i0, i1, fx), (j0, j1, fy) = loc
        result['grid_point'] = {'lon': float(((g.x[i0 if fx < .5 else i1] + 180) % 360) - 180), 'lat': float(g.y[j0 if fy < .5 else j1])}
        variables = [v for v in info['variables'] if v['mapable'] and (not names or v['name'] in names)]
        for v in variables:
            sel, ti, zi = _selection(ds, info, v, time, depth)
            value, method = _corner_read(ds, v, sel, g, loc)
            item = {'name': v['name'], 'label': v['label'], 'units': v['units'], 'kind': v['kind'],
                    'value': float(value) if np.isfinite(value) else None, 'method': str(method)}
            if ti is not None: item['time'] = info['times'][v['time_axis']][ti]
            if zi is not None: item['depth'] = info['depths'][v['depth_axis']]['values'][zi]
            result['values'].append(item)
        if series:
            for v in variables[:8]:
                times = info['times'].get(v['time_axis']) or []
                if not v['time_dim'] or len(times) < 2: continue
                sel, _, _ = _selection(ds, info, v, time, depth); sel.pop(v['time_dim'], None)
                n = min(len(times), 3000); sel[v['time_dim']] = slice(0, n)
                values, _ = _corner_read(ds, v, sel, g, loc, lead=v['time_dim'])
                result['series'].append({'name': v['name'], 'units': v['units'], 'kind': v['kind'], 'times': times[:n],
                                         'values': [float(x) if np.isfinite(x) else None for x in np.atleast_1d(values)]})
        if profile:
            for v in variables[:8]:
                z = info['depths'].get(v['depth_axis']) if v['depth_axis'] else None
                if not z or len(z['values']) < 2: continue
                sel, _, _ = _selection(ds, info, v, time, depth); sel.pop(v['depth_dim'], None)
                values, _ = _corner_read(ds, v, sel, g, loc, lead=v['depth_dim'])
                result['profiles'].append({'name': v['name'], 'units': v['units'], 'kind': v['kind'], 'depth': z['values'], 'depth_units': z['units'],
                                           'values': [float(x) if np.isfinite(x) else None for x in np.atleast_1d(values)]})
        return result

# ---------------------------------------------------------------- vertical sections
def sample_line(line, n):
    """n points equally spaced in distance along a polyline of [lon, lat] vertices, great-circle within each segment.
    Returns lon, lat (degrees, lon in [-180, 180)), distance_km from the first vertex."""
    pts = np.radians(np.asarray(line, float)); R = 6371.0088
    if pts.ndim != 2 or len(pts) < 2: raise ValueError('断面线至少需要两个点')
    xyz = np.stack([np.cos(pts[:, 1]) * np.cos(pts[:, 0]), np.cos(pts[:, 1]) * np.sin(pts[:, 0]), np.sin(pts[:, 1])], 1)
    seg = np.arccos(np.clip((xyz[:-1] * xyz[1:]).sum(1), -1, 1)); cum = np.concatenate([[0], np.cumsum(seg)])
    if cum[-1] <= 0: raise ValueError('断面线长度为零')
    d = np.linspace(0, cum[-1], int(n)); k = np.clip(np.searchsorted(cum, d, side='right') - 1, 0, len(seg) - 1)
    out = []
    for di, ki in zip(d, k):
        om = seg[ki]; t = (di - cum[ki]) / om if om > 0 else 0.0
        a, b = (np.sin((1 - t) * om) / np.sin(om), np.sin(t * om) / np.sin(om)) if om > 1e-12 else (1 - t, t)
        p = a * xyz[ki] + b * xyz[ki + 1]; p /= np.linalg.norm(p); out.append(p)
    out = np.array(out); lat = np.degrees(np.arcsin(np.clip(out[:, 2], -1, 1))); lon = (np.degrees(np.arctan2(out[:, 1], out[:, 0])) + 180) % 360 - 180
    return lon, lat, d * R

def section(path, provider, names, line, time=None, n=200):
    """Vertical section along a polyline: real model levels only (no invented layers). values[var][depth][point];
    bilinear per level (nearest valid corner at coasts, null on land / below the sea floor / outside the grid)."""
    n = int(np.clip(n, 10, 600)); lon, lat, dist = sample_line(line, n)
    with LOCK:
        info, ds, g = _context(Path(path), provider)
        out = {'lon': lon.round(4).tolist(), 'lat': lat.round(4).tolist(), 'distance_km': dist.round(3).tolist(), 'variables': []}
        for name in names:
            v = _variable(info, name); z = info['depths'].get(v['depth_axis']) if v['depth_axis'] else None
            if not z or len(z['values']) < 2: raise ValueError(f'{name} 只有单层，无法生成垂向断面')
            sel, ti, _ = _selection(ds, info, v, time, None); sel.pop(v['depth_dim'], None)
            nz = len(z['values']); vals = np.full((nz, n), np.nan); method = np.zeros(n, np.int8)
            for i in range(n):
                loc = g.locate(float(lon[i]), float(lat[i]))
                if loc is None: continue
                col, how = _corner_read(ds, v, sel, g, loc, lead=v['depth_dim']); col = np.atleast_1d(col)
                vals[:col.size, i] = col; method[i] = 1 if np.any(np.atleast_1d(how) == 'bilinear') else 2 if np.isfinite(col).any() else 3
            out['variables'].append({'name': name, 'units': v['units'], 'kind': v['kind'], 'label': v['label'], 'depth': [float(x) for x in z['values']],
                                     'depth_units': z['units'], 'positive': z['positive'],
                                     'time': info['times'][v['time_axis']][ti] if ti is not None else None,
                                     'values': [[float(x) if np.isfinite(x) else None for x in row] for row in vals],
                                     'cline': _cline(vals, np.asarray(z['values'], float))})
        out['outside'] = int((method == 0).sum())
        return out

def _cline(vals, z):
    """Depth of the strongest vertical gradient per column (thermocline / halocline proxy), and its median along the section.
    Method: |Δvalue/Δz| between adjacent real levels, deepest 10 % excluded; columns with < 3 valid levels skipped."""
    zz = np.abs(z); res = []
    for col in vals.T:
        ok = np.isfinite(col)
        if ok.sum() < 3: res.append(None); continue
        c, d = col[ok], zz[ok]; g = np.abs(np.diff(c) / np.diff(d)); mid = (d[1:] + d[:-1]) / 2
        keep = mid <= np.quantile(d, 0.9) if d.size > 5 else np.ones_like(mid, bool)
        if not keep.any(): res.append(None); continue
        k = int(np.argmax(np.where(keep, g, -1))); res.append({'depth': float(mid[k]), 'gradient': float(g[k])})
    ds_ = [r['depth'] for r in res if r]
    return {'per_point': res, 'median_depth': float(np.median(ds_)) if ds_ else None,
            'method': '相邻真实层间 |Δ值/Δz| 最大处（排除最深 10% 层），逐列计算'}

# ---------------------------------------------------------------- region statistics
def _weighted(a, lat, circular=False):
    w = np.broadcast_to(np.cos(np.deg2rad(lat))[:, None], a.shape); ok = np.isfinite(a)
    if not ok.any(): return None
    wv = w[ok]; av = a[ok].astype(float)
    if circular:  # directions in degrees: weighted vector mean, circular std, shortest arc spanning the values
        rad = np.deg2rad(av); S = float((np.sin(rad) * wv).sum() / wv.sum()); C = float((np.cos(rad) * wv).sum() / wv.sum())
        R = min(1.0, math.hypot(S, C)); mean = (math.degrees(math.atan2(S, C)) + 360) % 360
        srt = np.sort(av % 360); gaps = np.diff(np.append(srt, srt[0] + 360)); k = int(np.argmax(gaps))
        lo, hi = float(srt[(k + 1) % srt.size]), float(srt[k])
        return {'mean': mean, 'std': float(math.degrees(math.sqrt(-2 * math.log(R)))) if R > 1e-12 else 180.0, 'min': lo, 'max': hi,
                'resultant': R, 'circular': True, 'valid_fraction': float(ok.mean()), 'cells': int(ok.sum())}
    mean = float((av * wv).sum() / wv.sum())
    return {'mean': mean, 'std': float(math.sqrt(max(0.0, (wv * (av - mean) ** 2).sum() / wv.sum()))), 'min': float(av.min()), 'max': float(av.max()),
            'valid_fraction': float(ok.mean()), 'cells': int(ok.sum())}

def _region_values(ds, info, g, variables, sel_args, rows, cols, f):
    parts = []
    for v in variables:
        sel, ti, zi = _selection(ds, info, v, *sel_args)
        parts.append(_block(_read(ds, v, sel, g, rows, cols), f, f, circular=v['kind'] == 'wave_direction'))
    return np.hypot(parts[0], parts[1]) if len(parts) == 2 else parts[0]

def region(path, provider, names, bbox, time=None, depth=None, series=False):
    if not bbox: raise ValueError('请提供区域范围')
    if not 1 <= len(names) <= 2: raise ValueError('区域统计需要 1 个标量或 1 组 U/V 分量')
    with LOCK:
        info, ds, g = _context(Path(path), provider)
        variables = [_variable(info, n) for n in names]
        # exact selection: only cell centres inside the box (no rendering pad, no nearest-cell fallback)
        w, s, e, n = bbox; cols, _ = g.columns(w, e, strict=True); rows = g.rows(s, n, strict=True)
        circ = len(names) == 1 and variables[0]['kind'] == 'wave_direction'
        result = {'bbox': bbox, 'variables': names, 'magnitude': len(names) == 2, 'units': variables[0]['units'], 'factor': 1,
                  'cells': int(rows.size * cols.size), 'stats': None, 'histogram': None, 'series': None, 'circular': circ,
                  'selection': '格点中心位于区域内（闭区间），cos(纬度) 面积加权' + ('；方向为加权圆均值' if circ else '')}
        if rows.size < 1 or cols.size < 1: result['note'] = '区域内没有格点中心'; return result
        f = _factor(rows.size, cols.size, 400_000); lat = _coords(g.y[rows], f); result['factor'] = f
        a = _region_values(ds, info, g, variables, (time, depth), rows, cols, f)
        stats = _weighted(a, lat, circ); result['stats'] = stats
        if stats and not circ and stats['max'] > stats['min']:
            counts, edges = np.histogram(a[np.isfinite(a)], bins=24, range=(stats['min'], stats['max']))
            result['histogram'] = {'counts': counts.tolist(), 'edges': [float(e) for e in edges]}
        v0 = variables[0]; times = info['times'].get(v0['time_axis']) or []
        if series and v0['time_dim'] and len(times) > 1:
            idx = np.unique(np.linspace(0, len(times) - 1, min(len(times), 60)).round().astype(int))
            fs = _factor(rows.size, cols.size, 120_000); lats = _coords(g.y[rows], fs); out = []
            zi = _selection(ds, info, v0, time, depth)[2]
            for ti in idx:
                st = _weighted(_region_values(ds, info, g, variables, (None, None, int(ti), zi), rows, cols, fs), lats, circ)
                out.append({'time': times[ti], 'mean': st['mean'] if st else None, 'min': st['min'] if st else None, 'max': st['max'] if st else None})
            result['series'] = {'points': out, 'sampled_steps': int(idx.size), 'total_steps': len(times)}
        return result
