/**
 * RET-05 / D-155: merchant routes and product surfaces must not promise
 * publish:<platform> distribution targets. Tests that assert absence (this
 * file, landing-capability-contract.test.ts, composer-submission.test.ts)
 * are the allowed remaining mentions.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const WEB_SRC = process.cwd().endsWith('mkfast-template-main')
  ? join(process.cwd(), 'src')
  : join(process.cwd(), 'mkfast-template-main/src');

const MERCHANT_ROOTS = [
  join(WEB_SRC, 'routes/dashboard'),
  join(WEB_SRC, 'routes/api/core'),
  join(WEB_SRC, 'product'),
  join(WEB_SRC, 'components/landing'),
];

const ACTIVE_PROMISE =
  /['"`]publish:|publish:(?:xiaohongshu|douyin|video_account)/u;

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
      continue;
    }
    if (!/\.(ts|tsx)$/u.test(name)) continue;
    if (/\.test\.(ts|tsx)$/u.test(name)) continue;
    files.push(full);
  }
  return files;
}

test('merchant routes and product surfaces have no publish:* active promise', () => {
  const hits: string[] = [];
  for (const root of MERCHANT_ROOTS) {
    for (const file of walk(root)) {
      const source = readFileSync(file, 'utf8');
      if (ACTIVE_PROMISE.test(source)) {
        hits.push(relative(WEB_SRC, file));
      }
    }
  }
  assert.deepEqual(hits, []);
});
