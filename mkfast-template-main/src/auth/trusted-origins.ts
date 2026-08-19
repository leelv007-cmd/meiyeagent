export function resolveTrustedAuthOrigins(
  isDev: boolean,
  port = '3000'
): string[] {
  return isDev ? [`http://127.0.0.1:${port}`] : [];
}
