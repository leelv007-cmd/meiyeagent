/**
 * Copies HeroUI Pro V3 component source out of the licensed local mirror into
 * `src/components/heroui-pro/vendor/`.
 *
 * The mirror (`references/repos/herouipro-v3`) is a per-user licensed artifact:
 * gitignored, never committed, never redistributed (D-130). Only the component
 * sources this app actually uses get copied in, and the copy is reproducible
 * from the pin recorded in `src/components/heroui-pro/components.json`.
 *
 *   pnpm --filter @meiye/web heroui:sync
 *   HEROUI_PRO_MIRROR=/path/to/herouipro-v3 pnpm --filter @meiye/web heroui:sync
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '..');
const vendorRoot = join(appRoot, 'src/components/heroui-pro/vendor');
const pinPath = join(appRoot, 'src/components/heroui-pro/components.json');
const patchesPath = join(
  appRoot,
  'src/components/heroui-pro/vendor-patches.json'
);

type Patch = {
  file: string;
  reason: string;
  find: string;
  replace: string;
};

type Pin = {
  package: string;
  version: string;
  mirrorPath: string;
  mirrorCommit: string;
  theme: string;
  components: string[];
};

const pin: Pin = JSON.parse(readFileSync(pinPath, 'utf8'));
const mirror =
  process.env.HEROUI_PRO_MIRROR?.trim() || join(repoRoot, pin.mirrorPath);

function fail(message: string): never {
  process.stderr.write(`sync-heroui-pro: ${message}\n`);
  process.exit(1);
}

if (!existsSync(mirror)) {
  fail(
    `mirror not found at ${mirror}. The mirror is gitignored and lives only on ` +
      `machines licensed for it — point HEROUI_PRO_MIRROR at your local clone.`
  );
}

const mirrorPkg = JSON.parse(
  readFileSync(join(mirror, 'package.json'), 'utf8')
) as { name: string; version: string };
if (mirrorPkg.name !== pin.package || mirrorPkg.version !== pin.version) {
  fail(
    `mirror is ${mirrorPkg.name}@${mirrorPkg.version} but components.json pins ` +
      `${pin.package}@${pin.version}. Check out the pinned ref before syncing.`
  );
}

/** Every relative import a copied file reaches outside its own directory. */
function relativeImports(text: string): string[] {
  return [...text.matchAll(/from\s+'(\.\.\/[^']+)'/g)].map(([, id]) => id);
}

function readSourceFiles(dir: string): { path: string; text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return readSourceFiles(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    return [{ path, text: readFileSync(path, 'utf8') }];
  });
}

/**
 * Walks the requested components, following their `../` imports until the copy
 * set is closed. Keeps the mirror's own layout so the relative imports inside
 * the copied sources keep resolving untouched.
 */
const copied = new Set<string>();
const queue = pin.components.map((name) => `components/${name}`);

while (queue.length > 0) {
  const id = queue.shift() as string;
  if (copied.has(id)) continue;

  const asDirectory = join(mirror, 'src', id);
  const isDirectory =
    existsSync(asDirectory) && statSync(asDirectory).isDirectory();
  const sources = isDirectory
    ? readSourceFiles(asDirectory)
    : ['.tsx', '.ts']
        .map((extension) => join(mirror, 'src', `${id}${extension}`))
        .filter((path) => existsSync(path))
        .map((path) => ({ path, text: readFileSync(path, 'utf8') }));

  if (sources.length === 0) fail(`cannot resolve ${id} inside ${mirror}/src`);
  copied.add(id);

  for (const { path, text } of sources) {
    for (const importId of relativeImports(text)) {
      // `../../utils/compose` from src/components/x/y.tsx → utils/compose
      const resolved = relative(
        join(mirror, 'src'),
        resolve(dirname(path), importId)
      );
      // Pull whole component/util units, not single files, so partial copies
      // can't drift: `components/sheet/index` → `components/sheet`.
      const [area, unit] = resolved.split('/');
      const unitPath = join(mirror, 'src', area, unit);
      const isUnitDirectory =
        existsSync(unitPath) && statSync(unitPath).isDirectory();
      queue.push(isUnitDirectory ? `${area}/${unit}` : resolved);
    }
  }
}

