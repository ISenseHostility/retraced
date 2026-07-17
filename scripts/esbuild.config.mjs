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

export const outfile = path.join(root, "dist", `${meta.name}.plugin.js`);

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
    // chart libraries push the readable bundle past 1 MB — minified it stays reviewable
    // via the repo, and the BD meta banner/footer are emitted verbatim either way
    minify: true,
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
