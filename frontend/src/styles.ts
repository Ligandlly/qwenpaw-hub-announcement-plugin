const STYLE_ID = "hub-announcement-styles";

/**
 * The host renders the welcome inside its own CSS-module scope, so the plugin
 * cannot reuse those class names. These rules reuse the console's `--app-*`
 * design tokens instead, which keeps light/dark and accent changes for free.
 */
const CSS = `
.hub-ann-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  min-width: 0;
  max-width: 560px;
  margin: auto;
  padding: 24px;
  text-align: center;
}
.hub-ann-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
}
.hub-ann-greeting {
  margin: 20px 0 8px;
  font-size: clamp(20px, 2vw, 26px);
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.025em;
}
.hub-ann-description {
  margin: 0;
  font-size: 13px;
  color: var(--app-text-secondary);
  line-height: 1.6;
  text-wrap: pretty;
}
.hub-ann-prompts {
  display: grid;
  gap: 8px;
  width: 100%;
  max-width: 380px;
  margin-top: 24px;
}
.hub-ann-prompt {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 12px 16px;
  border: 1px solid var(--app-border-subtle);
  border-radius: 14px;
  background: var(--app-surface-subtle);
  color: var(--app-text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.hub-ann-prompt > span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.hub-ann-prompt:hover {
  background: var(--app-accent-faint);
  border-color: var(--app-accent-border);
}
.hub-ann-list {
  display: grid;
  gap: 8px;
  width: 100%;
  margin-top: 20px;
  text-align: left;
}
.hub-ann-card {
  padding: 14px 16px;
  border: 1px solid var(--app-border-subtle);
  border-left: 3px solid var(--app-accent);
  border-radius: 14px;
  background: var(--app-surface-subtle);
}
.hub-ann-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.hub-ann-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text);
  overflow-wrap: anywhere;
}
.hub-ann-time {
  flex: none;
  font-size: 12px;
  color: var(--app-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.hub-ann-body {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--app-text-secondary);
  overflow-wrap: anywhere;
}
.hub-ann-body > :first-child { margin-top: 0; }
.hub-ann-body > :last-child { margin-bottom: 0; }
.hub-ann-body p { margin: 0 0 0.6em; }
.hub-ann-body ul, .hub-ann-body ol { margin: 0 0 0.6em; padding-left: 1.3em; }
.hub-ann-body li { margin: 0.2em 0; }
.hub-ann-body a { color: var(--app-accent-text); text-decoration: underline; }
.hub-ann-body strong { color: var(--app-text); }
.hub-ann-body code {
  padding: 1px 5px;
  border-radius: 6px;
  background: var(--app-fill-subtle);
  font-family: var(--app-font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 12px;
}
.hub-ann-body pre {
  margin: 0 0 0.6em;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--app-fill-subtle);
  overflow-x: auto;
}
.hub-ann-body pre code { padding: 0; background: none; }
.hub-ann-body blockquote {
  margin: 0 0 0.6em;
  padding-left: 10px;
  border-left: 2px solid var(--app-border-strong);
  color: var(--app-text-tertiary);
}
.hub-ann-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.hub-ann-dismiss {
  padding: 4px 12px;
  border: 1px solid var(--app-border-subtle);
  border-radius: 9px;
  background: transparent;
  color: var(--app-text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.hub-ann-dismiss:hover {
  background: var(--app-fill-subtle);
  color: var(--app-text);
}
@media (max-width: 600px) {
  .hub-ann-wrap { padding: 16px; }
  .hub-ann-prompt { padding: 12px; }
}
`;

export function injectStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const element = doc.createElement("style");
  element.id = STYLE_ID;
  element.textContent = CSS;
  doc.head.appendChild(element);
}

export function removeStyles(doc: Document = document): void {
  doc.getElementById(STYLE_ID)?.remove();
}
