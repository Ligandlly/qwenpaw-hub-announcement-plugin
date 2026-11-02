import type * as ReactNS from "react";

import type { Announcement } from "./api";
import { renderMarkdown } from "./markdown";
import { react } from "./react";

/** `2026-11-02T14:01:09Z` → the operator's own short local date. */
export function formatPublished(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return value;
  }
}

export interface AnnouncementCardProps {
  announcement: Announcement;
  onDismiss: (announcement: Announcement) => void;
}

export function AnnouncementCard({
  announcement,
  onDismiss,
}: AnnouncementCardProps): ReactNS.ReactElement {
  const React = react();
  const html = renderMarkdown(announcement.body_md);
  return (
    <article className="hub-ann-card" aria-label={announcement.title}>
      <header className="hub-ann-head">
        <h3 className="hub-ann-title">{announcement.title}</h3>
        <time className="hub-ann-time" dateTime={announcement.published_at}>
          {formatPublished(announcement.published_at)}
        </time>
      </header>
      {html ? (
        <div
          className="hub-ann-body"
          // Sanitised by DOMPurify in renderMarkdown().
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
      <footer className="hub-ann-foot">
        <button
          type="button"
          className="hub-ann-dismiss"
          onClick={() => onDismiss(announcement)}
        >
          知道了
        </button>
      </footer>
    </article>
  );
}
