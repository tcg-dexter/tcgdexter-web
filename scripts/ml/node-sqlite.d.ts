// Minimal typings for Node 22's built-in node:sqlite (still absent from
// @types/node ^20). Only the surface the ML CLIs use (extract reads,
// selfplay writes).
declare module "node:sqlite" {
  interface DatabaseSyncOptions {
    readOnly?: boolean;
    open?: boolean;
  }

  type SqliteValue = null | number | bigint | string | Uint8Array;

  class StatementSync {
    all(...params: SqliteValue[]): Record<string, unknown>[];
    get(...params: SqliteValue[]): Record<string, unknown> | undefined;
    run(...params: SqliteValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }

  class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }

  export { DatabaseSync, StatementSync };
}
