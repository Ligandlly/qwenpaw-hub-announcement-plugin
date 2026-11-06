import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Button, Avatar } from "../src/ui";

interface FakeAntdProps {
  type?: string;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  src?: string;
  size?: number;
  style?: React.CSSProperties;
}

function hostWithAntd(): void {
  const FakeButton = ({
    type,
    loading,
    disabled,
    className,
    onClick,
    children,
  }: FakeAntdProps) =>
    React.createElement(
      "button",
      {
        type: "button",
        "data-antd": "button",
        "data-type": type,
        "data-loading": loading ? "1" : undefined,
        disabled: disabled || loading,
        className,
        onClick,
      },
      children,
    );
  const FakeAvatar = ({ src, children, style }: FakeAntdProps) =>
    React.createElement(
      "span",
      { "data-antd": "avatar", "data-src": src, style },
      src ? null : children,
    );

  (window as unknown as { QwenPaw: unknown }).QwenPaw = {
    host: { React, antd: { Button: FakeButton, Avatar: FakeAvatar } },
  };
}

describe("Button", () => {
  it("renders a primary antd button when the console provides one", () => {
    hostWithAntd();
    render(<Button primary>启动对话</Button>);
    const button = screen.getByRole("button", { name: "启动对话" });
    expect(button.getAttribute("data-antd")).toBe("button");
    expect(button.getAttribute("data-type")).toBe("primary");
  });

  it("passes loading straight through to antd", () => {
    hostWithAntd();
    render(<Button loading>启动中</Button>);
    const button = screen.getByRole("button", { name: "启动中" });
    expect(button.getAttribute("data-loading")).toBe("1");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("falls back to a plain button without antd", () => {
    render(<Button primary>启动对话</Button>);
    const button = screen.getByRole("button", { name: "启动对话" });
    expect(button.getAttribute("data-antd")).toBeNull();
    expect(button.className).toContain("hub-ann-pick-btn-primary");
  });
});

describe("Avatar", () => {
  it("uses antd Avatar with an image url", () => {
    hostWithAntd();
    const { container } = render(<Avatar text="Q" imageUrl="/qwenpaw.png" />);
    expect(
      container.querySelector('[data-antd="avatar"]')?.getAttribute("data-src"),
    ).toBe("/qwenpaw.png");
  });

  it("uses antd Avatar with the tone colours", () => {
    hostWithAntd();
    const { container } = render(
      <Avatar text="数" background="#fff1e6" color="#b85800" />,
    );
    const node = container.querySelector('[data-antd="avatar"]') as HTMLElement;
    expect(node.textContent).toBe("数");
    expect(node.style.backgroundColor).toBe("rgb(255, 241, 230)");
  });

  it("falls back to an img element", () => {
    const { container } = render(<Avatar text="Q" imageUrl="/logo.png" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/logo.png");
  });

  it("falls back to a span glyph", () => {
    const { container } = render(<Avatar text="数" size={32} />);
    expect(container.querySelector("span")?.textContent).toBe("数");
  });
});
