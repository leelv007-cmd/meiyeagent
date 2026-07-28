import { readFile, writeFile } from 'node:fs/promises';
import { compile } from '@inlang/paraglide-js';
import { paraglideCompilerOptions } from '../paraglide.config';

const outputStructure = process.argv.includes('--dev')
  ? 'locale-modules'
  : 'message-modules';
const gitignoreUrl = new URL('../project.inlang/.gitignore', import.meta.url);
const trackedGitignore = await readFile(gitignoreUrl);

try {
  await compile({
    ...paraglideCompilerOptions,
    outputStructure,
  });
} finally {
  await writeFile(gitignoreUrl, trackedGitignore);
}
