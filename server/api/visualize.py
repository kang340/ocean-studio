"""Visualisation API over completed downloads. Reads archived files only; never creates data."""
from __future__ import annotations
import gzip, math
from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from core import catalog as db
from core import gridview as gv
from core.settings import safe_path

router = APIRouter(prefix='/api/viz')
PROVIDER_LABELS = {'gfs': 'NOAA GFS', 'wavewatch': 'WAVEWATCH III', 'hycom': 'HYCOM', 'era5': 'ERA5', 'copernicus': 'Copernicus Marine',
                   'observations': '现场观测', 'remote_sensing': '卫星遥感', 'custom': '自定义数据源'}
GRID_FORMATS = {'netcdf', 'netcdf4', 'netcdf3', 'grib2', 'zarr', 'native'}

def _task(id):
    t = db.task(id)
    if not t: raise HTTPException(404, '数据集不存在')
    if t['state'] != 'completed' or not t.get('path'): raise HTTPException(409, '任务尚未完成，没有可读取的文件')
    path = safe_path(t['path'])
    if not path.exists(): raise HTTPException(410, '归档文件已不存在，请在资源库运行完整性检查')
    return t, path

def _summary(t, path):
    """Cheap, cached per file version; opening a GRIB once costs ~0.5 s."""
    provider = t['request'].get('provider', 'custom')
    def load():
        info = gv.describe(path, provider)
        times = sorted({x for values in info['times'].values() for x in values})
        depths = next(iter(info['depths'].values()), None)
        return {'grid': info['grid'], 'times': [times[0], times[-1]] if times else [], 'steps': max((len(v) for v in info['times'].values()), default=0),
                'depth_levels': len(depths['values']) if depths else 0,
                'variables': [{'name': v['name'], 'kind': v['kind'], 'units': v['units'], 'label': v['label'], 'mapable': v['mapable']} for v in info['variables']],
                'vectors': info['vectors']}
    return db.cached(f'viz-summary:{path}:{path.stat().st_mtime_ns}:{provider}', load, 30 * 86400)

def _obs_summary(t, path):
    """Stations, records, time and spatial extent of an observation export (same 2000-record preview window)."""
    def load():
        from core.observation_preview import observation_preview
        with gv.LOCK:
            info = observation_preview(path, t['request'])
        recs = info['preview']['records']; xs = [r['lon'] for r in recs if 'lon' in r]; ys = [r['lat'] for r in recs if 'lat' in r]
        times = sorted(r['time'] for r in recs if r.get('time'))
        return {'records': len(recs), 'stations': len({r['station'] for r in recs}), 'variable': info['preview']['variable'],
                'variables': [v['name'] for v in info['variables']], 'times': [times[0], times[-1]] if times else [],
                'bounds': [min(xs), min(ys), max(xs), max(ys)] if xs else None, 'vertical': info['preview'].get('vertical'), 'capped': len(recs) >= 2000}
    return db.cached(f'viz-obs:{path}:{path.stat().st_mtime_ns}', load, 30 * 86400)

def _item(t):
    r = t['request']; provider = r.get('provider', 'custom'); fmt = r.get('format', ''); meta = t.get('metadata') or {}
    item = {'id': t['id'], 'title': t.get('title'), 'provider': provider, 'provider_label': PROVIDER_LABELS.get(provider, provider), 'dataset': r.get('dataset') or r.get('url', ''),
            'format': fmt, 'path': t.get('path'), 'bytes': t.get('bytes'), 'completed': t.get('updated'), 'request': {k: r.get(k) for k in
            ('region', 'time_start', 'time_end', 'depth_min', 'depth_max', 'variables', 'options')}, 'file_format': meta.get('format')}
    if provider == 'observations':
        item.update(kind='observations', renderable=fmt in ('csv', 'json', 'netcdf', 'netcdf4', 'netcdf3'), reason=None)
        try:
            path = safe_path(t['path'])
            if path.exists() and item['renderable']: item['observations'] = _obs_summary(t, path)
        except Exception as e:
            item['reason'] = '无法解析观测文件：' + str(e)[:200]
        return item
    if provider == 'remote_sensing' or str(meta.get('format', '')).startswith('TIFF'):
        item.update(kind='imagery', renderable=False, reason='原始 GeoTIFF 波段（需要 GDAL / rasterio 解码），当前仅提供元数据')
        return item
    if fmt not in GRID_FORMATS:
        item.update(kind='table', renderable=False, reason=f'{fmt.upper()} 表格导出不含网格结构，请下载 NetCDF / GRIB2 以进行地图渲染')
        return item
    try:
        path = safe_path(t['path'])
        if not path.exists():
            item.update(kind='grid', renderable=False, reason='归档文件已不存在'); return item
        summary = _summary(t, path)
        mapable = any(v['mapable'] for v in summary['variables'])
        item.update(kind='grid', renderable=mapable and bool(summary['grid']), summary=summary,
                    reason=None if mapable and summary['grid'] else '没有规则经纬网格变量')
    except Exception as e:
        item.update(kind='grid', renderable=False, reason='无法解析文件：' + str(e)[:200])
    return item

