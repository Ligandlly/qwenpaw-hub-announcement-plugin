import {
  AGENT_STORAGE_KEY,
  CHAT_PATH,
  LAST_USED_AGENT_KEY,
  PENDING_NEW_CHAT_KEY,
} from "./constants";

export interface LaunchTarget {
  sessionStorage: Storage;
  localStorage: Storage;
  navigate: (path: string) => void;
}

export type LaunchResult = { ok: true } | { ok: false; error: "storage" };

/**
 * Rewrite `state.selectedAgent` while keeping every other persisted field
 * (`agents`, `lastChatIdByAgent`, …) intact — the host's zustand store reads
 * the whole object back on boot.
 */
export function withSelectedAgent(raw: string | null, agentId: string): string {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
      if (parsed && typeof parsed === "object") {
        const state =
          parsed.state && typeof parsed.state === "object" ? parsed.state : {};
        return JSON.stringify({
          ...parsed,
          state: { ...state, selectedAgent: agentId },
        });
      }
    } catch {
      /* fall through to a fresh object */
    }
  }
  return JSON.stringify({ state: { selectedAgent: agentId }, version: 0 });
}

/**
 * Switch the host's selected agent and land on a blank conversation.
 *
 * Order matters: every storage write happens before the navigation, so a
 * refused write leaves the tab untouched instead of half-switched.
 */
export function launchAgent(agentId: string, target?: LaunchTarget): LaunchResult {
  const session = target?.sessionStorage ?? window.sessionStorage;
  const local = target?.localStorage ?? window.localStorage;
  const navigate =
    target?.navigate ??
    ((path: string) => {
      window.location.assign(path);
    });

  try {
    session.setItem(
      AGENT_STORAGE_KEY,
      withSelectedAgent(session.getItem(AGENT_STORAGE_KEY), agentId),
    );
    local.setItem(LAST_USED_AGENT_KEY, agentId);

    // Only merge into the shared copy when it already exists: inventing one
    // would hand the host a state object it never wrote.
    const shared = local.getItem(AGENT_STORAGE_KEY);
    if (shared) {
      local.setItem(AGENT_STORAGE_KEY, withSelectedAgent(shared, agentId));
    }

    session.setItem(PENDING_NEW_CHAT_KEY, "1");
  } catch {
    return { ok: false, error: "storage" };
  }

  navigate(CHAT_PATH);
  return { ok: true };
}
