import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Served under /journia in prod (Cloudflare Pages on akguo.com/journia), "/" in dev.
// The build emits into dist/journia so the on-disk paths match the URL paths; the
// Cloudflare "build output directory" is `dist`, which also holds _redirects.
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/journia/" : "/",
  build: { outDir: mode === "production" ? "dist/journia" : "dist", emptyOutDir: true },
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: { port: 5173 },
}));
