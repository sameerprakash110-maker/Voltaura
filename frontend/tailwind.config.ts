import type { Config } from "tailwindcss";

/**
 * VOLTAURA design system.
 *
 * Colours are declared once as CSS custom properties in globals.css and
 * referenced here, so light and dark themes share a single set of semantic
 * names. Components never reach for a raw hex value.
 *
 * The radius scale tops out at 10px on purpose: tables, telemetry panels and
 * data visualisations use the sharp end of it, which is what stops the product
 * reading as a generic card dashboard.
 */
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        elevated: "rgb(var(--elevated) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",

        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-soft": "rgb(var(--ink-soft) / <alpha-value>)",
        "ink-muted": "rgb(var(--ink-muted) / <alpha-value>)",
        "ink-faint": "rgb(var(--ink-faint) / <alpha-value>)",

        mint: "rgb(var(--mint) / <alpha-value>)",
        "mint-deep": "rgb(var(--mint-deep) / <alpha-value>)",
        aqua: "rgb(var(--aqua) / <alpha-value>)",
        "aqua-deep": "rgb(var(--aqua-deep) / <alpha-value>)",
        iris: "rgb(var(--iris) / <alpha-value>)",

        low: "rgb(var(--low) / <alpha-value>)",
        medium: "rgb(var(--medium) / <alpha-value>)",
        high: "rgb(var(--high) / <alpha-value>)",
        critical: "rgb(var(--critical) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        // Telemetry readouts: sized as a deliberate scale, not ad hoc.
        readout: ["2.125rem", { lineHeight: "1", letterSpacing: "-0.035em" }],
        "readout-lg": ["2.75rem", { lineHeight: "1", letterSpacing: "-0.04em" }],
      },
      letterSpacing: {
        tightest: "-0.035em",
      },
      borderRadius: {
        DEFAULT: "4px",
        sm: "3px",
        md: "6px",
        lg: "8px",
        xl: "10px",
        card: "6px",
        panel: "8px",
      },
      boxShadow: {
        // One elevation only, and it is nearly invisible. Depth is not a
        // hierarchy device in this product; alignment is.
        raise: "0 1px 2px 0 rgb(0 0 0 / 0.35), 0 8px 24px -16px rgb(0 0 0 / 0.7)",
        overlay: "0 16px 48px -24px rgb(0 0 0 / 0.85)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.55" },
          "70%": { transform: "scale(1.9)", opacity: "0" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(320%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-up": "fade-up 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-ring": "pulse-ring 2.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        sweep: "sweep 2.6s cubic-bezier(0.4, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
