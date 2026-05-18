import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

// https://vite.dev/config/
export default defineConfig({
  base: "/gate-building-ai/",

  plugins: [react(), cesium()],

  define: {
    CESIUM_BASE_URL: JSON.stringify("/gate-building-ai/cesium/"),
  },

  server: {
    proxy: {
      "/chat": { target: "http://127.0.0.1:8010", changeOrigin: true },
      "/forecasts": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/forecasts-csv": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/meters": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
