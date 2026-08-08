import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localDataPlugin } from "./vite-plugin-local-data";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const openAiApiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), localDataPlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    proxy: openAiApiKey
      ? {
          "/openai": {
            target: "https://api.openai.com",
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/openai/, ""),
            headers: {
              Authorization: `Bearer ${openAiApiKey}`,
            },
          },
        }
      : undefined,
  },
}));
