import type { Config } from "tailwindcss";

/**
 * VOLTAURA design system.
 *
 * Colours are declared once as CSS custom properties in globals.css and
 * referenced here, so light and dark themes share a single set of semantic
 * names. Components never reach for a raw hex value.
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
        "line-strong": "rgb(var(--line-strong) / <alpha-value>)",

        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-soft": "rgb(var(--ink-soft) / <alpha-value>)",
        "ink-muted": "rgb(var(--ink-muted) / <alpha-value>)",

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
        display: ["var(--font-display)", "var(--font-inter)", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.04em" }],
      },
      borderRadius: {
        card: "14px",
        panel: "18px",
      },
      boxShadow: {
        panel: "0 1px 0 0 rgb(var(--line) / 0.6), 0 20px 50px -30px rgb(0 0 0 / 0.9)",
        lift: "0 24px 60px -32px rgb(0 0 0 / 0.95)",
        glow: "0 0 0 1px rgb(var(--mint) / 0.28), 0 0 34px -10px rgb(var(--mint) / 0.45)",
      },
      backgroundImage: {
        grid: `linear-gradient(to right, rgb(var(--line) / 0.55) 1px, transparent 1px),
               linear-gradient(to bottom, rgb(var(--line) / 0.55) 1px, transparent 1px)`,
      },
      backgroundSize: {
        grid: "56px 56px",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.85)", opacity: "0.7" },
          "70%": { transform: "scale(1.9)", opacity: "0" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(320%)" },
        },
        "flow-dash": {
          to: { strokeDashoffset: "-24" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        sweep: "sweep 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "flow-dash": "flow-dash 1s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
