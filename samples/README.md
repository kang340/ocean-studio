# 样例数据 / Sample data

[简体中文](#样例数据--sample-data) · [English](#english)

约 76 MB 的真实公开数据，时间互相重叠，用来演示要素浏览、多源对比、垂向断面和模式–观测匹配。文件清单见 `catalog.json`。

| 目录 | 内容 | 来源 / 许可 |
|---|---|---|
| `gfs/`、`compare/gfs_*` | GFS 0.25° 分析场（f000）：10 m 风、2 m 气温、海平面气压。2026-10-15 00/06/12/18Z，2026-10-10 00/06Z | NOAA NCEP，美国政府作品，公有领域 |
| `wavewatch/` | WAVEWATCH III 全球 0.25°：有效波高、峰值周期、波向。2026-10-15 00–18Z | NOAA NCEP，公有领域 |
| `copernicus/cmems_wave_*` | CMEMS 全球海浪分析预报（GLOBAL_ANALYSIS_FORECAST_WAV_001_027），西太平洋，3 小时 | E.U. Copernicus Marine Service Information |
| `copernicus/cmems_thetao_*`、`cmems_so_*` | CMEMS 全球海洋物理分析预报 0.083° 日均海温 / 盐度，40 层（0.5–1942 m），西北太平洋 | E.U. Copernicus Marine Service Information |
| `compare/era5_*` | ERA5 单层再分析：10 m 风、2 m 气温、海平面气压，2026-10-10 00/06Z | Copernicus Climate Change Service (C3S)，CC-BY 4.0 |
| `observations/OSMC_*` | NOAA OSMC 全球实时观测（浮标、船舶、岸站）：SST、风速、气压、波高，2026-10-15 | NOAA OSMC ERDDAP，公有领域 |
| `observations/ArgoFloats_*` | Argo 剖面浮标 T/S（含 QC 标志），西北太平洋，2026-10-12/15 | Argo，经 Ifremer ERDDAP。引用：Argo (2000). Argo float data and metadata from Global Data Assembly Centre (Argo GDAC). SEANOE. doi:10.17882/42182 |

使用或再发布这些数据时，请保留上表中的来源说明。Copernicus 数据的署名要求是 "Generated using E.U. Copernicus Marine Service Information" 和 "Contains modified Copernicus Climate Change Service information 2026"。

## 与原始文件相比做了什么

- NetCDF 用 zlib（level 6）重新压缩并存为 float32；数值舍入到远低于模式精度的位数（气压保留 1 Pa，风 / 波高 0.01，海温 / 盐度 0.001）。网格、时间和深度坐标不变。
- 全局属性只保留来源、机构和许可相关字段，`history` 注明了这次重新打包。
- OSMC CSV 去掉了逐字节完全相同的重复行（原文件 56.5 万行，去重后 19.1 万行）。表头与单位行保留。
- 数值没有插补、平滑或填充。

## 用你自己的数据

1. 把 NetCDF / GRIB2 / ERDDAP CSV 文件放进一个目录。
2. 在该目录里写一个 `catalog.json`，格式同本目录，`path` 相对于 `catalog.json`。
3. 启动时指定目录：`OCEAN_STUDIO_DATA=/path/to/dir python server/app.py`

`provider` 取值 `gfs`、`wavewatch`、`hycom`、`copernicus`、`era5`、`observations` 或 `custom`，用来识别变量名和单位。观测数据的 `dataset` 名会决定平台类型识别（例如 `ArgoFloats*` 识别为剖面浮标，`OSMC*` 识别为多平台实时观测）。

## English

Approximately 76 MiB of real public data with overlapping times, demonstrating element browsing, source comparisons, vertical sections and model–observation matching. These are historical samples from October 2026, not a live feed. See `catalog.json` for the manifest.

| Directory | Contents | Source / terms |
|---|---|---|
| `gfs/`, `compare/gfs_*` | GFS 0.25° analysis f000: 10 m wind, 2 m air temperature, sea-level pressure. October 15, 2026 00/06/12/18Z and October 10 00/06Z | NOAA NCEP; US government public-domain works |
| `wavewatch/` | WAVEWATCH III global 0.25° significant wave height, peak period and direction; October 15, 2026 00–18Z | NOAA NCEP; public domain |
| `copernicus/cmems_wave_*` | CMEMS GLOBAL_ANALYSIS_FORECAST_WAV_001_027, western Pacific, 3-hourly | E.U. Copernicus Marine Service Information |
| `copernicus/cmems_thetao_*`, `cmems_so_*` | CMEMS 0.083° daily temperature / salinity, 40 levels (0.5–1942 m), NW Pacific | E.U. Copernicus Marine Service Information |
| `compare/era5_*` | ERA5 single-level reanalysis: 10 m wind, 2 m air temperature, sea-level pressure; October 10, 2026 00/06Z | Copernicus Climate Change Service (C3S), CC-BY 4.0 |
| `observations/OSMC_*` | NOAA OSMC buoys, ships and coastal stations: SST, wind speed, pressure and wave height; October 15, 2026 | NOAA OSMC ERDDAP; public domain |
| `observations/ArgoFloats_*` | Argo temperature / salinity profiles with QC, NW Pacific; October 12–15, 2026 | Argo via Ifremer ERDDAP. Cite: Argo (2000). Argo float data and metadata from Global Data Assembly Centre (Argo GDAC). SEANOE. doi:10.17882/42182 |

Preserve provider attribution when using or redistributing data, including **Generated using E.U. Copernicus Marine Service Information** and **Contains modified Copernicus Climate Change Service information 2026**. Data are not covered by the application’s MIT license.

### Repackaging

- NetCDF is recompressed with zlib level 6 as float32. Numeric rounding is below model precision: pressure 1 Pa, wind / wave height 0.01, temperature / salinity 0.001. Grid, time and depth coordinates are retained.
- Global attributes retain source, institution and licensing fields; `history` records repackaging.
- Byte-identical OSMC CSV duplicates are removed, reducing roughly 565,000 rows to 191,000; header and units rows are retained.
- No interpolation, smoothing or filling is applied to the sample values.

### Bring your own data

1. Place NetCDF / GRIB2 / ERDDAP CSV files in a directory.
2. Add a `catalog.json` using the bundled manifest format; paths are relative to that file.
3. Launch with `OCEAN_STUDIO_DATA=/path/to/dir python server/app.py`.

Providers are `gfs`, `wavewatch`, `hycom`, `copernicus`, `era5`, `observations` or `custom`; these guide variable and unit recognition. Observation `dataset` names determine platform recognition: `ArgoFloats*` identifies profiling floats, while `OSMC*` identifies mixed-platform observations.
