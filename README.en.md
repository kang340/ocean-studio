# Ocean Studio

[简体中文](README.md) · **English**

Ocean Studio is a browser workbench for global ocean and atmospheric model fields and in-situ observations. Explore gridded models, inspect observations and validate one against the other. Values come from local NetCDF / GRIB2 / ERDDAP CSV files; missing values remain missing.

The repository includes approximately 76 MiB of real, time-overlapping sample data from GFS, WAVEWATCH III, CMEMS, ERA5, OSMC and Argo. Clone it and run it locally.

## Try it online

**[Open the English demo](https://ocean-studio-tan.vercel.app/ocean-studio.html?lang=en)** · [3D wind](https://ocean-studio-tan.vercel.app/ocean-studio.html?lang=en&el=wind&src=gfs&view=globe&t=2026-10-15T12:00:00Z) · [Wave comparison](https://ocean-studio-tan.vercel.app/ocean-studio.html?lang=en&el=waves&src=copernicus&cmp=wavewatch&cv=swipe&t=2026-10-15T00:00:00Z) · [中文版](https://ocean-studio-tan.vercel.app/ocean-studio.html?lang=zh)

The online application includes the sample data and Python analysis API. These are **October 2026 historical samples, not a live feed**. The first request after inactivity may require a cold start. See [deployment instructions](docs/DEPLOYMENT.md#english).

### Language and author profile

The default view is the **3D globe**. Use the top-bar 2D / 3D controls to switch. Two-dimensional scenes use `view=map`, preserving the map view across language changes and reloads.

Use **中文 / EN** in the top bar to change language. The preference is saved in your browser. Switching reloads the page while retaining the source, element, time, depth and comparison scene encoded in the URL. Shared links accept `lang=zh` or `lang=en`; the link takes priority over the saved preference. Menus, tooltips, charts, sea labels, analysis explanations and QC descriptions are localized. Raw variable names, dataset IDs, numeric values and units remain unchanged.

The **GitHub · @kang340** account link opens the [author’s GitHub profile](https://github.com/kang340) in a new tab.

## 35-second showcase

[![Ocean Studio showcase](media/Ocean-Studio-showcase-cover.jpg)](https://github.com/kang340/ocean-studio/releases/download/v1.0.0/Ocean-Studio-showcase-X.mp4)

[Watch / download MP4](https://github.com/kang340/ocean-studio/releases/download/v1.0.0/Ocean-Studio-showcase-X.mp4) · 1920×1080 · 30 fps · Chinese captions · Silent for social feeds. The recording shows the bundled **October 2026 sample data**, not live data. See [video source](promo-video/README.md) and [suggested X posts](docs/POST-X.md).

![Global wind on the 3D globe](docs/screenshots/wind-globe.png)

| | |
|---|---|
| ![Wave-source swipe comparison](docs/screenshots/waves-swipe.png) | ![GFS minus ERA5 wind speed](docs/screenshots/gfs-era5-diff.png) |
| ![NW Pacific sea temperature](docs/screenshots/sst-nwpac.png) | ![Global observation samples](docs/screenshots/observations.png) |

## Features

- Browse by physical element: temperature, salinity, currents, waves, wind, pressure, precipitation and ice, with available sources shown for each.
- 2D maps and a 3D globe; GPU color fields, wind / current particles, contours and discrete color bands.
- Compare two sources using swipe, overlay, A − B differences or linked side-by-side maps. Time, units and grids are aligned before comparison.
- Timeline playback; compatible files sharing a grid and forecast lead time form a continuous series.
- Vertical sections, point time series / profiles and selected-region statistics.
- Observation tracks, profiles, original Argo / PMEL / WOCE quality flags and CSV export.
- Model–observation matching with bias, RMSE, correlation, scatterplots and time / latitude groups; depth matching of Argo profiles against model temperature and salinity.
- Presentation mode, light / dark themes, Chinese / English interface and shareable scene URLs.

## Quick start

Use Python 3.12 (the deployment target) and Node.js 20+.

```bash
git clone https://github.com/kang340/ocean-studio.git
cd ocean-studio
pip install -r requirements.txt
cd web && npm ci && npm run build && cd ..
python server/app.py
```

Open http://127.0.0.1:8000/ocean-studio.html?lang=en. Alternatively run `./start.sh` or `start.bat` on Windows; the launcher builds the frontend on first run.

On first opening the root page, the About · Data dialog offers six example scenes. Press `?` to reopen it at any time.

### Development

```bash
python server/app.py              # Terminal 1: API on :8000
cd web && npm run dev             # Terminal 2: Vite; /api proxies to :8000
```

Run the checks:

```bash
pip install -r requirements-dev.txt
python -m pytest -q tests
cd web && npm test && npm run build
```

## Use your own data

Place your files in a directory and add a `catalog.json` manifest:

```json
{
  "datasets": [
    { "id": "my-gfs-00z", "title": "GFS 2026-10-15 00Z", "provider": "gfs", "dataset": "2026101500",
      "format": "netcdf4", "path": "gfs/2026101500.nc", "options": { "forecast_hour": 0 } },
    { "id": "my-argo", "provider": "observations", "dataset": "ArgoFloats", "format": "csv",
      "path": "obs/argo.csv", "options": { "station_field": "platform_number", "vertical": "pres", "vertical_units": "dbar" } }
  ]
}
```

Point the server at that directory:

```bash
OCEAN_STUDIO_DATA=/path/to/my-data python server/app.py --port 8080
```

For PowerShell, set `$env:OCEAN_STUDIO_DATA = 'D:/path/to/my-data'`, then run `python server/app.py --port 8080`.

See `samples/catalog.json` and the [sample-data guide](samples/README.md#english). GRIB2 decoding additionally requires `pip install -r requirements-grib.txt`.

## Structure

```text
server/            Read-only FastAPI backend
  app.py           /api/viz, /api/studio and built frontend
  api/             Grid, point, region, section, observations and matching endpoints
  core/            Grid slicing, observations / QC, matching and catalog
web/               React 19 + TypeScript + MapLibre GL 5 + uPlot; built with Vite
  src/studio/      Page, GPU layers, maps, panels and charts
  src/i18n/        English catalog and safe display-metadata localization
  src/i18n.ts      Locale selection, persistence and shareable language URLs
  public/          Offline Natural Earth basemap and fonts
samples/           Bundled samples and catalog.json
tools/             Basemap generation and deployment preparation
```

## Server access

The backend only reads catalog-registered files inside the configured data directory. It has **no authentication** and binds to `127.0.0.1` by default. If you expose it with `--host 0.0.0.0`, anyone who can reach the service can access catalog data. Use a reverse proxy or other access control for private deployments.

## Credits and license

Application code is under the [MIT License](LICENSE). **Sample data are excluded from the MIT license** and retain their original provider terms; see [provenance and attribution](samples/README.md#english).

Third-party components: [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) (BSD-3-Clause), [React](https://react.dev) (MIT), [uPlot](https://github.com/leeoniya/uPlot) (MIT), [Lucide](https://lucide.dev) (ISC), [Natural Earth](https://www.naturalearthdata.com) (public domain), [openmaptiles/fonts](https://github.com/openmaptiles/fonts) (OFL-1.1 / Apache-2.0), and approximate [cmocean](https://github.com/matplotlib/cmocean) color scales (MIT). The optional satellite basemap loads NASA GIBS Blue Marble imagery online.
