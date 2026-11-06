import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { AgentPicker } from "../src/AgentPicker";

const agents = [
  { id: "default", name: "默认智能体", description: "处理日常问答" },
  { id: "ops", name: "运维值班", description: "日志与告警排查" },
];

function installHost(extra: Record<string, unknown> = {}): void {
  (window as unknown as { QwenPaw: unknown }).QwenPaw = {
    host: {
      React,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ agents }) }),
      ...extra,
    },
  };
}

describe("AgentPicker native integration", () => {
  it("takes the language from host.useLocale instead of localStorage", async () => {
    window.localStorage.setItem("language", "zh-CN");
    // Active agent stays out of the list, so the button reads "Start chat".
    installHost({ useLocale: () => "en-US", useSelectedAgent: () => ({ id: "ghost" }) });
    render(<AgentPicker launchImpl={() => ({ ok: true })} />);
    expect(await screen.findByText("默认智能体")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start chat" })).toBeTruthy();
  });

  it("shows the launch button as the active agent when nothing would change", async () => {
    window.sessionStorage.clear();
    installHost({ useSelectedAgent: () => ({ id: "ops" }) });
    render(<AgentPicker launchImpl={() => ({ ok: true })} />);
    const button = (await screen.findByRole("button", {
      name: "当前智能体",
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("marks the host's selected agent as current", async () => {
    window.sessionStorage.clear();
    installHost({ useSelectedAgent: () => ({ id: "ops" }) });
    render(<AgentPicker launchImpl={() => ({ ok: true })} />);
    await screen.findByText("运维值班");
    expect(
      screen.getByText("运维值班").closest(".hub-ann-pick-card")!.getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(screen.getByText("当前")).toBeTruthy();
  });

  it("keeps the launch button disabled until the list arrives", async () => {
    // Active agent is not in the list, so the button becomes launchable.
    installHost({ useSelectedAgent: () => ({ id: "ghost" }) });
    render(<AgentPicker launchImpl={() => ({ ok: true })} />);
    const button = screen.getByRole("button", { name: /启动对话/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await screen.findByText("默认智能体");
    await waitFor(() => expect(button.disabled).toBe(false));
  });
});
