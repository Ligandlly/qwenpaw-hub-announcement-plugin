import { describe, expect, it } from "vitest";

import { messages, resolveLocale, t, toLocale } from "../src/i18n";

describe("toLocale", () => {
  it("maps zh variants to zh", () => {
    expect(toLocale("zh-CN")).toBe("zh");
    expect(toLocale("zh-TW")).toBe("zh");
  });

  it("maps en and unknown languages to en", () => {
    expect(toLocale("en-US")).toBe("en");
    expect(toLocale("de-DE")).toBe("en");
    expect(toLocale("")).toBe("en");
  });
});

describe("resolveLocale", () => {
  it("prefers the console language", () => {
    window.localStorage.setItem("language", "zh-CN");
    expect(resolveLocale()).toBe("zh");
  });

  it("accepts an explicit language", () => {
    expect(resolveLocale("en-US")).toBe("en");
  });
});

describe("messages", () => {
  it("has the same keys in both languages", () => {
    expect(Object.keys(messages.zh).sort()).toEqual(
      Object.keys(messages.en).sort(),
    );
  });

  it("renders a key per locale", () => {
    expect(t("zh", "launch")).toBe("启动对话");
    expect(t("en", "launch")).toBe("Start chat");
  });

  it("has no empty strings", () => {
    for (const locale of ["zh", "en"] as const) {
      for (const value of Object.values(messages[locale])) {
        expect(String(value).trim().length).toBeGreaterThan(0);
      }
    }
  });
});
