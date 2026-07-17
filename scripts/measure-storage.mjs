import esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { root } from "./esbuild.config.mjs";

/**
 * Builds the storage-measurement harness and serves it on localhost so it can
 * run against a real browser's IndexedDB. Open the URL (or drive it with a
 * browser automation tool); the page title flips to MEASURE_DONE and
 * window.__measure holds the numbers.
 */

const outDir = path.join(root, "dist", "measure");
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "scripts", "measure-entry.ts")],
  outfile: path.join(outDir, "measure.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  charset: "utf8",
  logLevel: "info",
});

writeFileSync(
  path.join(outDir, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><title>measuring…</title></head><body>loading…<script src="measure.js"></script></body></html>`
);

const PORT = 8734;
const TYPES = { ".html": "text/html", ".js": "text/javascript" };

const server = http.createServer((req, res) => {
  const name = req.url === "/" || !req.url ? "index.html" : req.url.replace(/^\//, "");
  try {
    const file = readFileSync(path.join(outDir, path.basename(name)));
    res.writeHead(200, { "content-type": TYPES[path.extname(name)] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[measure] serving http://127.0.0.1:${PORT}/ — page title becomes MEASURE_DONE when finished`);
});
