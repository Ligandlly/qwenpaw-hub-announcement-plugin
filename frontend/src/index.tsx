import { AnnouncementWelcome } from "./AnnouncementWelcome";
import { PLUGIN_ID } from "./api";
import { getWelcomeSlot } from "./host";
import type { WelcomeProps } from "./NativeWelcome";
import { react } from "./react";
import { injectStyles, removeStyles } from "./styles";

interface Registration {
  dispose: () => void;
}

let registration: Registration | null = null;

/**
 * Take over the chat welcome slot. Idempotent, and a no-op until the host
 * bridge exists. Returns whether the slot is registered.
 */
export function register(pluginId: string = PLUGIN_ID): boolean {
  const slot = getWelcomeSlot();
  if (!slot || typeof slot.render !== "function") return false;
  if (registration) return true;
  const React = react();
  injectStyles();
  registration = slot.render(pluginId, (props: unknown) =>
    React.createElement(AnnouncementWelcome, {
      hostProps: (props ?? {}) as WelcomeProps,
    }),
  );
  return true;
}

/** Hand the welcome area back to the host (used on unload and in tests). */
export function unregister(): void {
  try {
    registration?.dispose();
  } catch {
    /* the host may already have torn the slot down */
  }
  registration = null;
  removeStyles();
}

/** The console may load plugin bundles before the host bridge is installed. */
function bootstrap(attempt = 0): void {
  if (register()) return;
  if (attempt >= 40) return;
  window.setTimeout(() => bootstrap(attempt + 1), 50);
}

bootstrap();

export { AnnouncementWelcome, PLUGIN_ID };
