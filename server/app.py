"""Ocean Studio server: read-only visualisation API over the files listed in the catalogue + the built web page.

Run:  python server/app.py            (http://127.0.0.1:8000)
      OCEAN_STUDIO_DATA=/path/to/data python server/app.py --port 8080
"""
from __future__ import annotations
import argparse, mimetypes, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from core import catalog
from core.settings import DATA, CATALOG, WEB
from api import visualize, studio

app = FastAPI(title='Ocean Studio', version='1.0.0', docs_url='/api/docs', openapi_url='/api/openapi.json')
app.add_middleware(GZipMiddleware, minimum_size=4096)
app.include_router(visualize.router)
app.include_router(studio.router)


@app.exception_handler(ValueError)
async def value_error(_: Request, e: ValueError):
    return JSONResponse({'detail': str(e)[:500]}, status_code=400)


@app.get('/api/health')
def health():
    ts = catalog.tasks()
    return {'status': 'ok', 'catalog': CATALOG.name, 'datasets': len(ts), 'available': sum(t['state'] == 'completed' for t in ts)}


@app.get('/', include_in_schema=False)
def index():
    return RedirectResponse('/ocean-studio.html')


class PrecompressedStatic(StaticFiles):
    """Serve the build's `.gz` siblings (JS, CSS, basemap tiles) to browsers that accept gzip."""
    async def get_response(self, path, scope):
        accept = dict(scope.get('headers') or []).get(b'accept-encoding', b'')
        if b'gzip' in accept and path.endswith(('.js', '.css', '.json', '.geojson', '.svg', '.html')):
            full, stat = self.lookup_path(path + '.gz')
            if stat is not None:
                r = FileResponse(full, stat_result=stat, media_type=mimetypes.guess_type(path)[0] or 'application/octet-stream')
                r.headers['Content-Encoding'] = 'gzip'; r.headers['Vary'] = 'Accept-Encoding'
                if path.startswith(('assets/', 'basemap/')): r.headers['Cache-Control'] = 'public, max-age=604800'
                return r
        return await super().get_response(path, scope)


if WEB.exists(): app.mount('/', PrecompressedStatic(directory=WEB, html=True), name='web')

if __name__ == '__main__':
    import uvicorn
    ap = argparse.ArgumentParser(description='Ocean Studio server')
    ap.add_argument('--host', default='127.0.0.1'); ap.add_argument('--port', type=int, default=8000)
    a = ap.parse_args()
    if not WEB.exists(): print('提示: 未找到 web/dist，请先在 web/ 下执行 npm install && npm run build（或用 npm run dev 开发）')
    print(f'Ocean Studio · data: {DATA} · http://{a.host}:{a.port}/')
    uvicorn.run(app, host=a.host, port=a.port)
