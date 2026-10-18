"""Ocean Studio API (/api/studio): time frames, observation access, model–observation matching.

Read-only over completed downloads; existing /api and /api/viz endpoints are unchanged.
"""
from __future__ import annotations
import csv, io, math
from pathlib import Path
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from core import catalog as db
from core import gridview as gv
from core import obsdata as od
from core import match as mt
from core.settings import safe_path
from api.visualize import _task, _item, _bbox

router = APIRouter(prefix='/api/studio')

def _grid_tasks():
    out = []
    for t in db.tasks():
        if t['state'] != 'completed' or not t.get('path') or t['request'].get('provider') in ('observations', 'remote_sensing'): continue
        it = _item(t)
        if it.get('kind') == 'grid' and it.get('renderable'): out.append((t, it))
    return out

def frames_for(task_id, var=None):
    """Valid times available for one model dataset.

    A multi-step file uses its own time axis. A single-step file is joined only with sibling downloads of the
    same provider, grid and variable whose valid times form one evenly spaced run (gaps > 1.5 × spacing or
    > 24 h split the series). Excluded siblings are reported with the reason; nothing is invented.
    """
    t, path = _task(task_id); provider = t['request'].get('provider', 'custom')
    info = gv.describe(path, provider)
    v = next((x for x in info['variables'] if x['name'] == var), None) if var else next((x for x in info['variables'] if x['mapable']), None)
    if not v: raise HTTPException(400, '变量不存在或不可绘制')
    own = info['times'].get(v['time_axis']) or []
    if len(own) > 1:
        return {'mode': 'file', 'frames': [{'time': x, 'task': t['id'], 'index': i} for i, x in enumerate(own)], 'excluded': [], 'spacing_h': _spacing(own),
                'note': '时间来自文件自身时间坐标'}
    g = info['grid']; cands = []
    for tt, it in _grid_tasks():
        s = it.get('summary') or {}
        if tt['request'].get('provider') != provider or not s.get('grid') or s.get('steps', 0) > 1 or not s.get('times'): continue
        if not gv.same_grid(s['grid'], g): continue  # same shape elsewhere is a different region
        if s.get('depth_levels', 0) != len((next(iter(info['depths'].values()), None) or {}).get('values', [])): continue
        if not any(x['name'] == v['name'] and x['mapable'] for x in s['variables']): continue
        fh = (tt['request'].get('options') or {}).get('forecast_hour')
        cands.append({'time': s['times'][0], 'task': tt['id'], 'index': 0, 'forecast_hour': fh, 'completed': tt.get('updated')})
    if not cands: return {'mode': 'single', 'frames': [{'time': own[0] if own else None, 'task': t['id'], 'index': 0}], 'excluded': [], 'spacing_h': None, 'note': '单一时刻'}
    me_fh = (t['request'].get('options') or {}).get('forecast_hour')
    by_time, excluded = {}, []
    for c in sorted(cands, key=lambda c: (c['task'] != t['id'], -(c['completed'] or 0))):
        if c['forecast_hour'] != me_fh and c['task'] != t['id']:
            excluded.append({'task': c['task'], 'time': c['time'], 'reason': f'预报时效不同（f{c["forecast_hour"]:03d} ≠ f{me_fh:03d}）' if isinstance(c['forecast_hour'], int) and isinstance(me_fh, int) else '预报时效不同'}); continue
        if c['time'] in by_time: excluded.append({'task': c['task'], 'time': c['time'], 'reason': '同一有效时刻的重复下载（使用最新一份）'}); continue
        by_time[c['time']] = c
    seq = sorted(by_time.values(), key=lambda c: c['time'])
    ts = np.array([np.datetime64(c['time'].rstrip('Z')[:19]).astype('datetime64[s]').astype(np.int64) for c in seq])
    d = np.diff(ts); base = float(np.min(d)) if d.size else 0
    breaks = np.flatnonzero((d > 1.5 * base) | (d > 24 * 3600)) + 1 if d.size else np.array([], int)
    runs = np.split(np.arange(len(seq)), breaks); mine = next(r for r in runs if any(seq[i]['task'] == t['id'] for i in r))
    for r in runs:
        if r is mine: continue
        for i in r: excluded.append({'task': seq[i]['task'], 'time': seq[i]['time'], 'reason': '与当前文件之间存在时间缺口，未拼接为连续序列'})
    frames = [seq[i] for i in mine]
    return {'mode': 'siblings' if len(frames) > 1 else 'single', 'frames': frames, 'excluded': excluded,
            'spacing_h': _spacing([f['time'] for f in frames]), 'note': f'{len(frames)} 个同网格、同预报时效的已下载文件按有效时间组成序列' if len(frames) > 1 else '单一时刻'}

