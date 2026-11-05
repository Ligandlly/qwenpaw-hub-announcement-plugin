import type { AgentSummary } from "./agents";
import { initialOf, toneOf, toneStyle } from "./avatar";
import { react } from "./react";
import { Avatar } from "./ui";
import { useThemeMode } from "./useThemeMode";

export interface AgentCardProps {
  agent: AgentSummary;
  selected: boolean;
  current: boolean;
  disabledTag: string;
  currentTag: string;
  onSelect: (agentId: string) => void;
  registerRef: (element: HTMLButtonElement | null) => void;
}

export function AgentCard({
  agent,
  selected,
  current,
  disabledTag,
  currentTag,
  onSelect,
  registerRef,
}: AgentCardProps) {
  const React = react();
  const mode = useThemeMode();
  const name = agent.name || agent.id;
  const disabled = agent.enabled === false;
  const tone = toneStyle(toneOf(name), mode);

  const classes = ["hub-ann-pick-card"];
  if (selected) classes.push("is-selected");

  return (
    <button
      ref={registerRef}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      data-agent-id={agent.id}
      data-press
      className={classes.join(" ")}
      tabIndex={selected ? 0 : -1}
      onClick={() => {
        if (!disabled) onSelect(agent.id);
      }}
    >
      <Avatar
        text={initialOf(name)}
        size={32}
        background={tone.backgroundColor}
        color={tone.color}
      />
      <span className="hub-ann-pick-body">
        <span className="hub-ann-pick-name">
          {name}
          {disabled ? <span className="hub-ann-pick-tag">{disabledTag}</span> : null}
          {!disabled && current ? (
            <span className="hub-ann-pick-tag">{currentTag}</span>
          ) : null}
        </span>
        {agent.description ? (
          <span className="hub-ann-pick-carddesc">{agent.description}</span>
        ) : null}
      </span>
      {!disabled && selected ? (
        <span className="hub-ann-pick-check" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </button>
  );
}
