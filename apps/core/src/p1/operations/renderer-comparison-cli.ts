import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  compareRendererManifest,
  type RendererComparisonManifest,
} from './renderer-comparison.js';

function manifestPath(arguments_: string[]) {
  const index = arguments_.indexOf('--manifest');
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value || arguments_.length !== 2) {
    throw new Error(
      'Usage: canvas:renderer-comparison --manifest <manifest.json>'
    );
  }
  return resolve(value);
}

async function main() {
  const path = manifestPath(process.argv.slice(2));
  const root = dirname(path);
  const manifest = JSON.parse(
    await readFile(path, 'utf8')
  ) as RendererComparisonManifest;
  const report = await compareRendererManifest(manifest, async (file) => {
    const target = resolve(root, file);
    const fromRoot = relative(root, target);
    if (
      isAbsolute(fromRoot) ||
      fromRoot === '..' ||
      fromRoot.startsWith(`..${sep}`)
    ) {
      throw new Error(
        'Renderer comparison sample path escapes the manifest directory.'
      );
    }
    return readFile(target);
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Renderer comparison failed.'}\n`
  );
  process.exitCode = 1;
});
