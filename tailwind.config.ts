import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["ui-rounded", "\"SF Pro Rounded\"", "\"Nunito\"", "system-ui", "sans-serif"],
        display: ["ui-rounded", "\"SF Pro Rounded\"", "\"Fredoka\"", "\"Nunito\"", "system-ui", "sans-serif"],
      },
      colors: {
        paper: "#fbf7f0",
        ink: "#1f1b16",
      },
    },
  },
  plugins: [],
} satisfies Config;
