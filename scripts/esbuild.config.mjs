import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const meta = JSON.parse(readFileSync(path.join(root, "plugin.meta.json"), "utf8"));

// BetterDiscord requires this comment block as the very first bytes of the file.
const META_FIELD_ORDER = ["name", "author", "description", "version", "invite", "authorId", "website", "source", "updateUrl"];
export const bdBanner = [
  "/**",
  ...META_FIELD_ORDER.filter((k) => meta[k]).map((k) => ` * @${k} ${meta[k]}`),
  " */",
].join("\n");

// The bundle is committed at the repo root — it is the release artifact users download.
export const outfile = path.join(root, `${meta.name}.plugin.js`);

const shim = (name) => path.join(root, "src", "shims", name);

export function createBuildOptions() {
  return {
    entryPoints: [path.join(root, "src", "index.ts")],
    outfile,
    bundle: true,
    format: "iife",
    globalName: "__RetracedExports",
    banner: { js: bdBanner },
    // BetterDiscord loads plugins through a CommonJS-style module wrapper.
    footer: { js: "module.exports = __RetracedExports.default;" },
    platform: "browser",
    target: ["chrome120"],
    jsx: "automatic",
    charset: "utf8",
    // Never minify: BetterDiscord requires plugin code to be human-readable for review,
    // and the committed root bundle is what users install. Size (>1 MB with the chart
    // libraries) is acceptable; the BD meta banner/footer are emitted verbatim.
    minify: false,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    // Never bundle React — everything resolves to Discord's own instance via BdApi.
    alias: {
      "react/jsx-runtime": shim("jsx-runtime.cjs"),
      "react/jsx-dev-runtime": shim("jsx-runtime.cjs"),
      "react-dom/client": shim("react-dom.cjs"),
      "react-dom": shim("react-dom.cjs"),
      react: shim("react.cjs"),
    },
  };
}
