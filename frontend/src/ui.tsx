import type * as ReactNS from "react";

import { getAntd } from "./host";
import { react } from "./react";

/**
 * Native-first primitives: when the console exposes its antd instance the
 * plugin renders real antd components (so radius, height, press feedback,
 * loading spinner and dark algorithm all come from the host theme). The plain
 * fallbacks exist for tests and for a host that does not attach antd.
 */

export interface ButtonProps {
  primary?: boolean;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  onClick?: () => void;
  children?: ReactNS.ReactNode;
}

export function Button({
  primary,
  loading,
  disabled,
  className,
  ariaLabel,
  onClick,
  children,
}: ButtonProps) {
  const React = react();
  const antd = getAntd();

  if (antd?.Button) {
    return React.createElement(
      antd.Button,
      {
        type: primary ? "primary" : "default",
        loading,
        disabled,
        className,
        "data-press": true,
        "aria-label": ariaLabel,
        onClick,
      },
      children,
    );
  }

  const classes = ["hub-ann-pick-btn", primary ? "hub-ann-pick-btn-primary" : "hub-ann-pick-btn-default"];
  if (className) classes.push(className);
  return React.createElement(
    "button",
    {
      type: "button",
      className: classes.join(" "),
      disabled: disabled || loading,
      "aria-label": ariaLabel,
      "aria-busy": loading ? "true" : undefined,
      onClick: disabled || loading ? undefined : onClick,
    },
    children,
  );
}

export interface AvatarProps {
  /** Text glyph, or an image URL supplied by the host. */
  text: string;
  size?: number;
  background?: string;
  color?: string;
  round?: boolean;
  className?: string;
  imageUrl?: string;
}

export function Avatar({
  text,
  size = 32,
  background,
  color,
  round = false,
  className,
  imageUrl,
}: AvatarProps) {
  const React = react();
  const antd = getAntd();
  const radius = round ? "50%" : Math.round(size * 0.3);

  if (antd?.Avatar) {
    if (imageUrl) {
      return React.createElement(antd.Avatar, {
        size,
        shape: round ? "circle" : "square",
        src: imageUrl,
        className,
      });
    }
    return React.createElement(
      antd.Avatar,
      {
        size,
        shape: round ? "circle" : "square",
        className,
        style: { background, color, fontSize: Math.round(size * 0.42) },
      },
      text,
    );
  }

  if (imageUrl) {
    return React.createElement("img", {
      src: imageUrl,
      alt: "",
      className,
      style: { width: size, height: size, borderRadius: radius, objectFit: "cover" },
    });
  }

  return React.createElement(
    "span",
    {
      className,
      "aria-hidden": "true",
      style: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: `0 0 ${size}px`,
        width: size,
        height: size,
        borderRadius: radius,
        background,
        color,
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
      },
    },
    text,
  );
}
