import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Match Next's automatic JSX runtime so tests can import .tsx modules.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
