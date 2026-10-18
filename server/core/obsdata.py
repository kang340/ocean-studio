"""Normalised access to downloaded in-situ observation exports (ERDDAP CSV / JSON / row NetCDF).

Nothing is interpolated or filled. Every record keeps its raw value and raw QC flag; a QC class
(good / probably_good / suspect / bad / missing / none) is derived from the file's own
`flag_values` / `flag_meanings` when available, otherwise from the documented convention of
the product family (Argo, PMEL GTMBA, WOCE/CCHDO, GDP). Unknown schemes are reported as such.
"""
from __future__ import annotations
import json, math, re, threading
from collections import OrderedDict
from pathlib import Path
import numpy as np
import pandas as pd

LOCK = threading.RLock()
_cache: 'OrderedDict[tuple, dict]' = OrderedDict()

# ---------------------------------------------------------------- platform families
FAMILIES = [  # (dataset id pattern, platform type, structure, label)
    (r'^ArgoFloats', 'argo', 'profile', 'Argo 剖面浮标'),  # includes the ArgoFloats_OSMC mirror
    (r'^MEOP', 'animal', 'profile', '动物搭载 CTD'),
    (r'^cchdo', 'ship_ctd', 'profile', '船测 CTD / 采水'),
    (r'^drifter', 'drifter', 'trajectory', 'GDP 漂流浮标'),
    (r'^pmelTao', 'mooring', 'timeseries', '热带锚系浮标'),
    (r'rqds|Tide|tide', 'tide_gauge', 'timeseries', '潮位站'),
    (r'^IWaveB', 'wave_buoy', 'timeseries', '波浪浮标'),
    (r'^IWB', 'met_buoy', 'timeseries', '海洋气象浮标'),
    (r'^OSMC', 'mixed', 'mixed', '多平台实时观测'),
]
PLATFORM_LABELS = {'argo': 'Argo 浮标', 'animal': '动物搭载', 'ship_ctd': '船测站位', 'drifter': '漂流浮标', 'mooring': '锚系浮标', 'tide_gauge': '潮位站',
                   'wave_buoy': '波浪浮标', 'met_buoy': '气象浮标', 'fixed': '固定平台', 'moving': '移动平台', 'unknown': '未知平台'}

def family(dataset):
    for pat, ptype, struct, label in FAMILIES:
        if re.search(pat, dataset or ''): return ptype, struct, label
    return 'unknown', 'timeseries', '观测数据'

# ---------------------------------------------------------------- variable semantics
ROLE_RULES = [  # regex on column name (case-insensitive) → kind
    (r'^(temp(_adjusted)?|ctd_temperature|sst|t_2[05]|t_20|seatemperature|sea_?temp.*|temperature)$', 'sea_temperature'),
    (r'^(psal(_adjusted)?|ctd_salinity|s_41|salinity|sss)$', 'salinity'),
    (r'^(windspd|ws_401|windspeed|wind_speed|wspd)$', 'wind_speed'),
    (r'^(wd_410|winddirection|wind_dir(ection)?|wdir)$', 'wind_direction'),
    (r'^(wu_422|wind_u|uwnd)$', 'wind_u'), (r'^(wv_423|wind_v|vwnd)$', 'wind_v'),
    (r'^(u_1205|ve|current_u|ucur)$', 'current_u'), (r'^(v_1206|vn|current_v|vcur)$', 'current_v'),
    (r'^(slp|atmp_pres|airpressure|pressure_msl|baro)$', 'pressure'),
    (r'^(wvht|significantwaveheight|swh|hs)$', 'wave_height'),
    (r'^(dpd|peakperiod|tp|waveperiod)$', 'wave_period'), (r'^(mwd|meanwavedirection|wavedirection)$', 'wave_direction'),
    (r'^(sea_level|water_level.*|tide)$', 'sea_level'),
    (r'^(at_21|airtemperature|air_temp|atmp)$', 'air_temperature'),
    (r'^(rn_485|rain|precip)$', 'precipitation'), (r'^(tx_442)$', 'stress_u'), (r'^(ty_443)$', 'stress_v'), (r'^(tau_440)$', 'stress'),
    (r'^(oxygen|doxy)$', 'oxygen'), (r'^(nitrate)$', 'nitrate'),
]
LABELS = {'sea_temperature': '海温', 'salinity': '盐度', 'wind_speed': '风速', 'wind_direction': '风向（来向）', 'wind_u': '风 U 分量', 'wind_v': '风 V 分量',
          'current_u': '流 U 分量', 'current_v': '流 V 分量', 'pressure': '海平面气压', 'wave_height': '有效波高', 'wave_period': '波周期',
          'wave_direction': '波向', 'sea_level': '水位', 'air_temperature': '气温', 'precipitation': '降水', 'stress_u': '风应力 U',
          'stress_v': '风应力 V', 'stress': '风应力', 'oxygen': '溶解氧', 'nitrate': '硝酸盐', 'generic': ''}
