import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('bounded-execution calibration CLI summarizes a traceable sample file without relabeling evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bounds-calibration-'));
  const inputPath = join(directory, 'samples.json');
  const cliPath = fileURLToPath(
    new URL('./bounded-execution-calibration-cli.ts', import.meta.url),
  );
  const axes = {
    skillRevision: 'copywriter@rev-17',
    promptVersion: 'marketing/copy@v4',
    catalogRevision: 'catalog-2026-07-29',
  };
  const sample = (
    modality: 'copy' | 'image_text' | 'video',
    evidenceKind: 'fixture' | 'recorded' | 'live',
    value: number,
  ) => ({
    axes: { ...axes, scene: `${modality}.generate` },
    artifactRef: `${evidenceKind}://calibration/${modality}-1`,
    evidenceKind,
    modality,
    sampleId: `${modality}-1`,
    scenarioBand: 'typical',
    scenarioId: `${modality}-typical`,
    seed: 1,
    observed: {
      delegations: 0,
      iterations: value,
      costCents: value * 10,
      wallClockMs: value * 100,
      suspendedMs: 0,
    },
  });

  try {
    await writeFile(
      inputPath,
      JSON.stringify([
        sample('copy', 'fixture', 1),
        sample('image_text', 'recorded', 2),
        sample('video', 'live', 3),
      ]),
    );
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliPath, inputPath],
      {
        cwd: dirname(cliPath),
        encoding: 'utf8',
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout) as {
      sampleCount: number;
      evidenceCounts: Record<string, number>;
      overall: { maxIterations: { max: number } };
    };
    assert.equal(summary.sampleCount, 3);
    assert.deepEqual(summary.evidenceCounts, {
      fixture: 1,
      recorded: 1,
      live: 1,
    });
    assert.equal(summary.overall.maxIterations.max, 3);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
