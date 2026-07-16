import { runLegacyCanvasSnapshotCli } from './polotno-retirement-snapshot-cli.js';

try {
  const result = await runLegacyCanvasSnapshotCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Canvas retirement snapshot failed.'}\n`
  );
  process.exitCode = 1;
}