# Display unit conversions (source unit text → (display unit, factor, offset)); unknown units are kept as-is.
UNIT_CONV = {
    ('sea_temperature', 'kelvin'): ('°C', 1, -273.15), ('sea_temperature', 'k'): ('°C', 1, -273.15),
    ('air_temperature', 'kelvin'): ('°C', 1, -273.15), ('air_temperature', 'k'): ('°C', 1, -273.15),
    ('wind_speed', 'knots'): ('m/s', 0.514444, 0), ('wind_speed', 'kt'): ('m/s', 0.514444, 0),
    ('wave_height', 'cm'): ('m', 0.01, 0), ('sea_level', 'millimeters'): ('m', 0.001, 0), ('sea_level', 'mm'): ('m', 0.001, 0),
    ('current_u', 'cm/s'): ('m/s', 0.01, 0), ('current_v', 'cm/s'): ('m/s', 0.01, 0), ('pressure', 'pa'): ('hPa', 0.01, 0),
}
CANON_UNIT = {'sea_temperature': '°C', 'air_temperature': '°C', 'salinity': 'PSU', 'wind_speed': 'm/s', 'current_u': 'm/s', 'current_v': 'm/s',
              'wind_u': 'm/s', 'wind_v': 'm/s', 'pressure': 'hPa', 'wave_height': 'm', 'sea_level': 'm', 'wind_direction': '°', 'wave_direction': '°'}

def kind_of(name):
    n = name.lower()
    for pat, kind in ROLE_RULES:
        if re.match(pat, n): return kind
    return 'generic'

def conversion(kind, unit):
    u = (unit or '').strip().lower().replace('degree_', 'deg_')
    if (kind, u) in UNIT_CONV: return UNIT_CONV[(kind, u)]
    if kind in ('sea_temperature', 'air_temperature') and u in ('deg c', 'deg_celsius', 'deg_c', 'degree_c', 'degrees_c', 'celsius', 'c', '°c'): return ('°C', 1, 0)
    if kind == 'salinity' and u in ('psu', '1', '', 'pss-78', 'pss78'): return ('PSU', 1, 0)
    return (unit or CANON_UNIT.get(kind, ''), 1, 0)

# ---------------------------------------------------------------- QC schemes
QC_CLASSES = ['good', 'probably_good', 'suspect', 'bad', 'missing', 'none']
QC_LABELS = {'good': '正常', 'probably_good': '基本可信', 'suspect': '可疑', 'bad': '错误', 'missing': '缺测', 'none': '未质控 / 未知'}
ARGO = {0: 'none', 1: 'good', 2: 'probably_good', 3: 'suspect', 4: 'bad', 5: 'good', 8: 'probably_good', 9: 'missing'}
ARGO_TXT = {0: '未质控', 1: '良好', 2: '可能良好', 3: '可能错误（可校正）', 4: '错误', 5: '数值已修改', 8: '估算值', 9: '缺测'}
GTMBA = {0: 'missing', 1: 'good', 2: 'good', 3: 'good', 4: 'suspect', 5: 'bad'}
GTMBA_TXT = {0: '缺测', 1: '最高质量（前后标定一致）', 2: '默认质量（已应用布放前标定）', 3: '已订正', 4: '较低质量（未订正）', 5: '传感器故障'}

