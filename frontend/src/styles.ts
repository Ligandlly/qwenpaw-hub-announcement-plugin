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
.hub-ann-pick{width:100%;min-width:0;margin-top:24px;color:var(--app-text);font-family:inherit}
.hub-ann-pick-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;margin-top:24px;max-height:264px;overflow-y:auto;overscroll-behavior:contain;padding:2px;scrollbar-width:thin}
.hub-ann-pick-card{position:relative;display:flex;align-items:flex-start;gap:12px;min-height:64px;padding:12px 16px;text-align:left;font:inherit;font-size:var(--app-font-secondary,13px);color:var(--app-text);cursor:pointer;background:var(--app-surface-subtle);border:1px solid var(--app-border-subtle);border-radius:14px;transition:background-color var(--app-motion-fast,120ms) var(--app-easing-standard,ease),border-color var(--app-motion-fast,120ms) var(--app-easing-standard,ease)}
.hub-ann-pick-card:hover{background:var(--app-accent-faint);border-color:var(--app-accent-border)}
.hub-ann-pick-card.is-selected{background:var(--app-accent-faint);border-color:var(--app-selected-border,var(--app-accent-border))}
.hub-ann-pick-card[aria-disabled="true"]{opacity:.55;cursor:not-allowed;background:var(--app-surface-subtle);border-color:var(--app-border-subtle)}
.hub-ann-pick-body{min-width:0;display:block;flex:1}
.hub-ann-pick-name{display:flex;align-items:center;gap:6px;font-size:var(--app-font-secondary,13px);font-weight:500;line-height:1.4}
.hub-ann-pick-tag{flex:0 0 auto;font-size:var(--app-font-caption,12px);font-weight:400;padding:0 6px;border-radius:999px;color:var(--app-text-tertiary);background:color-mix(in srgb,var(--app-text) 8%,transparent)}
.hub-ann-pick-carddesc{margin:4px 0 0;font-size:var(--app-font-caption,12px);line-height:1.5;color:var(--app-text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.hub-ann-pick-check{position:absolute;top:10px;right:10px;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;line-height:1;color:#fff;border:1px solid var(--app-accent);background:var(--app-accent)}

.hub-ann-pick-skeleton .hub-ann-pick-card{pointer-events:none;cursor:default}
.hub-ann-pick-sk{display:block;border-radius:6px;background:color-mix(in srgb,var(--app-text) 10%,transparent);animation:hub-ann-pick-pulse 1.4s ease-in-out infinite}
.hub-ann-pick-sk-ava{flex:0 0 32px;width:32px;height:32px;border-radius:10px}
.hub-ann-pick-sk-title{width:74px;height:12px}
.hub-ann-pick-sk-line{width:100%;height:10px;margin-top:8px}
.hub-ann-pick-sk-line-short{width:62%;height:10px;margin-top:6px}
@keyframes hub-ann-pick-pulse{0%,100%{opacity:.5}50%{opacity:1}}

.hub-ann-pick-foot{margin-top:20px;display:flex;flex-direction:column;align-items:center;gap:8px}
.hub-ann-pick-hint{font-size:var(--app-font-caption,12px);color:var(--app-text-tertiary);text-align:center}

/* Fallbacks only — the console renders antd Button/Avatar, these keep the
   plugin coherent in a host that does not attach antd. */
.hub-ann-pick-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:var(--app-control-md,36px);padding:0 16px;font:inherit;font-size:var(--app-font-body,14px);font-weight:500;cursor:pointer;border:1px solid var(--app-border);border-radius:var(--app-radius,10px);background:var(--app-surface);color:var(--app-text);transition:background-color var(--app-motion-fast,120ms) var(--app-easing-standard,ease),border-color var(--app-motion-fast,120ms) var(--app-easing-standard,ease)}
.hub-ann-pick-btn:hover:not(:disabled){border-color:var(--app-accent-border);color:var(--app-accent-text)}
.hub-ann-pick-btn:disabled{cursor:not-allowed;opacity:.55}
.hub-ann-pick-btn-primary{background:var(--app-accent);border-color:var(--app-accent);color:#fff;box-shadow:0 2px 5px var(--app-accent-soft)}
.hub-ann-pick-btn-primary:hover:not(:disabled){background:var(--app-accent);border-color:var(--app-accent);color:#fff;opacity:.92}
@media (any-pointer:coarse){.hub-ann-pick-btn:not(.hub-ann-pick-retry){min-height:44px}}

.hub-ann-pick-error{margin-top:24px;display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px;border:1px solid var(--app-border-subtle);border-radius:var(--app-radius-card,16px);background:var(--app-surface-subtle)}
.hub-ann-pick-error-text{margin:12px 0 0;font-size:var(--app-font-caption,12px);line-height:1.6;color:#c0392b}
html.dark-mode .hub-ann-pick-error-text{color:#ff9a8f}

@media (max-width:520px){.hub-ann-pick-grid{grid-template-columns:1fr;max-height:none}}
@media (prefers-reduced-motion:reduce){.hub-ann-pick-card,.hub-ann-pick-btn{transition:none}.hub-ann-pick-sk{animation:none}}
@media (max-width: 600px) {
  .hub-ann-wrap { padding: 16px; }
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