def _spacing(times):
    if len(times) < 2: return None
    ts = np.array([np.datetime64(x.rstrip('Z')[:19]).astype('datetime64[s]').astype(np.int64) for x in times]); d = np.diff(ts)
    return {'min': float(d.min() / 3600), 'max': float(d.max() / 3600), 'regular': bool(np.all(d == d[0]))}

@router.get('/sources')
def sources(element: str):
    """Real status of every provider that has (or tried to get) this element: ready / downloading / failed ..."""
    from core import sources as src
    if element not in src.ELEMENT_KINDS: raise HTTPException(400, f'未知要素: {element}')
    ts = []
    for t in db.tasks():
        if t['request'].get('provider') in ('observations', 'remote_sensing'): continue
        if t['state'] == 'completed' and t.get('path'): t = {**t, '_item': _item(t)}
        ts.append(t)
    def describe(t): return gv.describe(safe_path(t['path']), t['request'].get('provider', 'custom'))
    return {'element': element, 'sources': src.summarize(element, ts, describe)}

@router.get('/datasets/{id}/frames')
def frames(id: str, var: str | None = None): return frames_for(id, var)

# ---------------------------------------------------------------- observations
def _obs(id):
    t, path = _task(id)
    if t['request'].get('provider') != 'observations': raise HTTPException(400, '不是观测数据集')
    if t['request'].get('format') not in ('csv', 'json', 'netcdf', 'netcdf4', 'netcdf3'): raise HTTPException(415, '该观测格式暂不支持解析')
    return t, od.load(path, t['request'])

@router.get('/obs/{id}/summary')
def obs_summary(id: str):
    t, o = _obs(id); s = od.summary(o); s['task'] = id; s['bytes'] = t.get('bytes'); s['completed'] = t.get('updated'); return s

@router.get('/obs/{id}/features')
def obs_features(id: str, var: str | None = None, t0: str | None = None, t1: str | None = None, qc: str = 'default', depth_max: float | None = None):
    _, o = _obs(id); return od.features(o, var, t0, t1, qc, depth_max)

@router.get('/obs/{id}/platform/{pid:path}')
def obs_platform(id: str, pid: str):
    _, o = _obs(id); return od.platform(o, pid)

@router.get('/obs/{id}/export/{pid:path}')
def obs_export(id: str, pid: str):
    """Raw records of one platform as CSV, with QC raw code and derived class next to each value."""
    _, o = _obs(id); p = od.platform(o, pid); buf = io.StringIO(); w = csv.writer(buf)
    cols = ['time', 'longitude', 'latitude'] + (['vertical_' + p['vertical']['name'], 'depth_m'] if p.get('vertical') else [])
    for v in p['variables']: cols += [v['name'] + f' ({v["unit"]})', v['name'] + '_qc_raw', v['name'] + '_qc_class']
    w.writerow(cols)
    for i in range(p['records']):
        row = [p['time'][i], p['lon'][i], p['lat'][i]] + ([p['vertical']['values'][i], p['vertical']['depth_m'][i]] if p.get('vertical') else [])
        for v in p['variables']: row += [v['raw'][i], v['qc_raw'][i], v['qc'][i]]
        w.writerow(row)
    name = ''.join(c if c.isalnum() else '_' for c in f'{o["dataset"]}_{pid}')
    return Response(buf.getvalue().encode('utf-8-sig'), media_type='text/csv', headers={'Content-Disposition': f'attachment; filename="{name}.csv"'})

