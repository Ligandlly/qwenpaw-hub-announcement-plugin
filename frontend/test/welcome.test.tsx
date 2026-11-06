import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AgentPicker } from "../src/AgentPicker";
import type { AgentSummary } from "../src/agents";

const agents: AgentSummary[] = [
  { id: "default", name: "默认智能体", description: "处理日常问答" },
  { id: "ops", name: "运维值班", description: "日志与告警排查" },
  { id: "off", name: "停用智能体", description: "不会出现", enabled: false },
];

function hostFetch(list: AgentSummary[] | "fail"): void {
  (window as unknown as { QwenPaw: unknown }).QwenPaw = {
    host: {
      React: {},
      fetch: async () => {
        if (list === "fail") return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ agents: list }) };
      },
    },
  };
}

/** Pretend the conversation already runs some agent that is not in the list. */
function setActiveAgent(agentId: string): void {
  window.sessionStorage.setItem(
    "qwenpaw-agent-storage",
    JSON.stringify({ state: { selectedAgent: agentId }, version: 0 }),
  );
}

function renderWelcome(props: Partial<Parameters<typeof AgentPicker>[0]> = {}) {
  const launchImpl = vi.fn(() => ({ ok: true as const }));
  render(<AgentPicker launchImpl={launchImpl} {...props} />);
  return { launchImpl };
}

describe("AgentPicker", () => {
  it("shows a skeleton first, then the cards", async () => {
    hostFetch(agents);
    renderWelcome();
    expect(document.querySelector(".hub-ann-pick-skeleton")).not.toBeNull();
    expect(await screen.findByText("默认智能体")).toBeTruthy();
    expect(document.querySelector(".hub-ann-pick-skeleton")).toBeNull();
  });

  it("renders disabled agents but keeps them unselectable", async () => {
    hostFetch(agents);
    renderWelcome();
    const disabled = (await screen.findByText("停用智能体")).closest(
      ".hub-ann-pick-card",
    ) as HTMLElement;
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(disabled);
    expect(disabled.getAttribute("aria-checked")).toBe("false");
  });

  it("does not offer the model or tools on a card", async () => {
    hostFetch(agents);
    renderWelcome();
    await screen.findByText("默认智能体");
    expect(screen.queryByText(/claude|gpt|模型|模型：/i)).toBeNull();
  });

  it("renders nothing when at most one agent is usable", async () => {
    hostFetch([agents[0]!, agents[2]!]);
    renderWelcome();
    await waitFor(() => expect(document.querySelector(".hub-ann-pick")).toBeNull());
    expect(document.querySelector(".hub-ann-pick-skeleton")).toBeNull();
    expect(screen.queryByRole("button", { name: /启动对话/ })).toBeNull();
  });

  it("renders nothing when the agent list is empty", async () => {
    hostFetch([]);
    renderWelcome();
    await waitFor(() => expect(document.querySelector(".hub-ann-pick")).toBeNull());
  });

  it("selects a card and launches that agent", async () => {
    hostFetch(agents);
    const { launchImpl } = renderWelcome();
    await screen.findByText("运维值班");

    fireEvent.click(screen.getByText("运维值班").closest(".hub-ann-pick-card")!);
    const card = screen.getByText("运维值班").closest(".hub-ann-pick-card")!;
    expect(card.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /启动对话/ }));
    expect(launchImpl).toHaveBeenCalledWith("ops");
  });

  it("launches the preselected agent with the launch button only", async () => {
    setActiveAgent("ghost");
    hostFetch(agents);
    const { launchImpl } = renderWelcome();
    await screen.findByText("默认智能体");

    const preselected = document
      .querySelector('.hub-ann-pick-card[aria-checked="true"]')!
      .getAttribute("data-agent-id");
    expect(launchImpl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /启动对话/ }));
    expect(launchImpl).toHaveBeenCalledWith(preselected);
  });

  it("keeps the launch button disabled while loading", () => {
    hostFetch(agents);
    renderWelcome();
    expect(
      (screen.getByRole("button", { name: /启动对话/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("disables the launch button when the selection is already the active agent", async () => {
    hostFetch(agents);
    const { launchImpl } = renderWelcome();
    await screen.findByText("默认智能体");

    // Empty storage → the conversation's active agent defaults to "default",
    // which is also what the picker preselects.
    const button = screen.getByRole("button", { name: "当前智能体" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/直接在下面输入即可/)).toBeTruthy();

    fireEvent.click(button);
    expect(launchImpl).not.toHaveBeenCalled();

    const grid = document.querySelector(".hub-ann-pick-grid") as HTMLElement;
    fireEvent.keyDown(grid, { key: "Enter" });
    expect(launchImpl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("运维值班").closest(".hub-ann-pick-card")!);
    const enabled = screen.getByRole("button", { name: /启动对话/ }) as HTMLButtonElement;
    expect(enabled.disabled).toBe(false);
    fireEvent.click(enabled);
    expect(launchImpl).toHaveBeenCalledWith("ops");
  });

  it("surfaces a storage failure instead of navigating silently", async () => {
    setActiveAgent("ghost");
    hostFetch(agents);
    const launchImpl = vi.fn(() => ({ ok: false as const, error: "storage" as const }));
    render(<AgentPicker launchImpl={launchImpl} />);
    await screen.findByText("默认智能体");

    fireEvent.click(screen.getByRole("button", { name: /启动对话/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /启动对话/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("shows an error state with retry and hides the launch button", async () => {
    hostFetch("fail");
    renderWelcome();
    const retry = await screen.findByRole("button", { name: "重试" });
    expect(screen.queryByRole("button", { name: /启动对话/ })).toBeNull();

    hostFetch(agents);
    fireEvent.click(retry);
    expect(await screen.findByText("默认智能体")).toBeTruthy();
  });

  it("moves the selection with the arrow keys", async () => {
    hostFetch(agents);
    renderWelcome();
    await screen.findByText("默认智能体");
    const grid = document.querySelector(".hub-ann-pick-grid") as HTMLElement;

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(
      screen.getByText("运维值班").closest(".hub-ann-pick-card")!.getAttribute(
        "aria-checked",
      ),
    ).toBe("true");

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(
      screen.getByText("默认智能体").closest(".hub-ann-pick-card")!.getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
  });
});
