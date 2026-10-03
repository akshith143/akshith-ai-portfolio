import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  publicDir: "public",
  build: { outDir: "../dist/web", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 700 }, // three.js chunk is lazy-loaded
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } },
  },
});
