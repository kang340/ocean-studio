"""Dataset catalogue: a JSON manifest (samples/catalog.json) instead of a task database.

Each entry describes one local file:
  {"id": "gfs-2026101500", "provider": "gfs", "dataset": "GFS 0.25° 2026101500", "format": "netcdf4",
   "path": "gfs/2026101500.nc", "region": {...}, "time_start": "...", "time_end": "...", "options": {"forecast_hour": 0}}

Entries are exposed to the API in the same shape the downloader's task records had, so the
visualisation code is shared unchanged. The manifest is re-read when its mtime changes.
"""
from __future__ import annotations
import json, threading
from core.settings import CATALOG, DATA

_LOCK = threading.Lock()
_state = {'mtime': None, 'tasks': []}
_memo: dict = {}
REQUEST_KEYS = ('provider', 'dataset', 'format', 'region', 'time_start', 'time_end', 'depth_min', 'depth_max', 'variables', 'options', 'url')


def _record(e, order):
    path = DATA / e['path']
    st = path.stat() if path.is_file() else None
    return {'id': e['id'], 'state': 'completed' if st else 'missing', 'path': e['path'], 'bytes': st.st_size if st else None,
            'updated': st.st_mtime if st else None, 'created': order, 'error': None, 'title': e.get('title'),
            'request': {k: e[k] for k in REQUEST_KEYS if k in e}, 'metadata': {'format': e.get('file_format')} if e.get('file_format') else {}}


def tasks():
    with _LOCK:
        m = CATALOG.stat().st_mtime_ns if CATALOG.exists() else None
        if m != _state['mtime']:
            entries = json.loads(CATALOG.read_text(encoding='utf-8')).get('datasets', []) if m else []
            _state.update(mtime=m, tasks=[_record(e, i) for i, e in enumerate(entries)])
        return list(_state['tasks'])


def task(id):
    return next((t for t in tasks() if t['id'] == id), None)


def cached(key, loader, ttl=None):
    """In-process memo; keys already include the file mtime, so stale entries are never hit."""
    if key not in _memo: _memo[key] = loader()
    return _memo[key]
