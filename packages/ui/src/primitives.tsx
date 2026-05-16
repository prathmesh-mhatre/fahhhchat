import type { ReactNode } from "react";

type ButtonLinkProps = {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
};

export function ButtonLink({ href, children, variant = "primary" }: ButtonLinkProps) {
  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 8,
        border: variant === "primary" ? "0" : "1px solid rgba(255,255,255,0.18)",
        padding: "0 18px",
        background: variant === "primary" ? "#7dd7b9" : "rgba(255,255,255,0.06)",
        color: variant === "primary" ? "#07110f" : "#f6f7fb",
        fontWeight: 700,
        textDecoration: "none"
      }}
    >
      {children}
    </a>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
