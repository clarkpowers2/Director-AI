import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ffmpeg.wasm ships its own worker; pre-bundling breaks it
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  server: {
    // Forward /api to `wrangler pages dev` when running both locally
    proxy: { "/api": "http://localhost:8788" }
  }
});
