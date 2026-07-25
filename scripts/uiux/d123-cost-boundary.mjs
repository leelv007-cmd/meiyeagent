import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sql',
  '.ts',
  '.tsx',
]);
const SCAN_ROOTS = ['apps/', 'packages/', 'mkfast-template-main/'];
const FORBIDDEN = [
  new RegExp(['internal', 'cost', 'baseline'].join('[ _-]*'), 'iu'),
  new RegExp(['gross', 'margin', 'reference'].join('[ _-]*'), 'iu'),
  new RegExp(['毛利', String.raw`[^\n]{0,24}`, String.raw`\d+\s*%`].join(''), 'u'),
  new RegExp(
    [
      '(?:文案|图片|视频)',
      String.raw`[^\n]{0,24}`,
      String.raw`(?:0[.]1|0[.]5|15)\s*元`,
    ].join(''),
    'u',
  ),
];

export function findD123CostBoundaryFindings(files) {
  const findings = [];
  for (const file of files) {
    for (const [index, line] of file.text.split(/\r?\n/u).entries()) {
      if (FORBIDDEN.some((pattern) => pattern.test(line))) {
        findings.push({ path: file.path, line: index + 1 });
      }
    }
  }
  return findings;
}

function trackedSourceFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(
      (path) =>
        path &&
        SCAN_ROOTS.some((root) => path.startsWith(root)) &&
        TEXT_EXTENSIONS.has(extname(path)),
    )
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = trackedSourceFiles();
  const findings = findD123CostBoundaryFindings(files);
  process.stdout.write(
    `${JSON.stringify({ filesScanned: files.length, findings }, null, 2)}\n`,
  );
  if (findings.length > 0) process.exitCode = 1;
}
