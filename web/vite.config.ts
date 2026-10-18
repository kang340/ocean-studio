import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-ignore -- plain JS build helper (no Node type declarations in this project)
import precompress from "./gzip-plugin.js";

declare const process: { env: Record<string, string | undefined> };
// Dev: `npm run dev` proxies /api to the Python server (default http://127.0.0.1:8000, override with OCEAN_STUDIO_API).
const api = process.env.OCEAN_STUDIO_API || "http://127.0.0.1:8000";
export default defineConfig({
  plugins: [react(), precompress()],
  server: { proxy: { "/api": api } },
  preview: { proxy: { "/api": api } },
  build: { rollupOptions: { input: { studio: "ocean-studio.html" }, output: { manualChunks: { map: ["maplibre-gl"] } } } },
});
