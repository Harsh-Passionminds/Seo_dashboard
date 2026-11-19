import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        exceljs: path.resolve(__dirname, "../seo-analytics-backend/seo-analytics-backend/node_modules/exceljs/dist/exceljs.min.js"),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: env.VITE_API_PROXY_TARGET || "http://localhost:4000",
          changeOrigin: true,
        },
      },
    },
  };
});
