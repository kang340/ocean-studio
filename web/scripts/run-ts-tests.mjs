// Bundle each tests/*.test.ts with esbuild (already installed as a Vite dependency) and run it in node.
import { build } from "esbuild";
import { readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "ts-tests-"));
let failed = 0;
try {
  for (const f of readdirSync("tests").filter(f => f.endsWith(".test.ts"))) {
    const out = join(dir, f.replace(/\.ts$/, ".mjs"));
    await build({ entryPoints: [join("tests", f)], outfile: out, bundle: true, platform: "node", format: "esm", logLevel: "error" });
    try { await import(pathToFileURL(out).href); } catch (e) { failed++; console.error(`FAIL ${f}\n`, e); }
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
process.exit(failed ? 1 : 0);
