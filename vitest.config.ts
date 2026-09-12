import { defineConfig } from "vitest/config";
import { availableParallelism } from "node:os";
import path from "node:path";

// Cap worker count and per-worker heap.
//
// On 2026-09-08 an uncapped run panicked the machine: vitest's default
// `maxForks = availableParallelism()` gave ~9 isolated forks, the engine-sim
// and self-play suites plus a per-worker copy of the 14.5 MB card catalog put
// each fork at 1–2 GB, and two concurrent runs reached ~26 GB on a 17 GB box.
// WindowServer was starved of pages for 125 s and the ARM watchdog panicked
// the kernel. 4 × 1 GB keeps a full run near 4–5 GB.
//
// The `- 1` leaves a core for the main process; the floor of 1 keeps 2-core CI
// runners working, where this also caps below the default.
const MAX_FORKS = Math.max(1, Math.min(4, availableParallelism() - 1));

export default defineConfig({
  // Match Next's automatic JSX runtime so tests can import .tsx modules.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // `.claude/worktrees/**` holds stale duplicate checkouts (temporary agent
    // worktrees) whose out-of-date test copies otherwise pollute full runs
    // with phantom failures — exclude the whole `.claude` tree.
    exclude: ["node_modules/**", ".next/**", "**/.claude/**"],
    pool: "forks",
    poolOptions: {
      forks: {
        minForks: 1,
        maxForks: MAX_FORKS,
        // Per-worker ceiling. A suite that genuinely needs more heap should
        // fail loudly here rather than silently swapping the machine to death.
        execArgv: ["--max-old-space-size=1024"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // Next resolves `server-only` through its own bundler alias; there is no
      // such package on disk, so tests that import a server-only module (e.g.
      // the quiz question bank) can't resolve it without this stub.
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
});