@router.get('/obs/{id}/near')
def obs_near(id: str, lon: float | None = None, lat: float | None = None, radius_km: float = 150, bbox: str | None = None, limit: int = 50):
    """Platforms near a point or inside a box (for 'which observations exist here?')."""
    _, o = _obs(id); s = od.summary(o)['platforms']
    if bbox:
        w, so, e, n = _bbox(bbox); hit = [p for p in s if p['lat'] is not None and so <= p['lat'] <= n and ((p['lon'] - w) % 360) <= ((e - w) % 360 if e - w < 360 else 360)]
        return {'platforms': hit[:limit], 'total': len(hit)}
    if lon is None or lat is None: raise HTTPException(400, '需要 lon/lat 或 bbox')
    for p in s: p['dist_km'] = float(od.haversine(lon, lat, p['lon'], p['lat'])) if p['lon'] is not None else math.inf
    hit = sorted([p for p in s if p['dist_km'] <= radius_km], key=lambda p: p['dist_km'])
    return {'platforms': hit[:limit], 'total': len(hit)}

# ---------------------------------------------------------------- fusion
@router.get('/match')
def match(model: str, obs: str, obs_var: str, model_var: str | None = None, max_dt_h: float = 3.0, time_interp: bool = True, qc: str = 'default',
          bbox: str | None = None, depth_max: float | None = 30.0, max_pairs: int = 20000, platform: str | None = None):
    if not 0 < max_dt_h <= 72: raise HTTPException(400, '最大时间差应在 0–72 小时之间')
    t, path = _task(model); _, o = _obs(obs)
    info = gv.describe(path, t['request'].get('provider', 'custom'))
    kind = od._var(o, obs_var)['kind']; pick = mt.resolve_model_vars(info, kind)
    if not pick: raise HTTPException(422, f'所选模式文件中没有与观测变量 {obs_var} 物理意义一致的变量')
    fr = frames_for(model, pick[0][0])
    files = []
    for f in fr['frames']:
        tt, p = _task(f['task']); files.append((f['time'], str(p), f['task'], f['index']))
    r = mt.run(t['request'], files, o, obs_var, max_dt_h, time_interp, qc, _bbox(bbox), depth_max, max(100, min(max_pairs, 50000)), None, platform)
    r['frame_mode'] = fr['mode']; r['excluded_frames'] = fr['excluded']
    ot = o['tnum'][o['tnum'] >= 0]
    r['coverage'] = {'model': [files[0][0], files[-1][0]], 'obs': [od.iso(int(ot.min())), od.iso(int(ot.max()))] if ot.size else None}
    return r

@router.get('/match/suggest')
def match_suggest():
    """Physically compatible model/observation pairs among completed downloads, with time overlap."""
    grids = _grid_tasks(); obs = [t for t in db.tasks() if t['state'] == 'completed' and t['request'].get('provider') == 'observations' and t.get('path')]
    out = []
    for ot in obs:
        try: o = od.load(safe_path(ot['path']), ot['request'])
        except Exception: continue
        tt = o['tnum'][o['tnum'] >= 0]
        if not tt.size: continue
        o0, o1 = int(tt.min()), int(tt.max())
        for v in o['variables']:
            if v['kind'] not in mt.COMPAT or v['valid'] == 0: continue
            for gt, it in grids:
                s = it['summary']; times = s.get('times') or []
                if not times: continue
                info_vars = {x['kind'] for x in s['variables']} | {x['kind'] for x in s.get('vectors', [])}
                need = {k for k, _ in mt.COMPAT[v['kind']]}
                if not need & info_vars: continue
                m0 = np.datetime64(times[0].rstrip('Z')[:19]).astype('datetime64[s]').astype(np.int64); m1 = np.datetime64(times[-1].rstrip('Z')[:19]).astype('datetime64[s]').astype(np.int64)
                gap = 0 if (o0 <= m1 + 3 * 3600 and o1 >= m0 - 3 * 3600) else min(abs(o0 - m1), abs(m0 - o1))
                out.append({'obs': ot['id'], 'obs_dataset': ot['request'].get('dataset'), 'obs_var': v['name'], 'obs_label': v['label'], 'valid': v['valid'],
                            'model': gt['id'], 'model_provider': gt['request'].get('provider'), 'model_dataset': gt['request'].get('dataset'),
                            'model_time': times, 'obs_time': [od.iso(o0), od.iso(o1)], 'time_gap_h': round(float(gap) / 3600, 1), 'overlap': bool(gap == 0)})
    out.sort(key=lambda x: (not x['overlap'], x['time_gap_h'], -x['valid']))
    return out[:200]
