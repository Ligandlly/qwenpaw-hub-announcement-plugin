import { describe, expect, it, vi } from "vitest";

import {
  fetchAgents,
  isLaunchable,
  launchableAgents,
  pickDefaultAgent,
  sortAgents,
  type AgentSummary,
} from "../src/agents";

const agent = (
  id: string,
  name: string,
  enabled?: boolean,
): AgentSummary => ({ id, name, enabled });

function hostWith(response: unknown, ok = true): string[] {
  const paths: string[] = [];
  (window as unknown as { QwenPaw: unknown }).QwenPaw = {
    host: {
      React: {},
      fetch: async (path: string) => {
        paths.push(path);
        return { ok, status: ok ? 200 : 500, json: async () => response };
      },
    },
  };
  return paths;
}

describe("sortAgents", () => {
  it("puts enabled agents first, then sorts by name", () => {
    const sorted = sortAgents([
      agent("c", "Charlie", false),
      agent("b", "bravo"),
      agent("a", "alpha"),
      agent("d", "delta", true),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "b", "d", "c"]);
  });

  it("treats a missing enabled flag as enabled", () => {
    expect(isLaunchable(agent("a", "alpha"))).toBe(true);
    expect(isLaunchable(agent("b", "bravo", false))).toBe(false);
  });
});

describe("launchableAgents / pickDefaultAgent", () => {
  const list = [agent("a", "alpha"), agent("b", "bravo", false), agent("c", "charlie")];

  it("filters disabled agents", () => {
    expect(launchableAgents(list).map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("keeps the current agent when it is usable", () => {
    expect(pickDefaultAgent(list, "c")).toBe("c");
  });

  it("falls back to the first usable agent", () => {
    expect(pickDefaultAgent(list, "b")).toBe("a");
    expect(pickDefaultAgent(list, "missing")).toBe("a");
  });

  it("returns null when nothing is launchable", () => {
    expect(pickDefaultAgent([agent("b", "bravo", false)], "b")).toBeNull();
  });
});

describe("fetchAgents", () => {
  it("reads the agents array from the response envelope", async () => {
    hostWith({ agents: [agent("a", "alpha")] });
    await expect(fetchAgents()).resolves.toEqual([agent("a", "alpha")]);
  });

  it("accepts a bare array", async () => {
    hostWith([agent("a", "alpha")]);
    await expect(fetchAgents()).resolves.toEqual([agent("a", "alpha")]);
  });

  it("drops entries without an id", async () => {
    hostWith({ agents: [{ name: "no id" }, agent("a", "alpha")] });
    await expect(fetchAgents()).resolves.toEqual([agent("a", "alpha")]);
  });

  it("throws on a non-2xx response", async () => {
    hostWith({ agents: [] }, false);
    await expect(fetchAgents()).rejects.toMatchObject({ status: 500 });
  });

  it("asks the host for the API-relative path, never /api/api/...", async () => {
    const paths = hostWith({ agents: [agent("a", "alpha")] });
    await fetchAgents();
    expect(paths).toEqual(["/agents"]);
  });

  it("adds exactly one /api when the host only exposes apiBaseUrl", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      requested.push(url);
      return { ok: true, status: 200, json: async () => ({ agents: [] }) };
    });
    (window as unknown as { QwenPaw: unknown }).QwenPaw = {
      host: { React: {}, apiBaseUrl: "" },
    };
    await fetchAgents();
    vi.unstubAllGlobals();
    expect(requested).toEqual(["/api/agents"]);
  });
});
