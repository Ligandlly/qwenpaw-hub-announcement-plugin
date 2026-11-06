import { apiFetch } from "./host";

/** The slice of the console's `AgentSummary` this plugin needs. */
export interface AgentSummary {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
}

export class AgentsError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Failed to load agents (HTTP ${status})`);
    this.name = "AgentsError";
    this.status = status;
  }
}

interface AgentListResponse {
  agents?: AgentSummary[];
}

export async function fetchAgents(signal?: AbortSignal): Promise<AgentSummary[]> {
  // Host API-relative: the host bridge prepends `/api` (`/agents` → `/api/agents`).
  const response = await apiFetch("/agents", { signal });
  if (!response.ok) throw new AgentsError(response.status);
  const payload = (await response.json()) as AgentListResponse | AgentSummary[];
  const list = Array.isArray(payload) ? payload : (payload.agents ?? []);
  return list.filter(
    (agent): agent is AgentSummary =>
      typeof agent?.id === "string" && agent.id.length > 0,
  );
}

/** Missing `enabled` counts as enabled: older backends do not send it. */
export function isLaunchable(agent: AgentSummary): boolean {
  return agent.enabled !== false;
}

/** Enabled agents first, then by name — disabled ones stay visible but last. */
export function sortAgents(list: AgentSummary[]): AgentSummary[] {
  return [...list].sort((left, right) => {
    const leftEnabled = isLaunchable(left) ? 0 : 1;
    const rightEnabled = isLaunchable(right) ? 0 : 1;
    if (leftEnabled !== rightEnabled) return leftEnabled - rightEnabled;
    return (left.name ?? left.id).localeCompare(right.name ?? right.id);
  });
}

export function launchableAgents(list: AgentSummary[]): AgentSummary[] {
  return list.filter(isLaunchable);
}

/** Keep the current agent when it is usable, otherwise take the first one. */
export function pickDefaultAgent(
  list: AgentSummary[],
  currentId: string,
): string | null {
  const usable = launchableAgents(list);
  if (usable.some((agent) => agent.id === currentId)) return currentId;
  return usable[0]?.id ?? null;
}