@router.get('/datasets')
def datasets():
    out = []
    for t in db.tasks():
        if t['state'] != 'completed' or not t.get('path'): continue
        out.append(_item(t))
    return out

@router.get('/datasets/{id}')
def dataset(id: str):
    t, path = _task(id); item = _item(t)
    if item['kind'] == 'grid' and item['renderable']:
        item['describe'] = gv.describe(path, t['request'].get('provider', 'custom'))
    return item

def _bbox(text):
    if not text: return None
    try: w, s, e, n = [float(x) for x in text.split(',')]
    except ValueError: raise HTTPException(400, 'bbox 格式应为 west,south,east,north')
    if not all(math.isfinite(x) for x in (w, s, e, n)) or s >= n or not -90 <= s <= 90 or not -90 <= n <= 90: raise HTTPException(400, 'bbox 超出范围')
    return [w, max(-90, s), e, min(90, n)]

def _names(text):
    names = [x for x in (text or '').split(',') if x]
    if not names or len(names) > 4: raise HTTPException(400, '请指定 1–4 个变量')
    return names

@router.get('/datasets/{id}/field')
def field(id: str, request: Request, vars: str, time: str | None = None, depth: float | None = None, bbox: str | None = None,
          max_cells: int = 1_000_000, time_index: int | None = None, depth_index: int | None = None):
    t, path = _task(id)
    data = gv.field(path, t['request'].get('provider', 'custom'), _names(vars), time, depth, _bbox(bbox), max_cells, time_index, depth_index)
    headers = {'Cache-Control': 'private, max-age=600'}
    if 'gzip' in request.headers.get('accept-encoding', '') and len(data) > 4096:
        data = gzip.compress(data, compresslevel=1); headers['Content-Encoding'] = 'gzip'
    return Response(data, media_type='application/octet-stream', headers=headers)

@router.get('/datasets/{id}/point')
def point(id: str, lon: float, lat: float, time: str | None = None, depth: float | None = None, vars: str | None = None,
          series: bool = False, profile: bool = False):
    t, path = _task(id)
    return gv.point(path, t['request'].get('provider', 'custom'), lon, lat, time, depth, [x for x in (vars or '').split(',') if x] or None, series, profile)

@router.get('/datasets/{id}/section')
def section(id: str, vars: str, line: str, time: str | None = None, n: int = 200):
    """Vertical section along a polyline 'lon,lat;lon,lat;...' on the file's real depth levels."""
    t, path = _task(id)
    try: pts = [[float(x) for x in p.split(',')] for p in line.split(';') if p.strip()]
    except ValueError: raise HTTPException(400, 'line 格式应为 lon,lat;lon,lat')
    if len(pts) < 2 or any(len(p) != 2 or not (-90 <= p[1] <= 90) for p in pts): raise HTTPException(400, '断面线至少需要两个有效经纬度点')
    return gv.section(path, t['request'].get('provider', 'custom'), _names(vars), pts, time, n)

@router.get('/datasets/{id}/region')
def region(id: str, vars: str, bbox: str, time: str | None = None, depth: float | None = None, series: bool = False):
    t, path = _task(id)
    return gv.region(path, t['request'].get('provider', 'custom'), _names(vars), _bbox(bbox), time, depth, series)

@router.get('/datasets/{id}/observations')
def observations(id: str, variable: str | None = None):
    t, path = _task(id)
    if t['request'].get('provider') != 'observations': raise HTTPException(400, '不是观测数据集')
    from core.observation_preview import observation_preview
    with gv.LOCK:
        return observation_preview(path, t['request'], variable)
