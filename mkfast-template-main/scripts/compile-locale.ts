import { compile } from '@inlang/paraglide-js';
import { paraglideCompilerOptions } from '../paraglide.config';

const outputStructure = process.argv.includes('--dev')
  ? 'locale-modules'
  : 'message-modules';

await compile({
  ...paraglideCompilerOptions,
  outputStructure,
});
