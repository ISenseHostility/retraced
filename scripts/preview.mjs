import esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { root } from "./esbuild.config.mjs";

/** Builds and serves the visual preview harness (real React, synthetic data). */

const outDir = path.join(root, "dist", "preview");
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "scripts", "preview-entry.tsx")],
  outfile: path.join(outDir, "preview.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  jsx: "automatic",
  charset: "utf8",
  logLevel: "info",
});

const html = `<!doctype html><html><head><meta charset="utf-8"><title>booting…</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    font-family: "gg sans", "Segoe UI", "Noto Sans", sans-serif;
    background: var(--background-primary);
    --background-primary: #313338;
    --background-secondary: #2b2d31;
    --background-floating: #111214;
    --background-modifier-accent: rgba(255,255,255,0.06);
    --background-modifier-hover: rgba(255,255,255,0.04);
    --background-modifier-selected: rgba(255,255,255,0.12);
    --header-primary: #f2f3f5;
    --text-normal: #dbdee1;
    --text-muted: #949ba4;
    --interactive-normal: #b5bac1;
    --interactive-hover: #dbdee1;
    --interactive-active: #ffffff;
    --brand-500: #5865f2;
    --status-danger: #f23f43;
    --status-positive: #23a559;
    --font-primary: "gg sans", "Segoe UI", sans-serif;
  }
  body.light {
    --background-primary: #ffffff;
    --background-secondary: #f2f3f5;
    --background-floating: #ffffff;
    --background-modifier-accent: rgba(6,6,7,0.08);
    --background-modifier-hover: rgba(6,6,7,0.04);
    --background-modifier-selected: rgba(6,6,7,0.12);
    --header-primary: #060607;
    --text-normal: #2e3338;
    --text-muted: #5c5e66;
    --interactive-normal: #4e5058;
    --interactive-hover: #2e3338;
    --interactive-active: #060607;
  }
</style></head><body>
<script>if (new URLSearchParams(location.search).get("theme") === "light") document.body.classList.add("light");</script>
<script src="preview.js"></script>
</body></html>`;
writeFileSync(path.join(outDir, "index.html"), html);

const PORT = 8735;
const TYPES = { ".html": "text/html", ".js": "text/javascript" };
http
  .createServer((req, res) => {
    const name = (req.url ?? "/").split("?")[0];
    const file = name === "/" ? "index.html" : path.basename(name ?? "index.html");
    try {
      const body = readFileSync(path.join(outDir, file));
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "text/plain" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`[preview] http://127.0.0.1:${PORT}/ (?theme=light for light mode)`));
