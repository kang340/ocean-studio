"""Model ↔ observation matching (collocation) and verification statistics.

Method (recorded in every response):
  space  bilinear interpolation of the model grid at the observation position when all four
         surrounding cells are valid, otherwise the nearest valid of those four cells; no match
         if all four are missing (land / outside the model domain).
  time   nearest model valid time within ±max_dt; optional linear interpolation between the two
         bracketing model times when both exist, are ≤ max_gap apart and spatially valid.
  depth  nearest model level to the observation depth (pressure → depth via UNESCO 1983);
         observations without a vertical coordinate are compared with the shallowest level.
  units  both sides converted to the same display unit (K→°C, Pa→hPa, knots→m/s, cm→m …).
No model value is ever extrapolated in time, and no observation is altered.
"""
from __future__ import annotations
import math
from pathlib import Path
import numpy as np
from core import gridview as gv
from core import obsdata as od

# observation kind → compatible model kinds and how to build the model quantity
COMPAT = {
    'sea_temperature': [('sea_temperature', 'scalar')],
    'salinity': [('salinity', 'scalar')],
    'wind_speed': [('wind', 'speed')],
    'wind_u': [('wind_u', 'scalar')], 'wind_v': [('wind_v', 'scalar')],
    'current_u': [('current_u', 'scalar')], 'current_v': [('current_v', 'scalar')],
    'pressure': [('pressure', 'scalar')],
    'wave_height': [('wave_height', 'scalar')],
    'wave_period': [('wave_period', 'scalar')],
    'air_temperature': [('air_temperature', 'scalar')],
    'sea_level': [('ssh', 'scalar')],
}
NOTES = {
    'wind_speed': '模式为 10 m 风速 |U,V|；实测风速测量高度因平台而异（船舶、浮标约 3–40 m），未做高度订正，会引入系统偏差。',
    'sea_temperature': '模式海温为网格平均的体温度（或最上层），实测可能为表皮 / 体温度，二者存在物理差异。',
    'sea_level': '潮位为相对验潮站基准的总水位（含潮汐），模式海面高度通常不含天文潮、基准不同：统计前已分别去除平均值，仅比较变化量。',
    'pressure': '模式为海平面气压（PRMSL / MSL），实测为平台报告的海平面气压。',
    'wave_height': '模式有效波高与浮标 / 船舶报告波高比较；船舶目测波高精度较低。',
}

def model_unit(kind, units):
    u = (units or '').strip().lower()
    if kind in ('air_temperature', 'sea_temperature') and u in ('k', 'kelvin'): return '°C', 1.0, -273.15
    if kind == 'pressure' and u == 'pa': return 'hPa', 0.01, 0.0
    if kind in ('wind', 'wind_u', 'wind_v', 'current_u', 'current_v') and u in ('m s**-1', 'm s-1', 'm/s'): return 'm/s', 1.0, 0.0
    return units, 1.0, 0.0

def resolve_model_vars(info, obs_kind):
    """Pick model variable(s) for an observation kind; returns (names, mode, model_kind) or None."""
    for mkind, mode in COMPAT.get(obs_kind, []):
        if mode == 'speed':
            vec = next((v for v in info['vectors'] if v.get('kind') == mkind and v.get('u')), None)
            if vec: return [vec['u'], vec['v']], 'speed', mkind
        else:
            v = next((x for x in info['variables'] if x['kind'] == mkind and x['mapable']), None)
            if v: return [v['name']], 'scalar', mkind
    return None

def _sorted_slice(ds, info, g, name, ti, zi):
    v = gv._variable(info, name); sel, _, _ = gv._selection(ds, info, v, None, None, ti, zi)
    return gv._read(ds, v, sel, g, np.arange(g.y.size), np.arange(g.x.size))  # [y ascending, x as g.x]

