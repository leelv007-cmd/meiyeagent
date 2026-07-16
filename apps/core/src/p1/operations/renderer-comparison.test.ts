import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import {
  compareRendererManifest,
  compareRendererOutputs,
  type RendererComparisonManifest,
} from './renderer-comparison.js';

async function png(pixels: number[], width = 2, height = 2) {
  return sharp(Buffer.from(pixels), {
    raw: { channels: 4, height, width },
  })
    .png()
    .toBuffer();
}

const WHITE = [255, 255, 255, 255];

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('passes byte-distinct but pixel-identical approved renderer output', async () => {
  const legacy = await png([...WHITE, ...WHITE, ...WHITE, ...WHITE]);
  const candidate = await sharp(legacy).png({ compressionLevel: 0 }).toBuffer();

  const result = await compareRendererOutputs({
    approval: {
      approvedAt: '2026-07-16T00:00:00.000Z',
      reference: 'approval://renderer-baseline-a',
      reviewer: 'product-reviewer-a',
    },
    candidate,
    legacy,
    sampleId: 'sample-a',
    thresholds: { maxDifferentPixelRatio: 0, minSsim: 1 },
  });

  assert.equal(result.passed, true);
  assert.equal(result.metrics.differentPixelRatio, 0);
  assert.equal(result.metrics.ssim, 1);
  assert.notEqual(result.legacy.sha256, result.candidate.sha256);
  assert.deepEqual(result.dimensions, { height: 2, width: 2 });
});

test('fails when changed pixels exceed the approved thresholds', async () => {
  const legacy = await png([...WHITE, ...WHITE, ...WHITE, ...WHITE]);
  const candidate = await png([0, 0, 0, 255, ...WHITE, ...WHITE, ...WHITE]);

  const result = await compareRendererOutputs({
    approval: {
      approvedAt: '2026-07-16T00:00:00.000Z',
      reference: 'approval://renderer-baseline-a',
      reviewer: 'product-reviewer-a',
    },
    candidate,
    legacy,
    sampleId: 'sample-a',
    thresholds: { maxDifferentPixelRatio: 0, minSsim: 0.999 },
  });

  assert.equal(result.passed, false);
  assert.equal(result.metrics.differentPixelRatio, 0.25);
  assert.ok(result.metrics.ssim < 0.999);
});

test('rejects unapproved thresholds and mismatched dimensions', async () => {
  const legacy = await png([...WHITE, ...WHITE, ...WHITE, ...WHITE]);
  const candidate = await png([...WHITE, ...WHITE], 1, 2);

  await assert.rejects(
    compareRendererOutputs({
      approval: {
        approvedAt: 'invalid',
        reference: '',
        reviewer: '',
      },
      candidate,
      legacy,
      sampleId: 'sample-a',
      thresholds: { maxDifferentPixelRatio: 0, minSsim: 1 },
    }),
    /approval/u
  );

  await assert.rejects(
    compareRendererOutputs({
      approval: {
        approvedAt: '2026-07-16T00:00:00.000Z',
        reference: 'approval://renderer-baseline-a',
        reviewer: 'product-reviewer-a',
      },
      candidate,
      legacy,
      sampleId: 'sample-a',
      thresholds: { maxDifferentPixelRatio: 0, minSsim: 1 },
    }),
    /dimensions/u
  );
});

test('builds a fail-closed report for every approved manifest sample', async () => {
  const legacy = await png([...WHITE, ...WHITE, ...WHITE, ...WHITE]);
  const candidate = await sharp(legacy).png({ compressionLevel: 0 }).toBuffer();
  const files = new Map<string, Uint8Array>([
    ['legacy.png', legacy],
    ['candidate.png', candidate],
  ]);

  const report = await compareRendererManifest(
    {
      approval: {
        approvedAt: '2026-07-16T00:00:00.000Z',
        reference: 'approval://renderer-baseline-a',
        reviewer: 'product-reviewer-a',
      },
      samples: [
        {
          approvedLegacySha256: sha256(legacy),
          candidatePath: 'candidate.png',
          id: 'sample-a',
          legacyPath: 'legacy.png',
        },
      ],
      schemaVersion: 1,
      thresholds: { maxDifferentPixelRatio: 0, minSsim: 1 },
    },
    async (path) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`Missing fixture ${path}.`);
      return bytes;
    }
  );

  assert.equal(report.status, 'passed');
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0]?.sampleId, 'sample-a');
});

test('rejects a legacy raster that no longer matches its approved SHA-256', async () => {
  const approvedLegacy = await png([...WHITE, ...WHITE, ...WHITE, ...WHITE]);
  const substituted = await png([0, 0, 0, 255, ...WHITE, ...WHITE, ...WHITE]);
  const manifest = {
    approval: {
      approvedAt: '2026-07-16T00:00:00.000Z',
      reference: 'approval://renderer-baseline-a',
      reviewer: 'product-reviewer-a',
    },
    samples: [
      {
        approvedLegacySha256: sha256(approvedLegacy),
        candidatePath: 'candidate.png',
        id: 'sample-a',
        legacyPath: 'legacy.png',
      },
    ],
    schemaVersion: 1,
    thresholds: { maxDifferentPixelRatio: 0, minSsim: 1 },
  } satisfies RendererComparisonManifest;

  await assert.rejects(
    compareRendererManifest(manifest, async () => substituted),
    /approved legacy SHA-256/u
  );
});
