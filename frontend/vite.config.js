import { defineConfig } from "vite";
// Relative base so the build works on any host or sub-path (Vercel, Netlify, GitHub Pages, IPFS).
export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
