"use strict";
// esbuild aliases `react` here so nothing ever bundles a second React.
// Eager read is safe in the only context this file ships in: BetterDiscord
// defines window.BdApi before it loads any plugin.
module.exports = globalThis.BdApi.React;
