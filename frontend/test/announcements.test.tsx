import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AnnouncementWelcome } from "../src/AnnouncementWelcome";
import { DISMISS_PATH, FEED_PATH, type Announcement, type Fetcher } from "../src/api";

function announcement(index: number, extra: Partial<Announcement> = {}): Announcement {
  return {
    id: `a${index}`,
    title: `公告 ${index}`,
    body_md: `正文 **${index}**`,
    published_at: "2026-11-02T14:00:00Z",
    content_version: `v${index}`,
    ...extra,
  };
}

interface Call {
  path: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A `host.fetch` double that records calls and answers from a queue. */
function makeFetcher(
  feed: Announcement[] | (() => Response),
  dismiss: () => Response = () => jsonResponse({ dismissed: {} }),
): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (path, init) => {
    calls.push({ path, init });
    if (path === DISMISS_PATH) return dismiss();
    if (path !== FEED_PATH) return jsonResponse({ detail: "not found" }, 404);
    if (typeof feed === "function") return feed();
    return jsonResponse({ fetched_at: "2026-11-02T14:05:00Z", items: feed, stale: false });
  };
  return { fetcher, calls };
}

const HOST_PROPS = {
  greeting: "今天想做点什么？",
  description: "选一个开始，或直接输入。",
  avatar: "/qwenpaw.png",
  prompts: [{ label: "写周报", value: "帮我写周报" }],
  onSubmit: vi.fn(),
};

describe("AnnouncementWelcome", () => {
  it("keeps the host welcome and stacks announcements under it", async () => {
    const { fetcher } = makeFetcher([announcement(1)]);
    render(<AnnouncementWelcome hostProps={HOST_PROPS} fetcher={fetcher} />);

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("今天想做点什么？");
    expect(screen.getByText("选一个开始，或直接输入。")).toBeTruthy();
    expect(document.querySelector('img[src="/qwenpaw.png"]')).not.toBeNull();
    expect(screen.getByText("写周报")).toBeTruthy();

    const card = await screen.findByRole("article");
    expect(card.textContent).toContain("公告 1");
    expect(card.querySelector(".hub-ann-body strong")?.textContent).toBe("1");
  });

  it("still submits prompts and keeps the host callback", async () => {
    const onSubmit = vi.fn();
    const { fetcher } = makeFetcher([]);
    render(
      <AnnouncementWelcome hostProps={{ ...HOST_PROPS, onSubmit }} fetcher={fetcher} />,
    );
    fireEvent.click(screen.getByText("写周报"));
    expect(onSubmit).toHaveBeenCalledWith({ query: "帮我写周报" });
  });

  it("shows at most three announcements, newest first", async () => {
    const { fetcher } = makeFetcher([1, 2, 3, 4].map((n) => announcement(n)));
    render(<AnnouncementWelcome hostProps={HOST_PROPS} fetcher={fetcher} />);

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(3));
    expect(screen.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual([
      "公告 1",
      "公告 2",
      "公告 3",
    ]);
  });

  it("records a dismissal and hides the card", async () => {
    const { fetcher, calls } = makeFetcher([announcement(1)]);
    render(<AnnouncementWelcome hostProps={HOST_PROPS} fetcher={fetcher} />);

    fireEvent.click(await screen.findByText("知道了"));

    await waitFor(() => expect(screen.queryByRole("article")).toBeNull());
    const posted = calls.find((call) => call.path === DISMISS_PATH);
    expect(posted?.init?.method).toBe("POST");
    expect(JSON.parse(String(posted?.init?.body))).toEqual({
      id: "a1",
      content_version: "v1",
    });
  });

  it("brings the card back when the dismissal cannot be stored", async () => {
    const { fetcher } = makeFetcher([announcement(1)], () =>
      jsonResponse({ detail: "boom" }, 500),
    );
    render(<AnnouncementWelcome hostProps={HOST_PROPS} fetcher={fetcher} />);

    fireEvent.click(await screen.findByText("知道了"));

    await waitFor(() => expect(screen.getByRole("article")).toBeTruthy());
  });

  it("renders nothing extra when the feed is empty", async () => {
    const { fetcher, calls } = makeFetcher([]);
    const { container } = render(
      <AnnouncementWelcome hostProps={HOST_PROPS} fetcher={fetcher} />,
    );

    await waitFor(() => expect(calls.length).toBe(1));
    expect(container.querySelector(".hub-ann-list")).toBeNull();
    expect(screen.getByRole("heading", { level: 2 })).toBeTruthy();
  });

  it("survives an unreachable backend", async () => {
    const { fetcher } = makeFetcher(() => jsonResponse({ detail: "down" }, 503));
    render(<AnnouncementWelcome hostProps={HOST_PROPS} fetcher={fetcher} />);

    await waitFor(() => expect(screen.getByRole("heading", { level: 2 })).toBeTruthy());
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("sanitises announcement markdown", async () => {
    const hostile = announcement(1, {
      body_md:
        '正文 [链接](https://example.com) <script>alert(1)</script><img src="x" onerror="alert(2)">',
    });
    const { fetcher } = makeFetcher([hostile]);
    render(<AnnouncementWelcome hostProps={HOST_PROPS} fetcher={fetcher} />);

    const card = await screen.findByRole("article");
    const body = card.querySelector(".hub-ann-body");
    expect(body?.querySelector("script")).toBeNull();
    expect(body?.innerHTML).not.toContain("onerror");
    const link = body?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("treats an empty body as text-free", async () => {
    const { fetcher } = makeFetcher([announcement(1, { body_md: "   " })]);
    render(<AnnouncementWelcome hostProps={HOST_PROPS} fetcher={fetcher} />);

    const card = await screen.findByRole("article");
    expect(card.querySelector(".hub-ann-body")).toBeNull();
  });
});
