import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Served at the root of journia.akguo.com (Cloudflare Pages), so base is "/".
export default defineConfig(() => ({
  base: "/",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: { port: 5173 },
}));
