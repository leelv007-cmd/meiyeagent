import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DeterministicFakeVideoProvider,
  VideoProviderError,
} from './provider.js';
import { runVideoProof, type VideoProofMetrics } from './proof.js';
import { VideoLabelValidationError } from './validation.js';

test('video proof composes generated/provided clips and records output metrics', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'video-proof-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const providedPath = join(directory, 'provided.mp4');
  await writeFile(providedPath, 'provided');
  const provider = new DeterministicFakeVideoProvider({
    provider: 'fake-seedance',
    model: 'fake-v1',
    clipBytes: Buffer.from('generated'),
    cost: { amount: 1.6, currency: 'CNY', estimated: false },
  });
  const recorded: VideoProofMetrics[] = [];
  let composedPaths: string[] = [];
  const ticks = [100, 145];

  const result = await runVideoProof({
    outputId: 'output-1',
    outputPath: join(directory, 'output.mp4'),
    provider,
    clips: [
      { kind: 'provided', path: providedPath },
      {
        kind: 'generated',
        request: {
          prompt: 'A clean salon interior pan',
          durationSeconds: 5,
          aspectRatio: '9:16',
          correlationId: 'corr-proof-1',
        },
      },
    ],
    subtitles: [{ text: '门店日常', startSeconds: 0, endSeconds: 5 }],
    aigcLabelEnabled: true,
    implicitLabel: {
      serviceProvider: 'Meiye Content Copilot',
      serviceCode: 'meiye-core',
      contentId: 'output-1',
    },
    evaluateUsableQuality: async () => ({
      usable: false,
      reason: 'motion artifact in final second',
    }),
    recordMetrics: async (metrics) => { recorded.push(metrics); },
  }, {
    composeVideo: async (options) => {
      composedPaths = options.clipPaths;
      await writeFile(options.outputPath, 'composed');
    },
    validateVideoLabels: async () => ({
      filePath: join(directory, 'output.mp4'),
      visibleLabel: '内容由 AI 生成',
      implicitLabel: {
        contentType: 'ai_generated',
        serviceProvider: 'Meiye Content Copilot',
        serviceCode: 'meiye-core',
        contentId: 'output-1',
      },
    }),
    now: () => ticks.shift() ?? 145,
  });

  assert.equal(composedPaths[0], providedPath);
  assert.match(composedPaths[1] ?? '', /generated-1\.mp4$/);
  assert.deepEqual(result.metrics, {
    outputId: 'output-1',
    providerCost: { amount: 1.6, currency: 'CNY', estimated: false },
    endToEndLatencyMs: 45,
    technicalSuccess: true,
    usableQuality: {
      status: 'assessed',
      usable: false,
      reason: 'motion artifact in final second',
    },
  });
  assert.deepEqual(recorded, [result.metrics]);
});

test('video proof preserves classified provider failure and records technical failure', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'video-proof-failure-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const providerError = new VideoProviderError({
    code: 'transient',
    message: 'provider unavailable',
    provider: 'fake-seedance',
    retryable: true,
    refund: 'required',
  });
  const provider = new DeterministicFakeVideoProvider({
    provider: 'fake-seedance',
    model: 'fake-v1',
    clipBytes: Buffer.from('unused'),
    cost: { amount: 1.6, currency: 'CNY', estimated: false },
    failure: providerError,
  });
  const recorded: VideoProofMetrics[] = [];
  const ticks = [200, 230];

  await assert.rejects(
    runVideoProof({
      outputId: 'output-failed',
      outputPath: join(directory, 'output.mp4'),
      provider,
      clips: [{
        kind: 'generated',
        request: {
          prompt: 'A salon scene',
          durationSeconds: 5,
          aspectRatio: '9:16',
          correlationId: 'corr-proof-failed',
        },
      }],
      subtitles: [],
      aigcLabelEnabled: true,
      implicitLabel: {
        serviceProvider: 'Meiye Content Copilot',
        serviceCode: 'meiye-core',
        contentId: 'output-failed',
      },
      evaluateUsableQuality: async () => ({ usable: true, reason: 'unused' }),
      recordMetrics: async (metrics) => { recorded.push(metrics); },
    }, {
      composeVideo: async () => { throw new Error('composition must not run'); },
      validateVideoLabels: async () => { throw new Error('validation must not run'); },
      now: () => ticks.shift() ?? 230,
    }),
    (error) => {
      assert.equal(error, providerError);
      assert.equal(providerError.retryable, true);
      assert.equal(providerError.refund, 'required');
      return true;
    }
  );
  assert.deepEqual(recorded, [{
    outputId: 'output-failed',
    providerCost: { amount: 0, currency: 'CNY', estimated: false },
    endToEndLatencyMs: 30,
    technicalSuccess: false,
    usableQuality: { status: 'not_assessed', reason: 'technical_failure' },
  }]);
});

test('video proof removes output and records failure when label validation fails', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'video-proof-label-failure-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const outputPath = join(directory, 'unlabeled-output.mp4');
  const provider = new DeterministicFakeVideoProvider({
    provider: 'fake-seedance',
    model: 'fake-v1',
    clipBytes: Buffer.from('generated'),
    cost: { amount: 1.2, currency: 'CNY', estimated: false },
  });
  const recorded: VideoProofMetrics[] = [];
  let qualityEvaluated = false;
  const ticks = [300, 320];

  await assert.rejects(
    runVideoProof({
      outputId: 'output-unlabeled',
      outputPath,
      provider,
      clips: [{
        kind: 'generated',
        request: {
          prompt: 'A salon scene',
          durationSeconds: 5,
          aspectRatio: '9:16',
          correlationId: 'corr-unlabeled',
        },
      }],
      subtitles: [],
      aigcLabelEnabled: true,
      implicitLabel: {
        serviceProvider: 'Meiye Content Copilot',
        serviceCode: 'meiye-core',
        contentId: 'output-unlabeled',
      },
      evaluateUsableQuality: async () => {
        qualityEvaluated = true;
        return { usable: true, reason: 'must not run' };
      },
      recordMetrics: async (metrics) => { recorded.push(metrics); },
    }, {
      composeVideo: async () => { await writeFile(outputPath, 'unlabeled'); },
      validateVideoLabels: async () => {
        throw new VideoLabelValidationError(
          'visible_label_missing',
          'visible evidence absent'
        );
      },
      now: () => ticks.shift() ?? 320,
    }),
    (error) => {
      assert.ok(error instanceof VideoLabelValidationError);
      return true;
    }
  );

  await assert.rejects(stat(outputPath), { code: 'ENOENT' });
  assert.equal(qualityEvaluated, false);
  assert.equal(recorded[0]?.technicalSuccess, false);
  assert.deepEqual(recorded[0]?.providerCost, {
    amount: 1.2,
    currency: 'CNY',
    estimated: false,
  });
});
