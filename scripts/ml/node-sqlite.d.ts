// Minimal typings for Node 22's built-in node:sqlite (still absent from
// @types/node ^20). Only the read-only surface the ML extract CLI uses.
declare module "node:sqlite" {
  interface DatabaseSyncOptions {
    readOnly?: boolean;
    open?: boolean;
  }

  class StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  }

  class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export { DatabaseSync, StatementSync };
}
