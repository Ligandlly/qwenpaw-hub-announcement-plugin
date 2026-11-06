import { getUseLocale } from "./host";
import { resolveLocale, subscribeLocale, t, type Locale } from "./i18n";
import { react } from "./react";

export interface Messages {
  locale: Locale;
  t: (key: Parameters<typeof t>[1]) => string;
}

/**
 * Language follows the console. `host.useLocale` is the reactive path (the host
 * re-renders on switch, so the language setting and antd locale stay in sync);
 * the localStorage subscription is only the fallback for an older host.
 */
export function useMessages(): Messages {
  const React = react();
  const useHostLocale = getUseLocale();
  // Hook availability is fixed for the lifetime of the page, so the call
  // order stays stable across renders.
  const hosted = useHostLocale ? useHostLocale() : undefined;
  const [fallback, setFallback] = React.useState<Locale>(() => resolveLocale());

  React.useEffect(() => {
    if (useHostLocale) return undefined;
    return subscribeLocale(() => setFallback(resolveLocale()));
  }, [React, useHostLocale]);

  const locale = hosted ? resolveLocale(hosted) : fallback;

  return {
    locale,
    t: (key) => t(locale, key),
  };
}
