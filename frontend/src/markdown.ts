import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

let hooksInstalled = false;

function installLinkPolicy(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  // Announcements come from a central service: always open links in a new tab
  // and drop the opener reference.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName !== "A") return;
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  });
}

/**
 * Markdown in, sanitised HTML out. The announcement body is written by the
 * operator, but it travels through a network service — treat it as untrusted.
 */
export function renderMarkdown(source: string): string {
  const text = source.trim();
  if (!text) return "";
  installLinkPolicy();
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"],
  });
}
