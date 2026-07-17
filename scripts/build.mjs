import esbuild from "esbuild";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBuildOptions, meta, outfile } from "./esbuild.config.mjs";

const watch = process.argv.includes("--watch");
const install = process.argv.includes("--install");

function bdPluginsDir() {
  if (process.env.BETTERDISCORD_PLUGINS_DIR) return process.env.BETTERDISCORD_PLUGINS_DIR;
  switch (process.platform) {
    case "win32":
      return path.join(process.env.APPDATA ?? "", "BetterDiscord", "plugins");
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", "BetterDiscord", "plugins");
    default:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "BetterDiscord", "plugins");
  }
}

function installToBd() {
  const dir = bdPluginsDir();
  if (!existsSync(dir)) {
    console.warn(`[build] BetterDiscord plugins folder not found (${dir}) — skipping install. Set BETTERDISCORD_PLUGINS_DIR to override.`);
    return;
  }
  const target = path.join(dir, path.basename(outfile));
  copyFileSync(outfile, target);
  console.log(`[build] installed -> ${target}`);
}

function report() {
  const bytes = statSync(outfile).size;
  console.log(`[build] ${path.relative(process.cwd(), outfile)} (${(bytes / 1024).toFixed(1)} KiB)`);
}

mkdirSync(path.dirname(outfile), { recursive: true });
const options = { ...createBuildOptions(), logLevel: "info" };

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: "retraced-after-build",
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length > 0) return;
            report();
            if (install) installToBd();
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log(`[build] watching ${meta.name} for changes…`);
} else {
  await esbuild.build(options);
  report();
  if (install) installToBd();
}
