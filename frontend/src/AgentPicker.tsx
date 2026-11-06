import type * as ReactNS from "react";

import { AgentCard } from "./AgentCard";
import {
  fetchAgents,
  isLaunchable,
  launchableAgents,
  pickDefaultAgent,
  sortAgents,
  type AgentSummary,
} from "./agents";
import { getUseSelectedAgent, readSelectedAgentId } from "./host";
import { launchAgent, type LaunchResult } from "./launch";
import { react } from "./react";
import { Button } from "./ui";
import { useMessages } from "./useMessages";

export interface AgentPickerProps {
  /** Test seam; production reads `/agents` through the host bridge. */
  loadAgents?: () => Promise<AgentSummary[]>;
  /** Test seam; production always uses the real storage + navigation path. */
  launchImpl?: (agentId: string) => LaunchResult;
}

type Status = "loading" | "ready" | "error" | "hidden";

const SKELETONS = [0, 1, 2, 3];

/**
 * Agent chooser that replaces the welcome's sample prompts. Picking an agent
 * and pressing launch switches the host's agent and opens a blank conversation.
 * With zero or one usable agent there is nothing to choose, so it renders
 * nothing and the welcome keeps its greeting and announcements.
 */
export function AgentPicker({ loadAgents, launchImpl }: AgentPickerProps) {
  const React = react();
  const { t } = useMessages();
  const useHostSelectedAgent = getUseSelectedAgent();
  const [status, setStatus] = React.useState<Status>("loading");
  const [agents, setAgents] = React.useState<AgentSummary[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [launching, setLaunching] = React.useState(false);
  const [storageError, setStorageError] = React.useState(false);

  const cards = React.useRef(new Map<string, HTMLButtonElement>());
  const storedId = React.useRef<string>(readSelectedAgentId());
  const loaderRef = React.useRef(loadAgents ?? (() => fetchAgents()));
  loaderRef.current = loadAgents ?? (() => fetchAgents());

  // The host's store is the live source of truth; the storage read is a
  // fallback for a host that does not expose `useSelectedAgent`.
  const hostedAgent = useHostSelectedAgent ? useHostSelectedAgent() : null;
  const currentId = hostedAgent?.id || storedId.current;
  const currentRef = React.useRef(currentId);
  currentRef.current = currentId;

  const load = React.useCallback((isActive: () => boolean) => {
    setStatus("loading");
    setStorageError(false);
    loaderRef
      .current()
      .then((list) => {
        if (!isActive()) return;
        const sorted = sortAgents(list);
        // Nothing to choose (zero or one enabled agent): the picker would only
        // add a click, so it stays out of the welcome.
        if (launchableAgents(sorted).length <= 1) {
          setStatus("hidden");
          return;
        }
        setAgents(sorted);
        setSelectedId(pickDefaultAgent(sorted, currentRef.current));
        setStatus("ready");
      })
      .catch(() => {
        if (isActive()) setStatus("error");
      });
  }, []);

  React.useEffect(() => {
    let active = true;
    load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  const launch = React.useCallback(
    (agentId: string | null) => {
      // Selecting the agent that is already active is not a switch: the button
      // is disabled for it, and Enter/Space must behave like a disabled button.
      if (!agentId || launching || agentId === currentRef.current) return;
      setLaunching(true);
      setStorageError(false);
      const result = (launchImpl ?? launchAgent)(agentId);
      if (!result.ok) {
        setLaunching(false);
        setStorageError(true);
      }
    },
    [launchImpl, launching],
  );

  const select = React.useCallback((agentId: string) => {
    setSelectedId(agentId);
    cards.current.get(agentId)?.focus();
  }, []);

  const onKeyDown = React.useCallback(
    (event: ReactNS.KeyboardEvent<HTMLDivElement>) => {
      const usable = launchableAgents(agents);
      if (usable.length === 0) return;
      const index = usable.findIndex((agent) => agent.id === selectedId);
      const move = (delta: number) => {
        event.preventDefault();
        const next = usable[(index + delta + usable.length) % usable.length];
        if (next) select(next.id);
      };
      if (event.key === "ArrowRight" || event.key === "ArrowDown") move(1);
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") move(-1);
      else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        launch(selectedId);
      }
    },
    [agents, launch, select, selectedId],
  );

  if (status === "hidden") return null;

  const ready = status === "ready";
  // Nothing to switch to: the selection IS the agent of this conversation.
  const onCurrentAgent = Boolean(selectedId) && selectedId === currentId;
  const launchLabel = launching
    ? t("launching")
    : onCurrentAgent
      ? t("currentAgent")
      : t("launch");

  return (
    <div className="hub-ann-pick">
      {status === "loading" ? (
        <div
          className="hub-ann-pick-grid hub-ann-pick-skeleton"
          aria-busy="true"
          aria-label={t("loading")}
        >
          {SKELETONS.map((key) => (
            <div className="hub-ann-pick-card" key={key}>
              <span className="hub-ann-pick-sk hub-ann-pick-sk-ava" aria-hidden="true" />
              <span className="hub-ann-pick-body">
                <span className="hub-ann-pick-sk hub-ann-pick-sk-title" />
                <span className="hub-ann-pick-sk hub-ann-pick-sk-line" />
                <span className="hub-ann-pick-sk hub-ann-pick-sk-line-short" />
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {status === "error" ? (
        <div className="hub-ann-pick-error">
          <span className="hub-ann-pick-hint">{t("errorBody")}</span>
          <Button
            className="hub-ann-pick-retry"
            ariaLabel={t("retry")}
            onClick={() => load(() => true)}
          >
            {t("retry")}
          </Button>
        </div>
      ) : null}

      {ready ? (
        <div
          className="hub-ann-pick-grid"
          role="radiogroup"
          aria-label={t("gridLabel")}
          onKeyDown={onKeyDown}
        >
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedId}
              current={agent.id === currentId}
              disabledTag={t("disabledTag")}
              currentTag={t("currentTag")}
              onSelect={(agentId) => {
                if (isLaunchable(agent)) setSelectedId(agentId);
              }}
              registerRef={(element) => {
                if (element) cards.current.set(agent.id, element);
                else cards.current.delete(agent.id);
              }}
            />
          ))}
        </div>
      ) : null}

      {storageError ? (
        <p className="hub-ann-pick-error-text" role="alert">
          {t("storageError")}
        </p>
      ) : null}

      {ready || status === "loading" ? (
        <div className="hub-ann-pick-foot">
          <Button
            primary
            className="hub-ann-pick-launch"
            loading={launching}
            disabled={!ready || !selectedId || onCurrentAgent}
            ariaLabel={launchLabel}
            onClick={() => launch(selectedId)}
          >
            {launchLabel}
            {onCurrentAgent ? null : <span aria-hidden="true">→</span>}
          </Button>
          <span className="hub-ann-pick-hint">
            {onCurrentAgent ? t("currentHint") : t("hint")}
          </span>
        </div>
      ) : null}
    </div>
  );
}
