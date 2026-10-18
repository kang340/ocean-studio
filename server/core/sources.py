"""Per-element data-source status for Ocean Studio, from real task records and file descriptions only.

States: ready (renderable map data), downloaded_unrenderable, downloading, queued, retrying, timeout,
validation_failed, error, none (no task at all). Nothing here is inferred from the catalogue of possible providers.
"""
from __future__ import annotations
import re
import numpy as np
from core import gridview as gv
from core.variables import canonical

# element id → variable kinds that carry it (mirrors frontend/src/studio/elements.ts ELEMENTS[].kinds / vector)
ELEMENT_KINDS = {
    'sea_temperature': {'sea_temperature'}, 'salinity': {'salinity'}, 'current': {'current_u', 'current_v', 'current_speed'},
    'waves': {'wave_height', 'wave_period', 'wave_direction'}, 'wind': {'wind_u', 'wind_v', 'wind_speed'}, 'pressure': {'pressure'},
    'air_temperature': {'air_temperature'}, 'precipitation': {'precipitation'}, 'sea_ice': {'sea_ice'}, 'ssh': {'ssh'},
}
ACTIVE = {'queued': 'queued', 'resolving': 'queued', 'preparing': 'downloading', 'downloading': 'downloading', 'validating': 'downloading', 'retrying': 'retrying'}
RANK = {'ready': 0, 'downloading': 1, 'retrying': 2, 'queued': 3, 'downloaded_unrenderable': 4, 'validation_failed': 5, 'timeout': 6, 'error': 7}

# CDS / ERA5 request names that the decoded-name registry does not cover (official CDS variable identifiers)
CDS_REQUEST_KINDS = {'sea_surface_temperature': 'sea_temperature', 'significant_height_of_combined_wind_waves_and_swell': 'wave_height',
                     'mean_wave_direction': 'wave_direction', 'mean_wave_period': 'wave_period', 'peak_wave_period': 'wave_period',
                     'sea_ice_cover': 'sea_ice', 'mean_sea_level_pressure': 'pressure', 'total_precipitation': 'precipitation', '2m_temperature': 'air_temperature',
                     '10m_u_component_of_wind': 'wind_u', '10m_v_component_of_wind': 'wind_v'}

def requested_kinds(request):
    """Kinds a task was asked for (for tasks without a file yet)."""
    p = request.get('provider', 'custom'); out = set()
    for v in request.get('variables') or []:
        name = str(v).split(':')[0]
        if p == 'era5' and str(v) in CDS_REQUEST_KINDS: out.add(CDS_REQUEST_KINDS[str(v)]); continue
        out.add(gv.kind_of(name.lower(), {}, canonical(p, v) or canonical(p, name), p))
    return out

def failure_state(task):
    e = (task.get('error') or '').lower()
    if any(k in e for k in ('timeout', 'timed out', '超时', 'readtimeout', 'connecttimeout')): return 'timeout'
    if any(k in e for k in ('校验', 'sha256', 'verify', '数据集为空', '文件头', '空文件', 'validation')): return 'validation_failed'
    return 'error'

def spacing_hours(times):
    ts = []
    for t in times:
        try: ts.append(np.datetime64(str(t).rstrip('Z')[:19]).astype('datetime64[s]').astype(np.int64))
        except ValueError: pass
    d = np.diff(np.sort(np.unique(ts))) if len(ts) > 1 else np.array([])
    return round(float(np.median(d)) / 3600, 3) if d.size else None

def representativeness(dataset, spacing_h):
    s = str(dataset or '')
    if re.search(r'P1M|monthly|_mon', s, re.I): return 'monthly_mean'
    if re.search(r'P1D|daily|_day', s, re.I): return 'daily_mean'
    if re.search(r'PT1H|PT3H|PT6H|PT15M', s, re.I) or spacing_h is not None and spacing_h < 24: return 'instantaneous'
    return None  # unknown: not claimed

def file_meta(info, element):
    kinds = ELEMENT_KINDS[element]
    vs = [v for v in info['variables'] if v['kind'] in kinds]
    times = sorted({t for v in vs if v['time_axis'] for t in info['times'].get(v['time_axis'], [])})
    z = next((info['depths'][v['depth_axis']] for v in vs if v['depth_axis']), None)
    g = info['grid']
    grid_type = 'regular_latlon' if g else ('curvilinear' if any('曲线' in (v.get('reason') or '') for v in info['variables']) else 'points')
    return {'variables': [{'name': v['name'], 'kind': v['kind'], 'units': v['units'], 'source_units': v.get('source_units'), 'mapable': v['mapable']} for v in vs],
            'time_range': [times[0], times[-1]] if times else None, 'time_steps': len(times), 'time_spacing_h': spacing_hours(times),
            'bounds': g['bounds'] if g else None, 'resolution_deg': [g['dx'], g['dy']] if g else None, 'grid_type': grid_type,
            'depth': {'levels': len(z['values']), 'min': min(z['values']), 'max': max(z['values']), 'units': z['units'], 'positive': z['positive']} if z else None}

def summarize(element, tasks, describe):
    """tasks: task dicts (newest first) with the summary item of completed ones under '_item'; describe(task) → gridview info or raises."""
    if element not in ELEMENT_KINDS: raise ValueError(f'未知要素: {element}')
    kinds = ELEMENT_KINDS[element]; by = {}
    for t in tasks:
        r = t['request']; p = r.get('provider', 'custom')
        if p in ('observations', 'remote_sensing'): continue
        state, meta, reason = None, None, None
        if t['state'] == 'completed':
            it = t.get('_item') or {}; sv = (it.get('summary') or {}).get('variables') or []
            if not any(v['kind'] in kinds for v in sv) and not (kinds & requested_kinds(r)): continue
            if it.get('renderable') and any(v['kind'] in kinds and v['mapable'] for v in sv):
                state = 'ready'
                try: meta = file_meta(describe(t), element)
                except Exception as e: state, reason = 'downloaded_unrenderable', '无法读取文件描述：' + str(e)[:160]
            else: state, reason = 'downloaded_unrenderable', it.get('reason') or '文件中没有可绘制的该要素变量'
        elif t['state'] in ACTIVE:
            if not kinds & requested_kinds(r): continue
            state = ACTIVE[t['state']]
        elif t['state'] == 'error':
            if not kinds & requested_kinds(r): continue
            state, reason = failure_state(t), t.get('error')
        else: continue
        s = by.setdefault(p, {'provider': p, 'state': None, 'tasks': {}, 'ready_files': 0, 'products': set(), 'last_error': None, 'meta': None})
        s['tasks'][state] = s['tasks'].get(state, 0) + 1; s['products'].add(r.get('dataset') or '')
        if state == 'ready':
            s['ready_files'] += 1
            if s['meta'] is None: s['meta'] = meta  # newest ready file
        if reason and s['last_error'] is None and state != 'ready': s['last_error'] = {'state': state, 'message': reason[:400], 'task': t['id']}
        if s['state'] is None or RANK[state] < RANK[s['state']]: s['state'] = state
    out = []
    for s in by.values():
        m = s['meta']; prod = sorted(x for x in s['products'] if x)
        s['products'] = prod[:8]
        s['representativeness'] = representativeness(' '.join(prod), m['time_spacing_h'] if m else None) if m else None
        out.append(s)
    return sorted(out, key=lambda s: (RANK[s['state']], s['provider']))
