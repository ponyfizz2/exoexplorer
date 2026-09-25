import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"], vendor: [] },
      },
    },
  },
  server: { port: 5173, host: "127.0.0.1" },
  preview: { port: 4173, host: "127.0.0.1" },
});
