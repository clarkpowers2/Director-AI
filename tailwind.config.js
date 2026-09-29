/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#1a2744", 900: "#111a2e", 800: "#152036", 700: "#1a2744", 600: "#243357", 500: "#2f416b" },
        gold: { DEFAULT: "#c9a84c", light: "#dcc27a", dark: "#a88a36" },
        light: "#f8f6f1"
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["'Playfair Display'", "Georgia", "serif"]
      }
    }
  }
};
