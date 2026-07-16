import { readFile } from 'node:fs/promises';
import { inventoryLegacyCanvasData } from './polotno-retirement-inventory.js';

function inputPath(arguments_: string[]) {
  const index = arguments_.indexOf('--input');
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value || arguments_.length !== 2) {
    throw new Error(
      'Usage: canvas:retirement-inventory --input <snapshot.json>'
    );
  }
  return value;
}

async function main() {
  const path = inputPath(process.argv.slice(2));
  const input = JSON.parse(await readFile(path, 'utf8')) as Parameters<
    typeof inventoryLegacyCanvasData
  >[0];
  process.stdout.write(
    `${JSON.stringify(inventoryLegacyCanvasData(input), null, 2)}\n`
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Canvas retirement inventory failed.'}\n`
  );
  process.exitCode = 1;
});
