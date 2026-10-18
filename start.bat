@echo off
rem Build the web page (first run only) and start Ocean Studio on http://127.0.0.1:8000
cd /d "%~dp0"
if not exist web\dist (
  pushd web && call npm ci && call npm run build && popd
)
python server\app.py %*
