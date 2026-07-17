import { describe, expect, test } from "vitest";
import { bigrams, tokenize } from "../src/util/tokenize";

describe("tokenize", () => {
  test("lowercases, splits, and strips edge punctuation", () => {
    expect(tokenize("Hello, World! (really)")).toEqual(["hello", "world", "really"]);
  });

  test("keeps interior apostrophes and hyphens", () => {
    expect(tokenize("don't over-think")).toEqual(["don't", "over-think"]);
  });

  test("drops URLs, custom emoji, and mentions", () => {
    expect(tokenize("look https://example.com/x?q=1 <:pog:12345> <@98765> ok")).toEqual(["look", "ok"]);
  });

  test("drops empties and over-long tokens", () => {
    expect(tokenize("a ... " + "x".repeat(40))).toEqual(["a"]);
  });

  test("handles unicode words", () => {
    expect(tokenize("héllo wörld こんにちは")).toEqual(["héllo", "wörld", "こんにちは"]);
  });
});

describe("bigrams", () => {
  test("joins consecutive tokens", () => {
    expect(bigrams(["a", "b", "c"])).toEqual(["a b", "b c"]);
  });

  test("fewer than two tokens yields none", () => {
    expect(bigrams(["a"])).toEqual([]);
    expect(bigrams([])).toEqual([]);
  });
});
