"""Publish the Vite assets through Vercel's public CDN directory."""
from pathlib import Path
from shutil import copytree

root = Path(__file__).resolve().parents[1]
copytree(root / 'web' / 'dist', root / 'public', dirs_exist_ok=True)
print('Ocean Studio frontend staged in public/')
