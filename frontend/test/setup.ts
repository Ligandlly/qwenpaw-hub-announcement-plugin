import * as React from "react";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";

// The plugin runs on the host's React; in tests that instance is npm React.
// Re-applied before every test because a test may `vi.resetModules()`, which
// hands the plugin a fresh copy of `src/react.ts` with no cached instance.
beforeEach(async () => {
  const { setReactForTests } = await import("../src/react");
  setReactForTests(React);
});

afterEach(async () => {
  cleanup();
  const { removeStyles } = await import("../src/styles");
  removeStyles();
  delete (window as { QwenPaw?: unknown }).QwenPaw;
});
