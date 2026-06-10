import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// base: served from GitHub Pages under a repo subpath in prod, "/" in dev.
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/flightlog/" : "/",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: { port: 5173 },
}));
