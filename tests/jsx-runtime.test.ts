import React from "react";
import { describe, expect, test } from "vitest";
// The shim BdApi-bundled chart libraries and our own JSX compile against.
import runtime from "../src/shims/jsx-runtime.cjs";

describe("jsx-runtime shim", () => {
  test("jsx produces a valid React element with children from props", () => {
    const el = runtime.jsx("div", { children: "x", title: "t" });
    expect(React.isValidElement(el)).toBe(true);
    expect(el.type).toBe("div");
    expect(el.props.children).toBe("x");
    expect(el.props.title).toBe("t");
    expect(el.key).toBeNull();
  });

  test("jsx lifts the key argument onto the element", () => {
    // Note: dev builds of React define a warning getter for props.key, so we
    // assert the lifted key and surviving props — not absence from props.
    const el = runtime.jsx("li", { children: "x", title: "t" }, "k1");
    expect(el.key).toBe("k1");
    expect(el.props.children).toBe("x");
    expect(el.props.title).toBe("t");
  });

  test("jsxs handles static children arrays", () => {
    const el = runtime.jsxs("ul", {
      children: [runtime.jsx("li", { children: "a" }, "a"), runtime.jsx("li", { children: "b" }, "b")],
    });
    expect(React.isValidElement(el)).toBe(true);
    expect(el.props.children).toHaveLength(2);
  });

  test("jsxDEV tolerates the extra dev-runtime arguments", () => {
    const jsxDEV = runtime.jsxDEV as (...args: unknown[]) => any;
    const el = jsxDEV("span", { children: "x" }, "k2", false, undefined, undefined);
    expect(React.isValidElement(el)).toBe(true);
    expect(el.key).toBe("k2");
  });

  test("Fragment resolves to Discord's React.Fragment", () => {
    expect(runtime.Fragment).toBe(React.Fragment);
  });

  test("jsx tolerates null props", () => {
    const el = runtime.jsx("br", null);
    expect(React.isValidElement(el)).toBe(true);
  });
});
