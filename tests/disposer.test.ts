import { describe, expect, test, vi } from "vitest";
import { Disposer } from "../src/lifecycle/disposer";

describe("Disposer", () => {
  test("runs cleanup functions in reverse registration order", () => {
    const order: number[] = [];
    const d = new Disposer();
    d.add(() => order.push(1));
    d.add(() => order.push(2));
    d.add(() => order.push(3));
    d.dispose();
    expect(order).toEqual([3, 2, 1]);
  });

  test("a throwing cleanup does not prevent the others from running", () => {
    const d = new Disposer();
    const ran: string[] = [];
    d.add(() => ran.push("a"));
    d.add(() => {
      throw new Error("boom");
    });
    d.add(() => ran.push("c"));
    expect(() => d.dispose()).not.toThrow();
    expect(ran).toEqual(["c", "a"]);
  });

  test("dispose is idempotent — second call runs nothing", () => {
    const d = new Disposer();
    const fn = vi.fn();
    d.add(fn);
    d.dispose();
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