def _scheme_from_meanings(values, meanings):
    """Map file-declared flag meanings to QC classes by keyword."""
    vals = [v.strip() for v in str(values).replace(',', ' ').split() if v.strip()]
    toks = str(meanings).replace(',', ' ').split()
    if len(vals) != len(toks): return None
    out, txt = {}, {}
    for v, m in zip(vals, toks):
        try: key = int(float(v))
        except ValueError: continue
        t = m.lower().replace('-', '_')
        if 'estimate_in_range_uncertainty_in_range' in t: cls = 'good'                       # GDP flg_sst = 5
        elif 'estimate_in_range' in t: cls = 'probably_good'
        elif 'estimate_not_in_range_uncertainty_not_in_range' in t: cls = 'bad'
        elif 'not_in_range' in t: cls = 'suspect'
        elif any(k in t for k in ('not_reported', 'not_sampled', 'missing', 'no_estimate')): cls = 'missing'
        elif any(k in t for k in ('no_flag', 'no_qc', 'not_evaluated', 'unknown', 'no_uncertainty')): cls = 'none'
        elif any(k in t for k in ('bad', 'fail', 'wrong', 'spike', 'did_not_trip', 'leaking')): cls = 'bad'
        elif any(k in t for k in ('question', 'doubt', 'suspect', 'not_calibrated', 'discrepancy')): cls = 'suspect'
        elif any(k in t for k in ('interpolat', 'despik', 'estimat', 'probably_good', 'changed')): cls = 'probably_good'
        elif any(k in t for k in ('good', 'acceptable', 'no_problems', 'pass')): cls = 'good'
        else: cls = 'none'
        out[key] = cls; txt[key] = m.replace('_', ' ')
    return out or None, txt

def qc_scheme(dataset, qc_name, meta):
    """(class map, text map, scheme label) for a QC column."""
    a = (meta or {}).get(qc_name, {}); a = a.get('attrs', a) if isinstance(a, dict) else {}
    if a.get('flag_values') is not None and a.get('flag_meanings'):
        r = _scheme_from_meanings(a['flag_values'], a['flag_meanings'])
        if r and r[0]: return r[0], r[1], '文件声明的 flag_meanings'
    if (dataset or '').startswith('pmelTao') or re.match(r'^Q[A-Z]+_5\d+$', qc_name):
        return GTMBA, GTMBA_TXT, 'PMEL GTMBA 质量码（0 缺测 … 5 传感器故障）'
    if re.match(r'^(ArgoFloats|MEOP)', dataset or ''): return ARGO, ARGO_TXT, 'Argo 参考表 2（QC 0–9）'
    return None, {}, a.get('comment') or '来源未提供可解析的质控码定义（原样显示，不参与筛选）'

def _qc_column(var, columns):
    """QC column paired with a value column: Argo/CCHDO `x_qc`, PMEL `NAME_CODE` → `QNAME_5CODE`, UHSLC `quality`, GDP `flg_sst`."""
    cands = [var + '_qc', var + '_QC', var.lower() + '_qc', var.upper() + '_QC']
    m = re.match(r'^([A-Za-z]+)_(\d+)$', var)
    if m: cands.append(f'Q{m.group(1).upper()}_5{m.group(2)[-3:].zfill(3)}')
    if var == 'sea_level': cands.append('quality')
    if var == 'sst': cands.append('flg_sst')
    return next((c for c in cands if c in columns), None)

# ---------------------------------------------------------------- loading
NUMERIC_SKIP = {'time', 'latitude', 'longitude'}

