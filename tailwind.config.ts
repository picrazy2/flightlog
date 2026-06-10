import type { Config } from "tailwindcss";

// Theme maps to the CSS variables defined in src/index.css (see DESIGN_SYSTEM.md).
// Components reference these names, never raw hex/px.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: {
          1: "var(--surface-1)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          muted: "var(--ink-muted)",
          faint: "var(--ink-faint)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          press: "var(--accent-press)",
        },
        secondary: "var(--secondary)",
        route: {
          domestic: "var(--route-domestic)",
          intl: "var(--route-intl)",
        },
        positive: "var(--positive)",
        warning: "var(--warning)",
        negative: "var(--negative)",
      },
      borderRadius: {
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
        xl: "var(--r-xl)",
      },
      boxShadow: {
        1: "var(--shadow-1)",
        2: "var(--shadow-2)",
        3: "var(--shadow-3)",
      },
      fontFamily: {
        display: ["Space Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["Geist", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "display-xl": ["3rem", { lineHeight: "1.05", fontWeight: "700" }],
        "display-lg": ["2.25rem", { lineHeight: "1.1", fontWeight: "700" }],
        "display-md": ["1.5rem", { lineHeight: "1.15", fontWeight: "600" }],
        title: ["1.125rem", { lineHeight: "1.3", fontWeight: "600" }],
        body: ["0.9375rem", { lineHeight: "1.5" }],
        label: ["0.8125rem", { lineHeight: "1.4", fontWeight: "500" }],
        caption: ["0.75rem", { lineHeight: "1.4", fontWeight: "500" }],
        eyebrow: ["0.6875rem", { lineHeight: "1", fontWeight: "600" }],
      },
      transitionTimingFunction: {
        out: "cubic-bezier(.16,1,.3,1)",
        "in-out": "cubic-bezier(.65,0,.35,1)",
      },
      keyframes: {
        "panel-in": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "panel-in": "panel-in 260ms cubic-bezier(.16,1,.3,1)",
        "fade-in": "fade-in 200ms cubic-bezier(.16,1,.3,1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
