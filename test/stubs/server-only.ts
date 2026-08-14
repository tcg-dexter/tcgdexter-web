/**
 * Stub for the `server-only` marker package.
 *
 * `server-only` has no real entry in node_modules — Next resolves it through
 * its own bundler alias, where importing it from a Client Component is a build
 * error. Vitest has no such alias, so any test that reaches a module marked
 * `import "server-only"` (e.g. app/learn/quiz/questions.ts) fails to resolve.
 *
 * Aliased in vitest.config.ts. Importing it does nothing, which is exactly
 * what the real package does on the server.
 */
export {};