def _read(path, request):
    fmt = request.get('format'); p = Path(path)
    if fmt == 'csv':
        with p.open(encoding='utf-8-sig') as f: names = f.readline().strip().split(','); units = f.readline().strip().split(',')
        # identifiers keep their exact text (WMO / platform codes such as 00106686)
        ids = {c: str for c in names if c in ('platform_code', 'platform_number', 'PLATFORM_NUMBER', 'station_id', 'station', 'ID', 'expocode', 'uhslc_id', 'profile_id', 'station_name', 'cast', 'array', 'data_mode', 'direction')}
        df = pd.read_csv(p, skiprows=[1], low_memory=False, encoding='utf-8-sig', dtype=ids, keep_default_na=False, na_values=['', 'NaN', 'nan', 'NA'])
        unit_map = dict(zip(names, units))
    elif fmt == 'json':
        t = json.loads(p.read_text(encoding='utf-8'))['table']
        df = pd.DataFrame(t['rows'], columns=t['columnNames']).astype({c: str for c in t['columnNames'] if c in ('station', 'platform_code', 'station_id', 'ID')}); unit_map = dict(zip(t['columnNames'], t.get('columnUnits', [])))
    else:
        import xarray as xr
        with xr.open_dataset(p) as ds:
            dim = next(iter(ds.dims)); df = ds.to_dataframe().reset_index()
            unit_map = {n: str(ds[n].attrs.get('units', '')) for n in ds.variables}
            for n in ds.variables:
                if n in df and df[n].dtype == object and hasattr(df[n].iloc[0], 'isoformat'): df[n] = [x.isoformat() for x in df[n]]
    return df, unit_map

