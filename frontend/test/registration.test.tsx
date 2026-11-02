import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { DISMISS_PATH, FEED_PATH, PLUGIN_ID } from "../src/api";

interface Rendered {
  pluginId: string;
  render: (props: unknown) => React.ReactElement;
}

function installHost(fetchImpl?: (path: string, init?: RequestInit) => Promise<Response>): Rendered[] {
  const rendered: Rendered[] = [];
  (window as unknown as { QwenPaw: unknown }).QwenPaw = {
    host: {
      React,
      fetch:
        fetchImpl ??
        (async () =>
          new Response(JSON.stringify({ fetched_at: null, items: [], stale: false }), {
            status: 200,
          })),
    },
    chat: {
      welcome: {
        render: (pluginId: string, value: unknown) => {
          rendered.push({ pluginId, render: value as Rendered["render"] });
          return { dispose: () => rendered.pop() };
        },
      },
    },
  };
  return rendered;
}

describe("registration", () => {
  it("registers the welcome slot for this plugin id and injects styles", async () => {
    vi.resetModules();
    const rendered = installHost();
    const index = await import("../src/index");

    expect(index.register()).toBe(true);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].pluginId).toBe(PLUGIN_ID);
    expect(document.getElementById("hub-announcement-styles")).not.toBeNull();

    index.unregister();
    expect(rendered).toHaveLength(0);
    expect(document.getElementById("hub-announcement-styles")).toBeNull();
  });

  it("does nothing when the bridge is missing", async () => {
    vi.resetModules();
    delete (window as { QwenPaw?: unknown }).QwenPaw;
    const index = await import("../src/index");
    expect(index.register()).toBe(false);
  });

  it("renders through the host-provided React and fetches the cache", async () => {
    vi.resetModules();
    const rendered = installHost(async (path) => {
      if (path !== FEED_PATH) return new Response("{}", { status: 404 });
      return new Response(
        JSON.stringify({
          fetched_at: "2026-11-02T14:05:00Z",
          stale: false,
          items: [
            {
              id: "a1",
              title: "停机升级",
              body_md: "",
              published_at: "2026-11-02T14:00:00Z",
              content_version: "v1",
            },
          ],
        }),
        { status: 200 },
      );
    });
    // The bundle registers itself on import; that call is the one we inspect.
    const index = await import("../src/index");
    expect(index.register()).toBe(true);
    expect(rendered).toHaveLength(1);
    render(rendered[0].render({ greeting: "你好", onSubmit: vi.fn() }));

    expect(await screen.findByText("停机升级")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("你好");
    index.unregister();
  });

  it("posts dismissals to the plugin route, never the central service", async () => {
    const calls: string[] = [];
    installHost(async (path) => {
      calls.push(path);
      return new Response("{}", { status: 200 });
    });
    const api = await import("../src/api");
    await api.dismissAnnouncement({
      id: "a1",
      title: "t",
      body_md: "",
      published_at: "",
      content_version: "v1",
    });
    expect(calls).toEqual([DISMISS_PATH]);
    await waitFor(() => expect(calls).toHaveLength(1));
  });
});
