import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CANVAS_INITIAL_GZIP_BUDGET_BYTES = 450 * 1024;
export const MAIN_WEB_INITIAL_GZIP_BUDGET_BYTES = 350 * 1024;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function canvasInitialChunkPaths(appBuildManifest) {
  const pages = appBuildManifest?.pages;
  if (!pages || typeof pages !== 'object') return [];
  const route = pages['/page'] ?? pages['/'] ?? pages['/_app'];
  if (!Array.isArray(route)) return [];
  return [...new Set(route.filter((path) => /^static\/.*\.js$/u.test(path)))].sort();
}

export function canvasInitialChunkPathsFromClientReference(
  buildManifest,
  clientReferenceManifest
) {
  const root = [
    ...(buildManifest?.polyfillFiles ?? []),
    ...(buildManifest?.rootMainFiles ?? []),
  ];
  const client = [
    ...String(clientReferenceManifest).matchAll(
      /["'](static\/chunks\/[^"']+\.js)["']/gu
    ),
  ].map((match) => match[1]);
  return [...new Set([...root, ...client])]
    .filter((path) => /^static\/.*\.js$/u.test(path))
    .sort();
}

export function validateCanvasBundleBudget(
  nextDirectory,
  budgetBytes = CANVAS_INITIAL_GZIP_BUDGET_BYTES
) {
  const appManifestPath = resolve(nextDirectory, 'app-build-manifest.json');
  const buildManifestPath = resolve(nextDirectory, 'build-manifest.json');
  const clientReferenceManifestPath = resolve(
    nextDirectory,
    'server/app/page_client-reference-manifest.js'
  );
  const manifestPath = existsSync(appManifestPath)
    ? appManifestPath
    : buildManifestPath;
  if (!existsSync(manifestPath)) {
    return [`${nextDirectory}: build manifest is required for Canvas bundle budget`];
  }
  const chunks = existsSync(appManifestPath)
    ? canvasInitialChunkPaths(readJson(appManifestPath))
    : existsSync(clientReferenceManifestPath)
      ? canvasInitialChunkPathsFromClientReference(
          readJson(buildManifestPath),
          readFileSync(clientReferenceManifestPath, 'utf8')
        )
      : [];
  if (chunks.length === 0) {
    return [`${manifestPath}: no Canvas initial client chunks were found`];
  }
  let gzipBytes = 0;
  for (const chunk of chunks) {
    const chunkPath = resolve(nextDirectory, chunk);
    if (!existsSync(chunkPath)) {
      return [`${manifestPath}: declared chunk is missing: ${chunk}`];
    }
    gzipBytes += gzipSync(readFileSync(chunkPath)).byteLength;
  }
  if (gzipBytes > budgetBytes) {
    return [
      `${nextDirectory}: Canvas initial gzip ${gzipBytes} exceeds budget ${budgetBytes}`,
    ];
  }
  return [];
}

/** Source-level guard: Canvas app modules must not become a Main Web import. */
export function findMainWebCanvasImportViolations(files) {
  return files
    .filter((file) =>
      /(?:from\s+|import\s*\()['"][^'"]*(?:@meiye\/canvas|apps\/canvas\/src)[^'"]*['"]/.test(
        file.contents
      )
    )
    .map((file) => `${file.path}: Main Web must not import Canvas app modules`)
    .sort();
}

const isEntrypoint =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const nextDirectory = resolve(process.cwd(), process.argv[2] ?? 'apps/canvas/.next');
  const issues = validateCanvasBundleBudget(nextDirectory);
  if (issues.length > 0) {
    for (const issue of issues) process.stderr.write(`- ${issue}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Canvas bundle budget passed.\n');
  }
}
