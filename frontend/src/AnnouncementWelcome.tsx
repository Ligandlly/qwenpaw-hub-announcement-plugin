import type * as ReactNS from "react";

import { AgentPicker } from "./AgentPicker";
import { AnnouncementCard } from "./AnnouncementCard";
import type { AgentSummary } from "./agents";
import {
  dismissAnnouncement,
  fetchFeed,
  type Announcement,
  type Feed,
  type Fetcher,
} from "./api";
import type { WelcomeProps } from "./NativeWelcome";
import { react } from "./react";

/** The requirement: never take over more than three announcements' worth. */
export const MAX_VISIBLE = 3;
/** The backend polls the service; the console only needs to re-read the cache. */
export const REFRESH_MS = 5 * 60 * 1000;

function keyOf(announcement: Announcement): string {
  return `${announcement.id}:${announcement.content_version}`;
}

export interface AnnouncementWelcomeProps {
  /** Payload the host passes to `welcome.render`. */
  hostProps: WelcomeProps;
  /** Test seam; production uses `window.QwenPaw.host.fetch`. */
  fetcher?: Fetcher;
  refreshMs?: number;
  /** Test seam; production reads `/agents` through the host bridge. */
  loadAgents?: () => Promise<AgentSummary[]>;
}

/**
 * The host welcome with the sample prompts replaced by the agent picker, and
 * unread announcements stacked beneath it. Announcements are decoration: any
 * failure here leaves the greeting and picker as the user has always seen them.
 */
export function AnnouncementWelcome({
  hostProps,
  fetcher,
  refreshMs = REFRESH_MS,
  loadAgents,
}: AnnouncementWelcomeProps): ReactNS.ReactElement {
  const React = react();
  const [feed, setFeed] = React.useState<Feed | null>(null);
  const [hidden, setHidden] = React.useState<string[]>([]);

  React.useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await fetchFeed(fetcher);
        if (alive) setFeed(next);
      } catch {
        // Keep whatever we already have; a failed refresh is not an error state.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), refreshMs);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetcher, refreshMs]);

  const dismiss = (announcement: Announcement) => {
    const key = keyOf(announcement);
    // Optimistic: the card leaves at once and comes back only if we could not
    // record the acknowledgement.
    setHidden((current) => [...current, key]);
    void dismissAnnouncement(announcement, fetcher).catch(() => {
      setHidden((current) => current.filter((item) => item !== key));
    });
  };

  const visible = (feed?.items ?? [])
    .filter((announcement) => !hidden.includes(keyOf(announcement)))
    .slice(0, MAX_VISIBLE);

  return (
    <div className="hub-ann-wrap">
      <AgentPicker loadAgents={loadAgents} />
      {visible.length > 0 ? (
        <div className="hub-ann-list" role="region" aria-label="公告">
          {visible.map((announcement) => (
            <AnnouncementCard
              key={announcement.id}
              announcement={announcement}
              onDismiss={dismiss}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