rmSync(vendorRoot, { force: true, recursive: true });

const manifest: Record<string, string> = {};
function record(destination: string) {
  const key = relative(vendorRoot, destination).replaceAll('\\', '/');
  manifest[key] = createHash('sha256')
    .update(readFileSync(destination))
    .digest('hex');
}

function copyUnit(id: string) {
  const sourceDirectory = join(mirror, 'src', id);
  if (existsSync(sourceDirectory) && statSync(sourceDirectory).isDirectory()) {
    const destination = join(vendorRoot, id);
    cpSync(sourceDirectory, destination, { recursive: true });
    for (const { path } of readSourceFiles(destination)) record(path);
    return;
  }
  for (const extension of ['.tsx', '.ts']) {
    const source = join(mirror, 'src', `${id}${extension}`);
    if (!existsSync(source)) continue;
    const destination = join(vendorRoot, `${id}${extension}`);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination);
    record(destination);
    return;
  }
  fail(`cannot copy ${id}`);
}

const units = [...copied].sort();
for (const id of units) copyUnit(id);

// Vendored sources answer to the library's lint posture, not this app's, so a
// handful of upstream unused symbols would otherwise fail `pnpm typecheck`.
// Each rewrite is declared, applied exactly once, and re-hashed below.
const { patches } = JSON.parse(readFileSync(patchesPath, 'utf8')) as {
  patches: Patch[];
};
for (const patch of patches) {
  const target = join(vendorRoot, patch.file);
  if (!existsSync(target)) fail(`patch target ${patch.file} was not vendored`);
  const before = readFileSync(target, 'utf8');
  const occurrences = before.split(patch.find).length - 1;
  if (occurrences !== 1) {
    fail(
      `patch for ${patch.file} matched ${occurrences} times, expected 1 — ` +
        `re-check it against ${pin.package}@${pin.version} (${patch.reason})`
    );
  }
  writeFileSync(target, before.replace(patch.find, patch.replace));
  record(target);
}

// Per-component CSS ships separately in the mirror; take only what we copied so
// the spike stylesheet stays proportional to the components actually vendored.
const cssDestination = join(vendorRoot, 'css');
mkdirSync(cssDestination, { recursive: true });
const componentCss = units
  .filter((id) => id.startsWith('components/'))
  .map((id) => id.slice('components/'.length))
  .filter((name) =>
    existsSync(join(mirror, 'src/css/components', `${name}.css`))
  );
for (const name of componentCss) {
  const destination = join(cssDestination, `${name}.css`);
  cpSync(join(mirror, 'src/css/components', `${name}.css`), destination);
  record(destination);
}

// D-130 pins Glass. Brutalism and Mouve are deliberately not vendored.
const themeDestination = join(cssDestination, `theme-${pin.theme}.css`);
cpSync(
  join(mirror, 'src/css/themes', pin.theme, 'index.css'),
  themeDestination
);
record(themeDestination);

const cssEntry = [
  '/* Generated by scripts/sync-heroui-pro.ts — do not edit. */',
  ...componentCss.map((name) => `@import "./${name}.css";`),
  `@import "./theme-${pin.theme}.css";`,
  '',
].join('\n');
writeFileSync(join(cssDestination, 'index.css'), cssEntry);
record(join(cssDestination, 'index.css'));

writeFileSync(
  join(vendorRoot, 'MIRROR.json'),
  `${JSON.stringify(
    {
      $comment:
        'Generated by scripts/sync-heroui-pro.ts. `files` are sha256 of the ' +
        'vendored copies after vendor-patches.json — a mismatch means someone ' +
        'hand-edited vendored code.',
      package: pin.package,
      version: pin.version,
      mirrorCommit: pin.mirrorCommit,
      theme: pin.theme,
      requested: pin.components,
      units,
      patches: patches.map(({ file, reason }) => ({ file, reason })),
      files: Object.fromEntries(Object.entries(manifest).sort()),
    },
    null,
    2
  )}\n`
);

process.stdout.write(
  `sync-heroui-pro: ${units.length} units, ${componentCss.length} component stylesheets ` +
    `from ${pin.package}@${pin.version} → ${relative(repoRoot, vendorRoot)}\n`
);
