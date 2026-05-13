import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    copyPublicDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3333",
      "/ws": {
        target: "ws://localhost:3333",
        ws: true,
      },
    },
  },
});
