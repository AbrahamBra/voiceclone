import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  optimizeDeps: {
    include: ["pdfjs-dist"],
    exclude: ["pdfjs-dist/build/pdf.worker.min.mjs"],
  },
  server: {
    fs: {
      // Allow hoisted node_modules (needed when running from a git worktree)
      allow: ["../../../.."],
    },
  },
});
