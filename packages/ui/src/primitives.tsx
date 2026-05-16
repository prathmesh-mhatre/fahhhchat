import type { AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { cssVariables, radii } from "./tokens";

type ButtonTone = "primary" | "secondary" | "danger";

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
  variant?: ButtonTone;
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonTone;
};

function buttonStyle(variant: ButtonTone): CSSProperties {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";

  return {
    display: "inline-flex",
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.control,
    border: isPrimary ? 0 : "1px solid var(--fc-color-border-strong)",
    padding: "0 18px",
    background: isPrimary
      ? "var(--fc-color-accent)"
      : isDanger
        ? "rgba(255, 107, 107, 0.14)"
        : "rgba(255, 255, 255, 0.06)",
    color: isPrimary ? "var(--fc-color-accent-text)" : "var(--fc-color-text)",
    cursor: "pointer",
    font: "inherit",
    fontWeight: 700,
    lineHeight: 1,
    textDecoration: "none"
  };
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  style,
  ...props
}: ButtonLinkProps) {
  return (
    <a
      href={href}
      style={{ ...buttonStyle(variant), ...style }}
      {...props}
    >
      {children}
    </a>
  );
}

export function Button({ children, variant = "primary", style, type = "button", ...props }: ButtonProps) {
  return (
    <button type={type} style={{ ...buttonStyle(variant), ...style }} {...props}>
      {children}
    </button>
  );
}

export function SiteShell({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        ...cssVariables,
        minHeight: "100vh",
        background: "var(--fc-color-background)",
        color: "var(--fc-color-text)",
        fontFamily: "var(--fc-font-family)",
        ...style
      }}
    >
      {children}
    </div>
  );
}

export function Surface({
  children,
  className,
  style
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      className={className}
      style={{
        border: "1px solid var(--fc-color-border)",
        borderRadius: "var(--fc-radius-panel)",
        background: "var(--fc-color-surface)",
        boxShadow: "var(--fc-shadow-panel)",
        ...style
      }}
    >
      {children}
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={className}
      style={{
        margin: 0,
        color: "var(--fc-color-accent)",
        fontSize: "0.78rem",
        fontWeight: 700,
        letterSpacing: 0,
        textTransform: "uppercase"
      }}
    >
      {children}
    </p>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        width: "fit-content",
        alignItems: "center",
        border: "1px solid var(--fc-color-border)",
        borderRadius: "var(--fc-radius-round)",
        padding: "6px 10px",
        color: "var(--fc-color-muted-text)",
        fontSize: "0.82rem",
        fontWeight: 600
      }}
    >
      {children}
    </span>
  );
}
