import { getHost } from "./host";

/**
 * Paths are relative to the plugin's PawApp: `window.QwenPaw.host.fetch`
 * prepends `/api` itself, so never include it here.
 */
export const PLUGIN_ID = "hub-announcement";
export const FEED_PATH = `/${PLUGIN_ID}/announcements`;
export const DISMISS_PATH = `/${PLUGIN_ID}/announcements/dismiss`;

export interface Announcement {
  id: string;
  title: string;
  body_md: string;
  published_at: string;
  content_version: string;
}

export interface Feed {
  fetched_at: string | null;
  items: Announcement[];
  stale: boolean;
}

export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

/** Who talks to the plugin backend: the host bridge, or a test double. */
export function resolveFetch(explicit?: Fetcher): Fetcher | null {
  if (explicit) return explicit;
  const hostFetch = getHost()?.fetch;
  return typeof hostFetch === "function"
    ? (path, init) => hostFetch.call(getHost(), path, init)
    : null;
}

function toItems(raw: unknown): Announcement[] {
  if (!Array.isArray(raw)) return [];
  const items: Announcement[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id : "";
    const title = typeof value.title === "string" ? value.title : "";
    if (!id || !title) continue;
    items.push({
      id,
      title,
      body_md: typeof value.body_md === "string" ? value.body_md : "",
      published_at:
        typeof value.published_at === "string" ? value.published_at : "",
      content_version:
        typeof value.content_version === "string" ? value.content_version : "",
    });
  }
  return items;
}

export async function fetchFeed(fetcher?: Fetcher): Promise<Feed> {
  const request = resolveFetch(fetcher);
  if (!request) throw new Error("[hub-announcement] host fetch unavailable");
  const response = await request(FEED_PATH, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`[hub-announcement] feed failed (${response.status})`);
  }
  const payload = await response.json();
  const data = (payload ?? {}) as Record<string, unknown>;
  return {
    fetched_at: typeof data.fetched_at === "string" ? data.fetched_at : null,
    items: toItems(data.items),
    stale: data.stale === true,
  };
}

export async function dismissAnnouncement(
  announcement: Announcement,
  fetcher?: Fetcher,
): Promise<void> {
  const request = resolveFetch(fetcher);
  if (!request) throw new Error("[hub-announcement] host fetch unavailable");
  const response = await request(DISMISS_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: announcement.id,
      content_version: announcement.content_version,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `[hub-announcement] dismiss failed (${response.status})`,
    );
  }
}