def _sample(a, g, lon, lat, nearest_only=False):
    """Vectorised bilinear (all four valid) / nearest-valid-corner sampling. Returns values, method codes, distance km."""
    nx, ny = g.x.size, g.y.size; x = np.asarray(lon, float).copy(); y = np.asarray(lat, float)
    x0 = g.x[0]; x = x0 + ((x - x0) % 360)
    span_ok = g.global_x | (x <= g.x[-1] + g.step / 2)
    i0 = np.clip(np.searchsorted(g.x, x, side='right') - 1, 0, nx - 1)
    wrap = g.global_x & (x > g.x[-1])
    i1 = np.where(wrap, 0, np.minimum(i0 + 1, nx - 1))
    dx = np.where(wrap, g.x[0] + 360 - g.x[-1], g.x[i1] - g.x[i0]); fx = np.where(dx > 0, (x - g.x[i0]) / np.where(dx > 0, dx, 1), 0)
    j0 = np.clip(np.searchsorted(g.y, y, side='right') - 1, 0, ny - 1); j1 = np.minimum(j0 + 1, ny - 1)
    dy = g.y[j1] - g.y[j0]; fy = np.where(dy > 0, (y - g.y[j0]) / np.where(dy > 0, dy, 1), 0)
    inside = span_ok & (y >= g.y[0] - g.ystep / 2) & (y <= g.y[-1] + g.ystep / 2) & (x >= g.x[0] - g.step / 2)
    fx = np.clip(fx, 0, 1); fy = np.clip(fy, 0, 1)
    c = np.stack([a[j0, i0], a[j0, i1], a[j1, i0], a[j1, i1]]); w = np.stack([(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy])
    ok = np.isfinite(c); full = ok.all(axis=0) & (not nearest_only)
    bil = np.where(full, np.nansum(np.where(ok, c, 0) * w, axis=0), np.nan)
    wn = np.where(ok, w, -1); k = np.argmax(wn, axis=0); near = c[k, np.arange(c.shape[1])]; has = ok.any(axis=0)
    val = np.where(full, bil, np.where(has, near, np.nan)); val = np.where(inside, val, np.nan)
    method = np.where(~inside, 3, np.where(full, 0, np.where(has, 1, 2)))  # 0 bilinear, 1 nearest, 2 model missing, 3 outside
    cx = np.where(k % 2 == 0, g.x[i0], np.where(wrap, g.x[0] + 360, g.x[i1])); cy = np.where(k < 2, g.y[j0], g.y[j1])
    dist = od.haversine(x, y, cx, cy)
    return val, method, dist

def stats(m, o):
    m = np.asarray(m, float); o = np.asarray(o, float); ok = np.isfinite(m) & np.isfinite(o); m, o = m[ok], o[ok]; n = int(m.size)
    if n == 0: return {'n': 0}
    d = m - o; out = {'n': n, 'bias': float(d.mean()), 'mae': float(np.abs(d).mean()), 'rmse': float(math.sqrt((d ** 2).mean())), 'std_diff': float(d.std()),
                      'obs_mean': float(o.mean()), 'model_mean': float(m.mean()), 'obs_std': float(o.std()), 'model_std': float(m.std())}
    if n >= 3 and o.std() > 0 and m.std() > 0:
        r = float(np.corrcoef(m, o)[0, 1]); slope, intercept = np.polyfit(o, m, 1)
        out.update(r=r, slope=float(slope), intercept=float(intercept))
    if abs(out['obs_mean']) > 1e-9: out['scatter_index'] = out['rmse'] / abs(out['obs_mean'])
    # robust companions: unflagged real-time reports contain gross errors that dominate RMSE
    med = float(np.median(d)); mad = float(np.median(np.abs(d - med))) * 1.4826
    out.update(median_diff=med, robust_std=mad, p95_abs=float(np.percentile(np.abs(d), 95)))
    if mad > 0:
        out['outliers'] = int((np.abs(d - med) > 5 * mad).sum())
        keep = np.abs(d - med) <= 5 * mad
        if keep.sum() >= 3: out['rmse_excl_outliers'] = float(math.sqrt((d[keep] ** 2).mean()))
    return out

def run(model, frames, obs, obs_var, max_dt_h=3.0, time_interp=True, qc='default', bbox=None, depth_max=None, max_pairs=20000, remove_mean=None, platform=None):
    """model: {'provider'}; frames: [(iso time, path, task id, time index in file)] sharing one grid; obs: loaded obsdata object."""
    v = od._var(obs, obs_var); okind = v['kind']
    if okind not in COMPAT: raise ValueError(f'观测变量 {obs_var}（{v["label"]}）暂无可比较的模式量')
    if not frames: raise ValueError('模式数据没有可用时刻')
    provider = model.get('provider', 'custom')
    with gv.LOCK:
        info0, ds0, g = gv._context(Path(frames[0][1]), provider)
        pick = resolve_model_vars(info0, okind)
        if not pick: raise ValueError(f'该模式文件中没有与“{v["label"]}”对应的变量')
        names, mode, mkind = pick
        mv = gv._variable(info0, names[0]); munit, mfac, moff = model_unit(mkind, mv['units'])
        bad = [n for n in names if not gv._variable(info0, n).get('units_known', True)]
        if bad: raise ValueError(f'模式变量 {", ".join(bad)} 的速度单位“{gv._variable(info0, bad[0]).get("source_units")}”无法识别，不能与以 m/s 计的观测比较')
        ztab = info0['depths'].get(mv['depth_axis']) if mv['depth_axis'] else None
    # candidate observations
    reasons = {'qc_excluded': 0, 'obs_missing': 0, 'outside_time': 0, 'outside_domain': 0, 'model_missing': 0, 'outside_bbox': 0, 'deeper_than_limit': 0}
    valid = np.isfinite(v['display']); reasons['obs_missing'] = int((~valid).sum())
    good = od.qc_mask(v, qc); reasons['qc_excluded'] = int((valid & ~good).sum())
    m = good & np.isfinite(obs['lon']) & np.isfinite(obs['lat']) & (obs['tnum'] >= 0)
    if platform is not None: m &= obs['sid'] == str(platform)
    if bbox:
        w, s, e, n = bbox; x = obs['lon']; inb = (obs['lat'] >= s) & (obs['lat'] <= n) & (((x - w) % 360) <= ((e - w) % 360 if e - w < 360 else 360))
        reasons['outside_bbox'] = int((m & ~inb).sum()); m &= inb
    zdepth = obs['vertical']['depth_m'] if obs['vertical'] is not None else None
    if zdepth is not None and depth_max is not None:
        deep = zdepth > float(depth_max); reasons['deeper_than_limit'] = int((m & deep).sum()); m &= ~deep
    idx = np.flatnonzero(m)
    ft = np.array([np.datetime64(fr[0].rstrip('Z')[:19]).astype('datetime64[s]').astype(np.int64) for fr in frames])
    order = np.argsort(ft); ft = ft[order]; frames = [frames[i] for i in order]
    ot = obs['tnum'][idx].astype(np.int64); maxdt = max_dt_h * 3600
    k1 = np.searchsorted(ft, ot); k0 = np.clip(k1 - 1, 0, len(ft) - 1); k1c = np.clip(k1, 0, len(ft) - 1)
    near = np.where(np.abs(ft[k0] - ot) <= np.abs(ft[k1c] - ot), k0, k1c); dt_near = ot - ft[near]
    in_time = np.abs(dt_near) <= maxdt; reasons['outside_time'] = int((~in_time).sum())
    spacing = np.diff(ft); typical = float(np.median(spacing)) if spacing.size else 0
    bracket = (k1 > 0) & (k1 < len(ft)) & time_interp
    if spacing.size: bracket &= (ft[k1c] - ft[k0]) <= max(typical * 1.01, 1)
    bracket &= dt_near != 0  # an observation exactly at a model time uses that time, not interpolation
    idx, ot, near, dt_near, bracket, k0, k1c = (a[in_time] for a in (idx, ot, near, dt_near, bracket, k0, k1c))
    # depth level per observation
    zi = np.zeros(idx.size, int); dz = np.zeros(idx.size)
    if ztab and len(ztab['values']) > 0:
        zv = np.asarray(ztab['values'], float); od_ = zdepth[idx] if zdepth is not None else np.full(idx.size, zv.min())
        zi = np.abs(od_[:, None] - zv[None, :]).argmin(axis=1); dz = zv[zi] - od_
    model_val = np.full(idx.size, np.nan); method = np.full(idx.size, 3); dist = np.full(idx.size, np.nan); tmode = np.zeros(idx.size, int)
    needed = sorted(set(near.tolist()) | (set(k0[bracket].tolist()) | set(k1c[bracket].tolist())))
    with gv.LOCK:
        cache = {}
        def field(fi, z):
            key = (fi, z)
            if key not in cache:
                info, ds, gg = gv._context(Path(frames[fi][1]), provider); ti = frames[fi][3]
                parts = [_sorted_slice(ds, info, gg, nm, ti, z) for nm in names]
                arr = np.hypot(parts[0], parts[1]) if mode == 'speed' else parts[0]
                cache[key] = (arr * mfac + moff, gg)
                if len(cache) > 12: cache.pop(next(iter(cache)))
            return cache[key]
        for fi in needed:
            for z in np.unique(zi):
                sel = (near == fi) & (zi == z)
                if not sel.any(): continue
                arr, gg = field(fi, int(z)); val, me, di = _sample(arr, gg, obs['lon'][idx[sel]], obs['lat'][idx[sel]], nearest_only=mkind == 'wave_direction')
                model_val[sel] = val; method[sel] = me; dist[sel] = di
        # linear time interpolation where both bracketing times are valid at the point
        if time_interp:
            for a in np.unique(k0[bracket]):
                for z in np.unique(zi):
                    sel = bracket & (k0 == a) & (zi == z)
                    if not sel.any(): continue
                    b = int(k1c[sel][0]); A, gA = field(int(a), int(z)); B, _ = field(b, int(z))
                    va, ma, _ = _sample(A, gA, obs['lon'][idx[sel]], obs['lat'][idx[sel]]); vb, mb, _ = _sample(B, gA, obs['lon'][idx[sel]], obs['lat'][idx[sel]])
                    w = (ot[sel] - ft[a]) / max(1, ft[b] - ft[a]); both = np.isfinite(va) & np.isfinite(vb)
                    cur = model_val[sel]; cur[both] = (va + (vb - va) * w)[both]; model_val[sel] = cur
                    tm = tmode[sel]; tm[both] = 1; tmode[sel] = tm
    reasons['outside_domain'] = int((method == 3).sum()); reasons['model_missing'] = int((method == 2).sum())
    ok = np.isfinite(model_val)
    obs_val = v['display'][idx]  # obsdata already converted to the canonical display unit (°C, m/s, hPa, m)
    mm, oo_ = model_val[ok], obs_val[ok]
    note = [NOTES.get(okind, '')] if NOTES.get(okind) else []
    if okind == 'sea_level' or remove_mean:
        mm = mm - np.nanmean(mm) if mm.size else mm; oo_ = oo_ - np.nanmean(oo_) if oo_.size else oo_
    sel_idx = idx[ok]
    overall = stats(mm, oo_)
    # breakdowns
    by_time = []
    for fi in sorted(set(near[ok].tolist())):
        s_ = near[ok] == fi; st = stats(mm[s_], oo_[s_]); st['time'] = frames[fi][0]; by_time.append(st)
    by_type = []
    types = np.array([obs['ptypes'].get(x, obs['platform_type']) for x in obs['pnames'][obs['pcode'][sel_idx]]]) if sel_idx.size else np.array([])
    for t in sorted(set(types.tolist())):
        s_ = types == t; st = stats(mm[s_], oo_[s_]); st['type'] = t; st['label'] = od.PLATFORM_LABELS.get(t, t); by_type.append(st)
    by_lat = []
    for lo in range(-90, 90, 30):
        s_ = (obs['lat'][sel_idx] >= lo) & (obs['lat'][sel_idx] < lo + 30)
        if s_.sum(): st = stats(mm[s_], oo_[s_]); st['band'] = [lo, lo + 30]; by_lat.append(st)
    diff = mm - oo_
    hist = None
    if diff.size:
        lim = float(np.nanpercentile(np.abs(diff), 99)) or 1.0; c, edges = np.histogram(np.clip(diff, -lim, lim), bins=40, range=(-lim, lim))
        hist = {'counts': c.tolist(), 'edges': [float(x) for x in edges]}
    take = np.arange(sel_idx.size)
    if take.size > max_pairs: take = np.sort(np.random.default_rng(0).choice(take, max_pairs, replace=False))  # seeded subsample, stats use all pairs
    okm = np.flatnonzero(ok)[take]
    pairs = {'platform': obs['pnames'][obs['pcode'][sel_idx[take]]].astype(str).tolist(), 'lon': np.round(obs['lon'][sel_idx[take]], 4).tolist(),
             'lat': np.round(obs['lat'][sel_idx[take]], 4).tolist(), 'time': [od.iso(t) for t in obs['tnum'][sel_idx[take]]],
             'obs': [od.f(x, 4) for x in oo_[take]], 'model': [od.f(x, 4) for x in mm[take]], 'dt_h': [od.f(x / 3600, 2) for x in dt_near[okm]],
             'dist_km': [od.f(x, 2) for x in dist[okm]], 'method': [int(x) for x in method[okm]], 'time_interp': [int(x) for x in tmode[okm]],
             'dz_m': [od.f(x, 2) for x in dz[okm]], 'qc': v['qc'][sel_idx[take]].tolist()}
    dd = mm - oo_; med = float(np.median(dd)) if dd.size else 0; mad = float(np.median(np.abs(dd - med))) * 1.4826 if dd.size else 0
    pairs['outlier'] = [bool(abs(x - med) > 5 * mad) if mad > 0 else False for x in dd[take]]
    return {'obs_variable': od._public_var(v), 'model_variables': names, 'model_mode': mode, 'model_kind': mkind, 'unit': munit,
            'stats': overall, 'by_time': by_time, 'by_type': by_type, 'by_lat': by_lat, 'diff_hist': hist, 'pairs': pairs, 'pairs_total': int(ok.sum()),
            'pairs_returned': int(take.size), 'candidates': int(m.sum()), 'unmatched': reasons,
            'space_methods': {'bilinear': int((method[ok] == 0).sum()), 'nearest': int((method[ok] == 1).sum())},
            'time_methods': {'nearest': int((tmode[ok] == 0).sum()), 'linear': int((tmode[ok] == 1).sum())},
            'outlier_rule': '|差值 − 中位数| > 5 × 1.4826 × MAD 标记为离群（仅标记，不删除；主统计包含全部样本）',
            'max_dt_h': max_dt_h, 'time_interp': time_interp, 'qc': qc, 'remove_mean': bool(okind == 'sea_level' or remove_mean),
            'max_dist_km': od.f(np.nanmax(dist[ok]), 2) if ok.any() else None, 'max_abs_dt_h': od.f(np.max(np.abs(dt_near[ok])) / 3600, 2) if ok.any() else None,
            'depth': {'model_levels': ztab['values'] if ztab else None, 'max_abs_dz_m': od.f(np.max(np.abs(dz[ok])), 2) if ok.any() and ztab else None},
            'frames': [{'time': fr[0], 'task': fr[2]} for fr in frames],
            'method': {'space': '双线性（四邻点均有效）/ 否则四邻点中最近有效格点；四点均缺测不匹配',
                       'time': f'最近模式时刻，|Δt| ≤ {max_dt_h:g} h' + ('；相邻两时刻均有效时线性插值' if time_interp else ''),
                       'depth': '最近模式深度层' if ztab else '模式无垂向坐标（表层量）',
                       'units': f'统一为 {munit}'},
            'notes': note + (['统计前已分别去除模式与观测的平均值'] if okind == 'sea_level' or remove_mean else [])}
