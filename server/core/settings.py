"""Paths for the Ocean Studio server. Everything is read-only and confined to DATA_DIR."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.getenv('OCEAN_STUDIO_DATA', ROOT / 'samples')).resolve()
CATALOG = Path(os.getenv('OCEAN_STUDIO_CATALOG', DATA / 'catalog.json')).resolve()
WEB = ROOT / 'web' / 'dist'


def safe_path(relative):
    """Resolve a catalogue path inside DATA; refuse anything that escapes it."""
    p = (DATA / relative).resolve()
    if not p.is_relative_to(DATA): raise ValueError('数据路径必须位于数据目录内')
    return p
