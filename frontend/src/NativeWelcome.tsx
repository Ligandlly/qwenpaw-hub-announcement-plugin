import type * as ReactNS from "react";

import { react } from "./react";

/** The host's `welcome.render` payload, narrowed to what this plugin passes on. */
export interface WelcomeProps {
  greeting?: ReactNS.ReactNode;
  description?: ReactNS.ReactNode;
  avatar?: string | ReactNS.ReactNode;
  prompts?: Array<
    string | { label?: ReactNS.ReactNode; value: string; icon?: ReactNS.ReactNode }
  >;
  onSubmit: (data: { query: string }) => void;
}

function SparkleIcon() {
  const React = react();
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    </svg>
  );
}

function ArrowIcon() {
  const React = react();
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17 17 7M8 7h9v9" />
    </svg>
  );
}

/**
 * The console's own greeting, re-drawn. The plugin owns the whole slot, so it
 * has to reproduce the host markup (avatar, heading, description, prompt
 * buttons) instead of layering on top of it.
 */
export function NativeWelcome({
  greeting,
  description,
  avatar,
  prompts,
  onSubmit,
}: WelcomeProps) {
  const React = react();
  return (
    <section className="hub-ann-welcome">
      {typeof avatar === "string" ? (
        <img src={avatar} alt="" className="hub-ann-avatar" />
      ) : (
        avatar
      )}
      <div className="hub-ann-greeting" role="heading" aria-level={2}>
        {greeting}
      </div>
      {description ? <p className="hub-ann-description">{description}</p> : null}
      {prompts && prompts.length > 0 ? (
        <div className="hub-ann-prompts">
          {prompts.map((item) => {
            const prompt = typeof item === "string" ? { value: item } : item;
            return (
              <button
                key={prompt.value}
                type="button"
                data-press
                className="hub-ann-prompt"
                onClick={() => onSubmit({ query: prompt.value })}
              >
                {prompt.icon ?? <SparkleIcon />}
                <span>{prompt.label || prompt.value}</span>
                <ArrowIcon />
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
