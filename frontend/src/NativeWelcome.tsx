import type * as ReactNS from "react";

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
