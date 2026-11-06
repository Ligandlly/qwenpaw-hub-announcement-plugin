/**
 * Host contract constants for the agent picker.
 *
 * Everything here mirrors an internal Console convention on purpose — the
 * plugin runs without touching host source, so these keys ARE the API.
 * See ../../architecture.md for the fallback for each one.
 */

/** Zustand-persisted agent state: sessionStorage (per tab) + localStorage (shared). */
export const AGENT_STORAGE_KEY = "qwenpaw-agent-storage";

/** "Last used agent" — what a brand new tab inherits. */
export const LAST_USED_AGENT_KEY = "qwenpaw-last-used-agent";

/** Consumed by ChatSessionInitializer to land on a blank conversation. */
export const PENDING_NEW_CHAT_KEY = "qwenpaw_pending_new_chat";

/** Where launching lands. */
export const CHAT_PATH = "/chat";
