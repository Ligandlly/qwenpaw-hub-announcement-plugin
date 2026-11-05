/** Console stores the UI language in `localStorage.language`. */
const LANGUAGE_KEY = "language";
const LANGUAGE_EVENT = "hub-announcement:language";

export type Locale = "zh" | "en";

export type MessageKey = keyof typeof messages.en;

export const messages = {
  en: {
    launch: "Start chat",
    launching: "Starting…",
    currentAgent: "Current agent",
    hint: "Switching agent and starting a new conversation (about a second).",
    currentHint: "This agent is already active — just start typing below.",
    loading: "Loading agents…",
    errorBody: "Could not load the agent list. Retry, or just start typing below.",
    retry: "Retry",
    disabledTag: "Disabled",
    currentTag: "Current",
    gridLabel: "Agents",
    storageError:
      "Launch failed: this browser refused the local storage write. Check private mode and try again.",
  },
  zh: {
    launch: "启动对话",
    launching: "正在启动…",
    currentAgent: "当前智能体",
    hint: "启动会切换智能体并新建一条空白对话（约 1 秒）。",
    currentHint: "当前已经是这个智能体，直接在下面输入即可。",
    loading: "正在读取智能体…",
    errorBody: "没能读到智能体列表。可以重试，或直接在下面输入。",
    retry: "重试",
    disabledTag: "已停用",
    currentTag: "当前",
    gridLabel: "智能体",
    storageError:
      "启动失败：浏览器拒绝写入本地存储。请检查是否处在无痕模式后重试。",
  },
} as const;

export function toLocale(language: string | null | undefined): Locale {
  const base = String(language ?? "")
    .trim()
    .split("-")[0]
    .toLowerCase();
  if (base === "zh") return "zh";
  if (base === "en") return "en";
  return "en";
}

function readConsoleLanguage(): string {
  try {
    return localStorage.getItem(LANGUAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Empty console language → follow the browser. */
export function resolveLocale(language?: string | null): Locale {
  const raw = language ?? readConsoleLanguage();
  if (!raw) {
    try {
      return toLocale(navigator.language);
    } catch {
      return "zh";
    }
  }
  return toLocale(raw);
}

/** `storage` only fires across tabs — patch setItem to catch same-tab switches. */
function installLanguageHook(): void {
  const marker = "__hubAnnouncementLanguageHook";
  const proto = Storage.prototype as Storage & Record<string, unknown>;
  if (proto[marker]) return;
  const nativeSetItem = proto.setItem;
  proto.setItem = function setItem(key: string, value: string) {
    nativeSetItem.call(this, key, value);
    if (key === LANGUAGE_KEY) {
      window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: value }));
    }
  };
  proto[marker] = true;
}

export function subscribeLocale(fn: (language: string) => void): () => void {
  installLanguageHook();
  const onCustom = (event: Event) => {
    fn(String((event as CustomEvent<string>).detail ?? ""));
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === LANGUAGE_KEY) fn(event.newValue ?? "");
  };
  window.addEventListener(LANGUAGE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LANGUAGE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}

export function t(locale: Locale, key: MessageKey): string {
  return messages[locale][key] ?? messages.en[key];
}
