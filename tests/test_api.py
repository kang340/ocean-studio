"""Smoke tests of the API against the bundled sample catalogue."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from fastapi.testclient import TestClient
from app import app

c = TestClient(app)


def test_health_and_catalogue():
    h = c.get('/api/health').json()
    assert h['datasets'] == h['available'] > 0
    ds = c.get('/api/viz/datasets').json()
    assert all(d['renderable'] for d in ds), [d['id'] for d in ds if not d['renderable']]


def test_gfs_frames_are_chained():
    f = c.get('/api/studio/datasets/gfs-2026101500/frames?var=u10').json()
    assert f['mode'] == 'siblings' and len(f['frames']) == 4


def test_field_slice_binary():
    r = c.get('/api/viz/datasets/cmems-thetao-20261013/field?vars=thetao&depth=0.5&max_cells=50000')
    assert r.status_code == 200 and len(r.content) > 10000


def test_match_wind():
    r = c.get('/api/studio/match?model=gfs-2026101500&obs=osmc-20261015&obs_var=windspd').json()
    assert r['stats']['n'] > 1000 and 0 < r['stats']['rmse'] < 5


def test_argo_profiles():
    s = c.get('/api/studio/obs/argo-20261012/summary').json()
    assert s['structure'] == 'profile' and s['profiles'] > 10


def test_unknown_and_traversal():
    assert c.get('/api/viz/datasets/nope').status_code == 404
    assert c.get('/api/viz/datasets/..%2F..%2Fserver%2Fapp.py').status_code == 404
