export function postgresDatabaseName(connectionUrl: string): string;
export function postgresProcessEnv(
  connectionUrl: string,
  baseEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
export function runPostgresStatementSync(
  connectionUrl: string,
  statement: string,
  options?: {
    args?: string[];
    command?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): { status: number; stderr: string; stdout: string };
