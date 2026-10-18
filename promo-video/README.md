# Ocean Studio showcase source

35 seconds, 1920×1080, 30 fps, H.264 MP4. Silent Chinese captions are designed for muted social feeds. `../media/Ocean-Studio-showcase-X.mp4` is the final export; `../media/watch.html` is the browser player.

## Contents

- `index.html`: HyperFrames composition, one deterministic GSAP timeline.
- `design.md`: storyboard, brand palette and data-disclosure rules.
- `assets/*.mp4`: genuine Ocean Studio captures at 1600×900, 15 fps. The 30 fps export repeats those source frames while titles animate at 30 fps.
- `capture.cjs`: repeatable Playwright screenshot-to-FFmpeg capture, with actual globe/swipe interaction and model–observation matching.
- `assets/capture-report.json`: browser errors and actual matching output from the capture run.

## Capture

Start Ocean Studio first. Install Node.js 22+, Chrome, FFmpeg and the local capture dependency (`npm install` in this directory). Set environment variables for your installation; on PowerShell:

```powershell
$env:OCEAN_STUDIO_URL = 'http://127.0.0.1:8018/ocean-studio.html'
$env:HYPERFRAMES_BROWSER_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:HYPERFRAMES_FFMPEG_PATH = 'C:/path/to/ffmpeg.exe'
$env:HYPERFRAMES_FFPROBE_PATH = 'C:/path/to/ffprobe.exe'
npm run capture
npm run check
npm run render -- --fps 30 --quality high --workers 2 --output ../media/Ocean-Studio-showcase-X.mp4
```

The optional `PLAYWRIGHT_MODULE` variable may point to an existing playwright-core installation. The capture uses the bundled October 2026 samples. It is a demonstration of local files, not a live data feed.

## Provenance and licenses

Captures were created from this project's application. The data shown retain their original provider terms: see `../samples/README.md` for GFS, WAVEWATCH III, CMEMS, OSMC and Argo attribution. In particular: Generated using E.U. Copernicus Marine Service Information.

Composition and capture source follow the repository's MIT license. `assets/gsap.min.js` is GSAP 3.14.2, copyright GreenSock, and retains its own Standard License notice. No soundtrack or generated narration is included.

The full HyperFrames check passes with zero errors. Its seven structural warnings recommend splitting this compact single-file composition into sub-compositions; runtime, layout and contrast checks pass.
