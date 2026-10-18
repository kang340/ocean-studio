# 样例数据 / Sample data

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
