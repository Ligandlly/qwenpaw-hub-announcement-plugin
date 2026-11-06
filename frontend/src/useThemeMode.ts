import { getUseTheme } from "./host";
import { react } from "./react";

export type ThemeMode = "light" | "dark";

function readDocumentTheme(): ThemeMode {
  try {
    return document.documentElement.classList.contains("dark-mode")
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

/**
 * Follow the console theme. `host.useTheme` is the reactive path; the DOM class
 * is only the fallback for an older host (the console toggles `html.dark-mode`).
 */
export function useThemeMode(): ThemeMode {
  const React = react();
  const useHostTheme = getUseTheme();
  const [fallback, setFallback] = React.useState<ThemeMode>(readDocumentTheme());

  React.useEffect(() => {
    if (useHostTheme) return undefined;
    const observer = new MutationObserver(() => setFallback(readDocumentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [React, useHostTheme]);

  if (useHostTheme) return useHostTheme() === "dark" ? "dark" : "light";
  return fallback;
}