def load(path, request):
    p = Path(path); key = (str(p), p.stat().st_mtime_ns)
    with LOCK:
        if key in _cache: _cache.move_to_end(key); return _cache[key]
        df, unit_map = _read(p, request)
        opts = request.get('options') or {}; dataset = request.get('dataset', '')
        ptype, struct, flabel = family(dataset)
        station = opts.get('station_field') or next((c for c in ('platform_code', 'platform_number', 'PLATFORM_NUMBER', 'station_id', 'station', 'ID', 'expocode', 'uhslc_id') if c in df), None)
        vertical = opts.get('vertical') or next((c for c in ('pres', 'PRES', 'pressure', 'depth') if c in df), None)
        if vertical and vertical not in df: vertical = None
        meta = opts.get('variable_metadata') or {}
        missing = {k: [float(x) for x in v] for k, v in (opts.get('missing_values') or {}).items()}
        n = len(df)
        t = pd.to_datetime(df['time'].astype(str).str.replace(' ', 'T'), utc=True, errors='coerce') if 'time' in df else pd.Series([pd.NaT] * n)
        lon = pd.to_numeric(df.get('longitude', pd.Series([np.nan] * n)), errors='coerce').to_numpy(float)
        lat = pd.to_numeric(df.get('latitude', pd.Series([np.nan] * n)), errors='coerce').to_numpy(float)
        lon = ((lon + 180) % 360) - 180
        sid = df[station].astype(str).to_numpy() if station else np.array(['全部观测'] * n)
        cycle_col = next((c for c in ('cycle_number', 'CYCLE_NUMBER', 'profile_id', 'cast') if c in df), None)
        identity = [c for c in (opts.get('identity') or []) if c in df]
        profile_key = None
        if struct == 'profile':
            parts = [sid] + [df[c].astype(str).to_numpy() for c in ([cycle_col] if cycle_col else identity)] + [t.astype(str).to_numpy()]
            profile_key = np.array(['·'.join(x) for x in zip(*parts)]) if len(parts) > 1 else sid
        excluded = {station, vertical, cycle_col, 'time', 'latitude', 'longitude', 'depth', 'array', 'direction', 'data_mode', 'platform_type', 'row', 'obs', 'index', *identity}
        variables = []
        for c in df.columns:
            if c in excluded or c.lower().endswith('_qc') or re.match(r'^(Q[A-Z]+_5\d+|S[A-Z]+_6\d+|quality|flg_\w+|err_\w+)$', c): continue
            vals = pd.to_numeric(df[c], errors='coerce')
            if vals.notna().sum() == 0: continue
            kind = kind_of(c); unit = unit_map.get(c, ''); disp, fac, off = conversion(kind, unit)
            raw = vals.to_numpy(float).copy()
            for mv in missing.get(c, []) + [-999999.0, 1e35, -99999.0, 9.96921e36]: raw[np.isclose(raw, mv)] = np.nan
            qc_col = _qc_column(c, df.columns)
            if not qc_col and c in ('WU_422', 'WV_423') and 'QWS_5401' in df: qc_col = 'QWS_5401'  # GTMBA: U/V share the wind-speed quality
            qmap, qtxt, qlabel = (qc_scheme(dataset, qc_col, meta) if qc_col else (None, {}, '来源未提供质控列'))
            qraw = pd.to_numeric(df[qc_col], errors='coerce').to_numpy(float) if qc_col else np.full(n, np.nan)
            cls = np.full(n, 'none', dtype=object)
            if qmap:
                for code, name in qmap.items(): cls[qraw == code] = name
            cls[~np.isfinite(raw)] = 'missing'
            variables.append({'name': c, 'kind': kind, 'label': LABELS.get(kind) or c, 'unit': unit, 'display_unit': disp, 'factor': fac, 'offset': off,
                              'qc_column': qc_col, 'qc_scheme': qlabel, 'qc_codes': {str(k): {'class': v, 'text': qtxt.get(k, '')} for k, v in (qmap or {}).items()},
                              'values': raw, 'display': raw * fac + off, 'qc_raw': qraw, 'qc': cls,
                              'valid': int(np.isfinite(raw).sum())})
        vert = None
        if vertical:
            vv = pd.to_numeric(df[vertical], errors='coerce').to_numpy(float); vunit = unit_map.get(vertical, '') or opts.get('vertical_units', '')
            is_pres = vertical.lower().startswith('pres') or vunit.lower() in ('decibar', 'dbar')
            vert = {'name': vertical, 'unit': vunit, 'is_pressure': is_pres, 'values': vv, 'depth_m': pres_to_depth(vv, lat) if is_pres else np.abs(vv)}
        # per-platform position change → fixed vs moving (OSMC mixes ships, drifters, buoys without a type column)
        ptypes = {}
        frame = pd.DataFrame({'s': sid, 'x': lon, 'y': lat})
        span = frame.groupby('s').agg(x0=('x', 'min'), x1=('x', 'max'), y0=('y', 'min'), y1=('y', 'max'))
        for s, r in span.iterrows():
            moving = (r.x1 - r.x0) + (r.y1 - r.y0) > 0.05
            ptypes[s] = ptype if ptype not in ('mixed', 'unknown') else ('moving' if moving else 'fixed')
        out = {'dataset': dataset, 'family': flabel, 'structure': struct, 'platform_type': ptype, 'station_field': station, 'n': n,
               'time': t, 'tnum': (t.astype('int64') // 10 ** 9).to_numpy() if n else np.array([]), 'lon': lon, 'lat': lat, 'sid': sid,
               'profile': profile_key, 'cycle_field': cycle_col, 'vertical': vert, 'variables': variables, 'ptypes': ptypes,
               'source': opts.get('source') or opts.get('catalog_source') or request.get('url', ''),
               'notes': _notes(dataset, struct, ptype, variables, opts)}
        out['tnum'] = np.where(t.isna().to_numpy(), -1, out['tnum']) if n else out['tnum']
        codes, names = pd.factorize(sid)  # integer platform codes keep per-platform queries vectorised
        out['pcode'] = codes.astype(np.int32); out['pnames'] = np.asarray(names, dtype=object)
        out['pmoving'] = np.array([ptypes.get(x) in ('drifter', 'moving', 'argo', 'animal') for x in names], bool)
        _cache[key] = out
        while len(_cache) > 6: _cache.popitem(last=False)
        return out

def _notes(dataset, struct, ptype, variables, opts):
    notes = []
    if ptype == 'mixed': notes.append('该产品未提供平台类型列：按记录位置是否变化区分“固定 / 移动平台”，不代表官方平台分类。')
    if struct == 'profile': notes.append('压力 dbar 按 UNESCO 1983（Fofonoff & Millard）公式换算深度，仅用于显示与匹配。')
    if any(v['kind'] == 'wind_speed' for v in variables) and ptype in ('mixed', 'fixed', 'moving'): notes.append('实测风速的测量高度因平台而异，未统一订正到 10 m。')
    if any(v['kind'] == 'sea_level' for v in variables): notes.append('潮位基准与模式海面高度（相对大地水准面 / 平均海面）不同，直接比较需先去除基准与平均值。')
    if opts.get('note'): notes.append(opts['note'])
    return notes

def pres_to_depth(p, lat):
    """UNESCO 1983 (Fofonoff & Millard) pressure (dbar) → depth (m)."""
    p = np.asarray(p, float); x = np.sin(np.deg2rad(np.asarray(lat, float))) ** 2
    g = 9.780318 * (1 + (5.2788e-3 + 2.36e-5 * x) * x) + 1.092e-6 * p
    return ((((-1.82e-15 * p + 2.279e-10) * p - 2.2512e-5) * p + 9.72659) * p) / g

def iso(ts):
    ts = int(ts)
    if ts < 0: return None
    import time as _t
    return _t.strftime('%Y-%m-%dT%H:%M:%SZ', _t.gmtime(ts))
def f(x, nd=5):
    try: x = float(x)
    except (TypeError, ValueError): return None
    return round(x, nd) if math.isfinite(x) else None

# ---------------------------------------------------------------- queries
GOOD_DEFAULT = ('good', 'probably_good', 'suspect', 'none')  # default excludes only bad / missing; "none" = source has no QC

def _var(o, name):
    v = next((x for x in o['variables'] if x['name'] == name), None)
    if not v: raise ValueError(f'变量不存在: {name}')
    return v

def _public_var(v):
    good = np.isfinite(v['display'])
    return {k: v[k] for k in ('name', 'kind', 'label', 'unit', 'display_unit', 'qc_column', 'qc_scheme', 'qc_codes', 'valid')} | {
        'min': f(np.nanmin(v['display'][good])) if good.any() else None, 'max': f(np.nanmax(v['display'][good])) if good.any() else None,
        'qc_counts': {k: int((v['qc'] == k).sum()) for k in QC_CLASSES}}

def summary(o):
    """Platforms, variables and the time histogram of one observation file."""
    df = pd.DataFrame({'s': o['sid'], 'x': o['lon'], 'y': o['lat'], 't': o['tnum']})
    df = df[np.isfinite(df.x) & np.isfinite(df.y)]
    g = df.sort_values('t').groupby('s', sort=False)
    last = g.tail(1).set_index('s'); first = g.head(1).set_index('s'); cnt = g.size()
    plats = [{'id': s, 'type': o['ptypes'].get(s, o['platform_type']), 'lon': f(last.x[s], 4), 'lat': f(last.y[s], 4), 'records': int(cnt[s]),
              't0': iso(first.t[s]), 't1': iso(last.t[s])} for s in cnt.index]
    t = o['tnum'][o['tnum'] >= 0]; hist = None
    if t.size:
        lo, hi = int(t.min()), int(t.max()); step = max(3600, int(np.ceil((hi - lo + 1) / 120 / 3600)) * 3600)
        edges = np.arange(lo - lo % 3600, hi + step + 1, step); counts, _ = np.histogram(t, edges)
        hist = {'start': iso(int(edges[0])), 'step_s': step, 'counts': counts.tolist()}
    profiles = int(len(set(o['profile']))) if o['profile'] is not None else 0
    types = {}
    for p in plats: types[p['type']] = types.get(p['type'], 0) + 1
    return {'dataset': o['dataset'], 'family': o['family'], 'structure': o['structure'], 'platform_type': o['platform_type'], 'records': o['n'],
            'platform_count': len(plats), 'types': [{'id': k, 'label': PLATFORM_LABELS.get(k, k), 'count': v} for k, v in types.items()],
            'profiles': profiles, 'time': [iso(int(t.min())), iso(int(t.max()))] if t.size else [], 'histogram': hist,
            'bounds': [f(df.x.min()), f(df.y.min()), f(df.x.max()), f(df.y.max())] if len(df) else None,
            'vertical': {k: o['vertical'][k] for k in ('name', 'unit', 'is_pressure')} if o['vertical'] else None,
            'variables': [_public_var(v) for v in o['variables']], 'qc_classes': QC_LABELS, 'notes': o['notes'], 'source': o['source'],
            'platforms': plats[:6000]}

def _window(o, t0, t1):
    m = np.isfinite(o['lon']) & np.isfinite(o['lat'])
    if t0: m &= o['tnum'] >= pd.Timestamp(t0).timestamp()
    if t1: m &= (o['tnum'] <= pd.Timestamp(t1).timestamp()) & (o['tnum'] >= 0)
    return m

def qc_mask(v, qc):
    ok = np.isfinite(v['display'])
    if qc == 'default': ok &= np.isin(v['qc'], GOOD_DEFAULT)
    elif qc == 'good': ok &= np.isin(v['qc'], ('good', 'probably_good'))
    return ok

def features(o, var=None, t0=None, t1=None, qc='default', depth_max=None):
    """Latest valid value per platform inside the window (map points) and thinned tracks of moving platforms."""
    m = _window(o, t0, t1); v = _var(o, var) if var else None
    m_val = m & qc_mask(v, qc) if v is not None else m.copy()
    if o['vertical'] is not None and depth_max is not None: m_val &= o['vertical']['depth_m'] <= float(depth_max) + 1e-6
    idx = np.flatnonzero(m_val)
    if o['vertical'] is not None and idx.size:  # profiles: shallowest valid level of the latest profile per platform
        order = np.lexsort((o['vertical']['depth_m'][idx], -o['tnum'][idx], o['pcode'][idx]))
    else: order = np.lexsort((-o['tnum'][idx], o['pcode'][idx]))
    idx = idx[order]; s = o['pcode'][idx]
    first = np.concatenate([[True], s[1:] != s[:-1]]) if idx.size else np.array([], bool)
    pick = idx[first]
    pts = {'id': o['sid'][pick].tolist(), 'lon': np.round(o['lon'][pick], 4).tolist(), 'lat': np.round(o['lat'][pick], 4).tolist(),
           'time': [iso(x) for x in o['tnum'][pick]], 'type': [o['ptypes'].get(x, o['platform_type']) for x in o['pnames'][o['pcode'][pick]]],
           'value': [f(x, 4) for x in v['display'][pick]] if v is not None else None, 'qc': v['qc'][pick].tolist() if v is not None else None}
    tracks = []
    mm = np.flatnonzero(m & o['pmoving'][o['pcode']])
    if mm.size:
        mm = mm[np.lexsort((o['tnum'][mm], o['pcode'][mm]))]; pc = o['pcode'][mm]
        for part in np.split(mm, np.flatnonzero(pc[1:] != pc[:-1]) + 1):
            tt = o['tnum'][part]; part = part[np.concatenate([[True], np.diff(tt) != 0])]  # profiles repeat lon/lat per level
            if part.size < 2: continue
            part = part[::max(1, int(np.ceil(part.size / 240)))]; name = o['pnames'][o['pcode'][part[0]]]
            tracks.append({'id': str(name), 'type': o['ptypes'].get(name, o['platform_type']), 'lon': np.round(o['lon'][part], 4).tolist(),
                           'lat': np.round(o['lat'][part], 4).tolist(), 't': o['tnum'][part].astype(int).tolist()})
    return {'points': pts, 'tracks': tracks[:3000], 'variable': _public_var(v) if v is not None else None, 'window': [t0, t1], 'count': int(pick.size)}

def haversine(lon1, lat1, lon2, lat2):
    r = np.deg2rad; dl = r(np.asarray(lon2) - lon1); dp = r(np.asarray(lat2) - lat1)
    a = np.sin(dp / 2) ** 2 + np.cos(r(lat1)) * np.cos(r(lat2)) * np.sin(dl / 2) ** 2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))

