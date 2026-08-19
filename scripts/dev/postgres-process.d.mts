export function postgresDatabaseName(connectionUrl: string): string;
export function postgresProcessEnv(
  connectionUrl: string,
  baseEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv;
