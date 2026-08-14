import { defineConfig } from "vitest/config";
import path from "node:path";

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
