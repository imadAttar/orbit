import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";

const host = process.env.TAURI_DEV_HOST;
const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  clearScreen: false,
  server: {
    // Preview pages may use normal web origins, but must never frame Orbit's
    // own privileged UI (including redirects back to this development server).
    headers: { "Content-Security-Policy": "frame-ancestors 'none'" },
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "jsdom",
    exclude: ["tests/**", "node_modules/**"],
  },
});
