export const colors = {
  background: "#080b10",
  backgroundRaised: "#0d121a",
  surface: "#111823",
  surfaceMuted: "#172131",
  border: "rgba(255, 255, 255, 0.12)",
  borderStrong: "rgba(255, 255, 255, 0.2)",
  text: "#f7f8fb",
  mutedText: "#b7c0ce",
  subtleText: "#8793a5",
  accent: "#71e0b9",
  accentText: "#04110d",
  info: "#72b7ff",
  warning: "#f4c65e",
  danger: "#ff6b6b"
} as const;

export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48
} as const;

export const radii = {
  control: 8,
  panel: 8,
  round: 999
} as const;

export const font = {
  family:
    'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  size: {
    xs: "0.78rem",
    sm: "0.9rem",
    md: "1rem",
    lg: "1.15rem"
  },
  weight: {
    regular: 400,
    medium: 600,
    bold: 700
  }
} as const;

export const shadow = {
  panel: "0 24px 80px rgba(0, 0, 0, 0.32)"
} as const;

export const tokens = {
  colors,
  font,
  radii,
  shadow,
  space
} as const;

export const cssVariables = {
  "--fc-color-background": colors.background,
  "--fc-color-background-raised": colors.backgroundRaised,
  "--fc-color-surface": colors.surface,
  "--fc-color-surface-muted": colors.surfaceMuted,
  "--fc-color-border": colors.border,
  "--fc-color-border-strong": colors.borderStrong,
  "--fc-color-text": colors.text,
  "--fc-color-muted-text": colors.mutedText,
  "--fc-color-subtle-text": colors.subtleText,
  "--fc-color-accent": colors.accent,
  "--fc-color-accent-text": colors.accentText,
  "--fc-color-info": colors.info,
  "--fc-color-warning": colors.warning,
  "--fc-color-danger": colors.danger,
  "--fc-font-family": font.family,
  "--fc-radius-control": `${radii.control}px`,
  "--fc-radius-panel": `${radii.panel}px`,
  "--fc-radius-round": `${radii.round}px`,
  "--fc-shadow-panel": shadow.panel
} as const;
