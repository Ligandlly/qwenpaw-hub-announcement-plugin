import { describe, expect, it } from "vitest";

import { initialOf, toneOf, TONE_COUNT } from "../src/avatar";

describe("initialOf", () => {
  it("takes the first character of a Chinese name", () => {
    expect(initialOf("数据分析师")).toBe("数");
  });

  it("upper-cases latin initials", () => {
    expect(initialOf("alpha")).toBe("A");
  });

  it("never splits an emoji", () => {
    expect(initialOf("🚀 Rocket")).toBe("🚀");
  });

  it("falls back for empty names", () => {
    expect(initialOf("   ")).toBe("?");
  });
});

describe("toneOf", () => {
  it("is stable for the same name", () => {
    expect(toneOf("默认智能体")).toBe(toneOf("默认智能体"));
  });

  it("stays inside the palette", () => {
    for (const name of ["a", "beta", "数据分析师", "运维值班", "🚀"]) {
      const tone = toneOf(name);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(TONE_COUNT);
    }
  });

  it("spreads different names across tones", () => {
    const tones = new Set(["alpha", "beta", "gamma", "delta"].map(toneOf));
    expect(tones.size).toBeGreaterThan(1);
  });
});
