"use strict";
// esbuild aliases `react-dom` and `react-dom/client` here — Discord's own
// ReactDOM as exposed by BetterDiscord. See src/patcher/react.ts for the
// fail-soft root factory that consumers should prefer over using this directly.
module.exports = globalThis.BdApi.ReactDOM;
