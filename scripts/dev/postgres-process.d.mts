export function postgresDatabaseName(connectionUrl: string): string;
export function postgresProcessEnv(
  connectionUrl: string,
  baseEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
export function spawnPostgresStatement(
  connectionUrl: string,
  statement: string,
  options?: {
    args?: string[];
    command?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): import('node:child_process').ChildProcess;