def platform(o, pid):
    """All raw records of one platform with QC, track kinematics and (for profilers) grouped profiles."""
    idx = np.flatnonzero(o['sid'] == str(pid))
    if not idx.size: raise ValueError('平台不存在')
    vert = o['vertical']['values'][idx] if o['vertical'] is not None else np.zeros(idx.size)
    idx = idx[np.lexsort((vert, o['tnum'][idx]))]
    ptype = o['ptypes'].get(str(pid), o['platform_type'])
    out = {'id': str(pid), 'type': ptype, 'type_label': PLATFORM_LABELS.get(ptype, ''), 'family': o['family'], 'structure': o['structure'],
           'records': int(idx.size), 'source': o['source'], 'notes': o['notes'], 'time': [iso(x) for x in o['tnum'][idx]],
           'lon': np.round(o['lon'][idx], 5).tolist(), 'lat': np.round(o['lat'][idx], 5).tolist(), 'variables': [], 'qc_classes': QC_LABELS}
    for v in o['variables']:
        if not np.isfinite(v['values'][idx]).any(): continue
        out['variables'].append(_public_var(v) | {'raw': [f(x, 6) for x in v['values'][idx]], 'display_values': [f(x, 6) for x in v['display'][idx]],
                                                 'qc_raw': [f(x, 0) for x in v['qc_raw'][idx]], 'qc': v['qc'][idx].tolist()})
    if o['vertical'] is not None:
        vv = o['vertical']
        out['vertical'] = {'name': vv['name'], 'unit': vv['unit'], 'is_pressure': vv['is_pressure'],
                           'values': [f(x, 3) for x in vv['values'][idx]], 'depth_m': [f(x, 2) for x in vv['depth_m'][idx]]}
    if o['vertical'] is not None and o['profile'] is not None:
        keys = o['profile'][idx]; groups = []
        for k in dict.fromkeys(keys):
            j = np.flatnonzero(keys == k)
            groups.append({'key': str(k), 'rows': j.tolist(), 'time': out['time'][j[0]], 'lon': out['lon'][j[0]], 'lat': out['lat'][j[0]],
                           'cycle': str(k).split('·')[1] if '·' in str(k) else None, 'levels': int(j.size)})
        out['profiles'] = groups
    t = o['tnum'][idx]; fx = idx[np.concatenate([[True], np.diff(t) != 0])] if idx.size else idx  # distinct fixes; never interpolate gaps
    if fx.size >= 2:
        lon, lat, tt = o['lon'][fx], o['lat'][fx], o['tnum'][fx].astype(float)
        dist = haversine(lon[:-1], lat[:-1], lon[1:], lat[1:]); dt = np.diff(tt)
        with np.errstate(invalid='ignore', divide='ignore'): spd = np.where(dt > 0, dist * 1000 / dt, np.nan)
        p1, p2, dl = np.deg2rad(lat[:-1]), np.deg2rad(lat[1:]), np.deg2rad(lon[1:] - lon[:-1])
        brg = (np.rad2deg(np.arctan2(np.sin(dl) * np.cos(p2), np.cos(p1) * np.sin(p2) - np.sin(p1) * np.cos(p2) * np.cos(dl))) + 360) % 360
        med = float(np.nanmedian(dt))
        limit = {'drifter': 3.0, 'argo': 3.0, 'animal': 4.0}.get(ptype, 15.0)  # m/s; faster fix-to-fix moves are physically implausible
        out['track'] = {'time': [iso(x) for x in tt.astype(int)], 'lon': np.round(lon, 5).tolist(), 'lat': np.round(lat, 5).tolist(),
                        'speed_ms': [f(x, 3) for x in spd], 'bearing': [f(x, 1) for x in brg], 'dt_s': [int(x) for x in dt], 'dist_km': [f(x, 3) for x in dist],
                        'gap': (dt > max(3 * med, 6 * 3600)).tolist(), 'jump': (np.nan_to_num(spd) > limit).tolist(), 'median_dt_s': med, 'speed_limit_ms': limit}
    return out
