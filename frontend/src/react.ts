import type * as ReactNS from "react";

import { getHost } from "./host";

/**
 * The host owns React. Components read it through `react()` at render time so
 * the bundle never imports react and never ends up with a second copy.
 */
let cached: typeof ReactNS | null = null;

export function react(): typeof ReactNS {
  if (!cached) {
    const instance = getHost()?.React;
    if (!instance) {
      throw new Error(
        "[hub-announcement] window.QwenPaw.host.React is unavailable",
      );
    }
    cached = instance;
  }
  return cached;
}

/** Test seam: vitest renders with the npm React instead of the host one. */
export function setReactForTests(instance: typeof ReactNS | null): void {
  cached = instance;
}
