import { warn } from "../env/bd";

/**
 * Cleanup registry backing the plugin's lifecycle guarantee: every side effect
 * (listener, timer, patch, style, mounted root) registers its undo here, and
 * stop() runs them all. Reverse order so dependents tear down before dependees.
 */
export class Disposer {
  private fns: Array<() => void> = [];

  add(fn: () => void): void {
    this.fns.push(fn);
  }

  dispose(): void {
    const fns = this.fns;
    this.fns = [];
    for (let i = fns.length - 1; i >= 0; i--) {
      try {
        fns[i]!();
      } catch (e) {
        warn("a cleanup step failed (continuing with the rest)", e);
      }
    }
  }
}
