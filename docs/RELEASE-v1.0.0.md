# Ocean Studio v1.0.0

Ocean Studio is an open-source browser workbench for local ocean and atmosphere model fields and in-situ observations.

**[Try the online demo](https://ocean-studio-tan.vercel.app/ocean-studio.html)** — full sample data and Python API included; no installation or login required. The demo uses bundled October 2026 data, not a live feed.

## Highlights

- 2D maps and a 3D globe with GPU field rendering and wind/current particles.
- Source comparisons: swipe, overlay, difference and linked side-by-side views.
- Vertical sections, point series, profiles and regional statistics.
- Observation platforms, tracks and source quality flags.
- Model–observation matching, including Argo profiles.
- Six example scenes and approximately 76 MiB of bundled, attributed real samples.
- React / TypeScript / MapLibre GL front end; a read-only FastAPI back end.

## Showcase video

Attached: **Ocean-Studio-showcase-X.mp4**, a 35-second 1920×1080 / 30 fps H.264 showcase with Chinese captions and no audio. It shows genuine 3D wind, wave source swipe, observations and model–observation matching from the bundled sample data. Source captures are 15 fps; captions and export are 30 fps. Video composition and capture script are included in `promo-video/`.

## Installation

Python 3.11+ and Node 20+ are required. Install requirements.txt, run npm ci and npm run build in web/, then python server/app.py. Open http://127.0.0.1:8000/. GRIB2 decoding needs requirements-grib.txt.

## License and samples

Application source: MIT. Data remain under their original provider terms; see samples/README.md. The video and online demo use bundled October 2026 sample dates, rather than a live data feed. The online demo is hosted on Vercel; the application can also be run locally.

## Validation

Existing Python API tests, front-end tests and a production front-end build pass on the publishing workstation. Browser smoke checks cover the captured demonstration scenes.
