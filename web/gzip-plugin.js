// Writes `.gz` siblings for text assets after `vite build`; the FastAPI static handler serves them.
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
export default function precompress() {
  return {
    name: 'precompress', apply: 'build',
    closeBundle() {
      const walk = dir => readdirSync(dir).forEach(name => {
        const p = join(dir, name), st = statSync(p);
        if (st.isDirectory()) return walk(p);
        if (!/\.(js|css|html|json|geojson|svg)$/.test(name) || st.size < 1024 || existsSync(p + '.gz')) return;
        writeFileSync(p + '.gz', gzipSync(readFileSync(p), { level: 9 }));
      });
      walk('dist');
    },
  };
}
