# Ocean Studio v1.0.0

[简体中文](#简体中文) · [English](#english)

## 简体中文

Ocean Studio 是开源的海洋与大气数据浏览工作台，可查看本地模式网格场与现场观测。

**[中文在线体验](https://ocean-studio-tan.vercel.app/ocean-studio.html?lang=zh)** · [English demo](https://ocean-studio-tan.vercel.app/ocean-studio.html?lang=en)。附样例数据和 Python API，无需安装或登录。展示 2026 年 10 月历史样例，并非实时数据。

- 二维地图、三维地球、GPU 色斑与风 / 海流粒子。
- 卷帘、叠加、差值与并排联动对比；垂向断面、点位时间序列、剖面和区域统计。
- 观测平台、轨迹、原始 QC 与模式–观测匹配，支持 Argo 温盐剖面。
- 六个示例场景、约 76 MiB 真实样例、中文 / EN 语言切换与作者 GitHub 入口。
- 35 秒 1080p / 30 fps 展示视频，中文字幕，无声；实机素材为 15 fps。视频与复现源码见 `promo-video/`。

安装：建议 Python 3.12、Node.js 20+。安装 `requirements.txt`，在 `web/` 执行 `npm ci && npm run build`，再运行 `python server/app.py`。GRIB2 另需 `requirements-grib.txt`。

应用源码使用 MIT；样例数据保留原提供方许可，详见 `samples/README.md`。中英文使用说明分别见 `README.md` 与 `README.en.md`。

## English

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
- Chinese / English interface, persistent shareable language selection, bilingual documentation and an author GitHub profile link.

## Showcase video

Attached: **Ocean-Studio-showcase-X.mp4**, a 35-second 1920×1080 / 30 fps H.264 showcase with Chinese captions and no audio. It shows genuine 3D wind, wave source swipe, observations and model–observation matching from the bundled sample data. Source captures are 15 fps; captions and export are 30 fps. Video composition and capture script are included in `promo-video/`.

## Installation

Python 3.12 and Node 20+ are recommended. Install requirements.txt, run npm ci and npm run build in web/, then python server/app.py. Open http://127.0.0.1:8000/. GRIB2 decoding needs requirements-grib.txt.

## License and samples

Application source: MIT. Data remain under their original provider terms; see samples/README.md. The video and online demo use bundled October 2026 sample dates, rather than a live data feed. The online demo is hosted on Vercel; the application can also be run locally.

## Validation

Existing Python API tests, front-end tests and a production front-end build pass on the publishing workstation. Browser smoke checks cover the captured demonstration scenes.
