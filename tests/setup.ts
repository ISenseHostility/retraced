import { beforeEach, afterEach } from "vitest";
import { createBdApiMock } from "./bdapi-mock";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  (globalThis as any).BdApi = createBdApiMock();
});

afterEach(() => {
  // build.test.ts runs in a node environment where there is no document
  if (typeof document !== "undefined") document.body.replaceChildren();
  delete (globalThis as any).BdApi;
});
