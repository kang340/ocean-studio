# 在线部署

公开体验：https://ocean-studio-tan.vercel.app/ocean-studio.html

这是包含 FastAPI 和样例数据的完整应用，前端不依赖开发者本机的 localhost。Vercel 运行 Python 3.12；前端使用 Node 构建，静态资源由 CDN 分发。样例数据保留原提供方许可。

## 部署

1. 安装 Vercel CLI 并登录自己的账号。
2. 在项目根目录运行 `vercel deploy` 生成预览，确认后运行 `vercel deploy --prod` 发布。
3. 新项目首次部署可能直接成为 production。Vercel 的项目名称和域名以实际返回值为准。

`pyproject.toml` 固定 Python 与依赖，并声明 `server.app:app` 入口；`vercel.json` 构建前端并打包样例数据；`tools/prepare_vercel.py` 将前端产物复制到 `public/`。`public/` 和 `.vercel/` 是本地生成目录，不提交到 Git。视频素材和 node_modules 不进入函数包。

部署使用 CLI；若希望 GitHub 推送后自动部署，需在 Vercel 账号设置中连接 GitHub，再将仓库连接到项目。当前仓库本身不包含任何部署凭据。

## 范围

在线版展示仓库附带的 2026 年 10 月数据，非实时流。服务空闲后的首次请求可能冷启动；大规模计算和自己的私有数据建议本地或独立服务器运行。读取额外 GRIB2 文件仍需安装 `requirements-grib.txt`。
