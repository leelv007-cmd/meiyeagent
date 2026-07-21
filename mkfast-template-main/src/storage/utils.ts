/**
 * Normalize a folder path into safe storage key segments.
 */
export function sanitizeFolder(folder?: string): string | undefined {
  if (!folder) return undefined;

  const segments = folder
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..');

  if (segments.length === 0) return undefined;

  return segments
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, '-'))
    .join('/');
}
