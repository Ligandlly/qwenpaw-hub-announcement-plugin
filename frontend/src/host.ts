import type * as ReactNS from "react";

/**
 * The slice of `window.QwenPaw.host` this plugin uses. The Console owns React
 * and the HTTP client (which injects the API base URL and auth token), so the
 * bundle never imports either.
 */
export interface HostExternals {
  React: typeof ReactNS;
  fetch?: (path: string, init?: RequestInit) => Promise<Response>;
  useTheme?: () => "light" | "dark";
  useLocale?: () => string;
}

export interface WelcomeRenderProps {
  greeting?: unknown;
  description?: unknown;
  avatar?: unknown;
  prompts?: Array<string | { label?: unknown; value: string; icon?: unknown }>;
  onSubmit: (data: { query: string }) => void;
}

export interface WelcomeSlot {
  render?: (pluginId: string, value: unknown) => { dispose: () => void };
}

export interface QwenPawGlobal {
  host: HostExternals;
  chat?: { welcome?: WelcomeSlot };
}

declare global {
  interface Window {
    QwenPaw?: QwenPawGlobal;
  }
}

export function getGlobal(): QwenPawGlobal | null {
  return window.QwenPaw ?? null;
}

/** Resolved lazily: the bridge may not be installed when the bundle loads. */
export function getHost(): HostExternals | null {
  return getGlobal()?.host ?? null;
}

export function getWelcomeSlot(): WelcomeSlot | null {
  return getGlobal()?.chat?.welcome ?? null;
}
