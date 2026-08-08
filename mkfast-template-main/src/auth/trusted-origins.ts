export function resolveTrustedAuthOrigins(isDev: boolean): string[] {
  return isDev ? ['http://127.0.0.1:3000'] : [];
}
