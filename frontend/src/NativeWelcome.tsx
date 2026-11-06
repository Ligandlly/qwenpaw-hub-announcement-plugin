import type * as ReactNS from "react";

import { react } from "./react";

/** The host's `welcome.render` payload, narrowed to what this plugin reads. */
export interface WelcomeProps {
  greeting?: ReactNS.ReactNode;
  description?: ReactNS.ReactNode;
  avatar?: string | ReactNS.ReactNode;
  /** Host sample questions. The plugin replaces them with the agent picker. */
  prompts?: Array<
    string | { label?: ReactNS.ReactNode; value: string; icon?: ReactNS.ReactNode }
  >;
  onSubmit: (data: { query: string }) => void;
}

/**
 * The console's own greeting, re-drawn: avatar, heading and description. The
 * plugin owns the whole slot, so it reproduces these host elements instead of
 * layering on top of them. The host sample prompts are not drawn; the agent
 * picker takes their place.
 */
export function NativeWelcome({ greeting, description, avatar }: WelcomeProps) {
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
    </section>
  );
}
