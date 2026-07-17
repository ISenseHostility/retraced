"use strict";
// Automatic-runtime JSX (`react/jsx-runtime`) backed by Discord's React.
// Both our own TSX and any bundled chart library compile down to these calls.
// React is resolved lazily per call so this module can load before BdApi
// exists (as it does under the test runner).

function react() {
  return globalThis.BdApi.React;
}

function jsx(type, props, key) {
  const R = react();
  if (key === undefined) return R.createElement(type, props);
  return R.createElement(type, { ...(props ?? {}), key });
}

module.exports = {
  get Fragment() {
    return react().Fragment;
  },
  jsx,
  jsxs: jsx,
  // Dev runtime passes extra (isStaticChildren, source, self) args — safely ignored.
  jsxDEV: jsx,
};
