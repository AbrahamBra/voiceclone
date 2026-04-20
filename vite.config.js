import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { execSync } from "node:child_process";

function resolveBuildHash() {
  // 1) Vercel injects this in the build env
  const vercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (vercel) return vercel.slice(0, 7);
  // 2) Local builds with git available
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    // 3) Fallback (no git context, e.g. tarball install)
    return "dev";
  }
}

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    "import.meta.env.VITE_BUILD_HASH": JSON.stringify(resolveBuildHash()),
  },
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
