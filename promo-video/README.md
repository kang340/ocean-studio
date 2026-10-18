# Ocean Studio showcase source

[简体中文](#简体中文) · [English](#contents)

## 简体中文

35 秒展示视频，1920×1080、30 fps、H.264 MP4，中文字幕、无声。成片为 `../media/Ocean-Studio-showcase-X.mp4`。视频中的网页录制于双语功能上线前，使用中文界面；当前在线网页可通过右上角中文 / EN 切换。

`index.html` 是 HyperFrames 视频合成；`design.md` 是分镜设计；`capture.cjs` 通过 Playwright 与 FFmpeg 录制真实网页交互。源素材为 1600×900、15 fps，30 fps 输出复用源帧，标题以 30 fps 动画。

复现：先启动 Ocean Studio，安装 Node.js 22+、Chrome、FFmpeg，并在本目录执行 `npm install`；按下方 PowerShell 命令配置路径后，依次执行 `npm run capture`、`npm run check`、`npm run render`。素材使用 2026 年 10 月历史样例，并非实时流。

数据署名与许可见 `../samples/README.md`；合成和录制代码使用 MIT，GSAP 保留自身许可。没有配乐或生成旁白。下方提供完整英文说明与命令。

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
