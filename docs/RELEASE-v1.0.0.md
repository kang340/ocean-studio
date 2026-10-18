# Ocean Studio v1.0.0

Ocean Studio is an open-source browser workbench for local ocean and atmosphere model fields and in-situ observations.

## Highlights

- 2D maps and a 3D globe with GPU field rendering and wind/current particles.
- Source comparisons: swipe, overlay, difference and linked side-by-side views.
- Vertical sections, point series, profiles and regional statistics.
- Observation platforms, tracks and source quality flags.
- Model–observation matching, including Argo profiles.
- Six example scenes and approximately 76 MiB of bundled, attributed real samples.
- React / TypeScript / MapLibre GL front end; a read-only FastAPI back end.

## Run locally

Python 3.11+ and Node 20+ are required. Install requirements.txt, run npm ci and npm run build in web/, then python server/app.py. Open http://127.0.0.1:8000/. GRIB2 decoding needs requirements-grib.txt.

## License and samples

Application source: MIT. Data remain under their original provider terms; see samples/README.md. The video uses the bundled October 2026 sample dates, rather than a live data feed. This release is a local application; the GitHub repository does not host its Python API as a public web service.

## Validation

Existing Python API tests, front-end tests and a production front-end build pass on the publishing workstation. Browser smoke checks cover the captured demonstration scenes.
