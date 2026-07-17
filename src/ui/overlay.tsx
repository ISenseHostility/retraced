import type { ReactElement } from "react";
import { createRootIn, type RootLike } from "../patcher/react";

/**
 * Full-screen stats page host. Owns its DOM node and React root; guarantees
 * both are gone after close(). Mounted inside #app-mount when possible so
 * Discord's theme CSS variables cascade into the page.
 */
export class OverlayController {
  private el: HTMLDivElement | null = null;
  private root: RootLike | null = null;

  constructor(private readonly renderPage: (close: () => void) => ReactElement) {}

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  get isOpen(): boolean {
    return this.el !== null;
  }

  open(): void {
    if (this.el) return;

    const el = document.createElement("div");
    el.className = "retraced-overlay";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    (document.getElementById("app-mount") ?? document.body).appendChild(el);

    const root = createRootIn(el);
    if (!root) {
      el.remove();
      return;
    }

    this.el = el;
    this.root = root;
    document.addEventListener("keydown", this.onKeyDown, true);
    root.render(this.renderPage(() => this.close()));
  }

  close(): void {
    if (!this.el) return;
    const el = this.el;
    const root = this.root;
    this.el = null;
    this.root = null;
    document.removeEventListener("keydown", this.onKeyDown, true);
    // Deferred one microtask so close() is safe to call from inside a React
    // event handler rendered by this very root (e.g. the ✕ button).
    queueMicrotask(() => {
      root?.unmount();
      el.remove();
    });
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }
}
