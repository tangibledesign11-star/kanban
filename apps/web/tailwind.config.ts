import type { Config } from "tailwindcss";
import { fontFamily } from "tailwindcss/defaultTheme";

import baseConfig from "@kan/tailwind-config/web";

export default {
  darkMode: "class",
  content: [...baseConfig.content],
  plugins: [require("@tailwindcss/typography")],
  presets: [baseConfig],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", ...fontFamily.sans],
        mono: ["var(--font-geist-mono)", ...fontFamily.mono],
      },
      fontWeight: {
        thin: "100",
        extralight: "200",
        light: "300",
        normal: "400",
        medium: "500",
        semibold: "500",
        bold: "500",
        extrabold: "500",
        black: "500",
      },
    },
  },
} satisfies Config;
