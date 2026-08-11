import { createHash } from 'node:crypto';

import {
  RecordedAdapterRouter,
  recordedRequest,
} from '../model-supply/adapters.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';
import { executeCopySelection } from './execution-selection.js';
import type { BoundedExecutionCalibrationSample } from './bounded-execution-calibration.js';
import { assertIssue255RecordedMatrix } from './issue-255-calibration-guard.js';
import {
  HARNESS_BUILTIN_PROMPTS,
  HARNESS_PROMPT_SITES,
  type HarnessFrozenPrompt,
} from './langfuse-prompts.js';
import { createHarnessCandidateValidator } from './policy-gates.js';

const modalities = ['copy', 'image_text', 'video'] as const;
const bands = ['low', 'typical', 'boundary'] as const;
const seeds = [1, 2, 3] as const;

const bandPrompts = {
  low: '写一个事实清楚、无夸张承诺的门店项目介绍。',
  typical: '基于门店事实写一条适合小红书的项目种草内容，保留价格与预约提示。',
  boundary:
    '在不添加医疗功效、虚构价格或未授权素材的前提下，处理多项限制并生成可直接交付的门店宣发内容。',
} as const;

class RecordedCopyRunner implements StructuredNodeRunner {
  private callCount = 0;

  constructor(
    private readonly router: RecordedAdapterRouter,
    private readonly scenarioBand: (typeof bands)[number],
  ) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    const providerRequest = recordedRequest(
      'deepseek-v4-pro',
      'copy.generate',
    );
    providerRequest.jobId = request.effectIdempotencyKey;
    providerRequest.submission.idempotencyKey = request.effectIdempotencyKey;
    providerRequest.submission.prompt = request.prompt;
    providerRequest.submission.copyCandidateCount = 1;
    const result = await this.router.execute(providerRequest);
    if (result.kind !== 'completed' || !result.copyCandidates?.[0]) {
      throw new Error('Issue 255 recorded copy adapter returned no candidate.');
    }
    if (result.providerCost.currency !== 'CNY') {
      throw new Error('Issue 255 recorded copy cost must be CNY.');
    }
    if (!result.providerTaskRef) {
      throw new Error(
        'Issue 255 recorded copy adapter returned no provider task reference.',
      );
    }
    const source = result.copyCandidates[0];
    this.callCount += 1;
    const needsCorrection =
      this.scenarioBand !== 'low' && this.callCount === 1;
    return {
      output: request.schema.parse({
        ...source,
        factClaims: needsCorrection
          ? [
              {
                kind: 'offer',
                value: '首次候选中的无来源优惠',
              },
            ]
          : [],
        assetRefs: [],
        expressionIdentityRef: 'issue-255-recorded-identity',
      }),
      attempts: 1,
      observedCostCents: Math.ceil(result.providerCost.amount * 100),
      providerTaskRef: result.providerTaskRef,
      replayed: false,
      usage: {
        inputTokens: result.providerCost.usage.inputTokens ?? 0,
        outputTokens: result.providerCost.usage.outputTokens ?? 0,
      },
    };
  }
}

export async function runIssue255RecordedCalibration(
  networkFetch: typeof globalThis.fetch = async () => {
    throw new Error('Issue 255 recorded calibration forbids network access.');
  },
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = networkFetch;
  try {
    const router = new RecordedAdapterRouter();
    const samples: BoundedExecutionCalibrationSample[] = [];
    for (const modality of modalities) {
      for (const scenarioBand of bands) {
        for (const seed of seeds) {
          const sampleId = `${modality}-${scenarioBand}-${seed}`;
          const startedAt = performance.now();
          let iterations = 1;
          let costCents = 0;
          if (modality === 'copy') {
            const result = await executeCopySelection(
              {
                workflowId: `issue-255-${sampleId}`,
                unitId: 'copy-primary',
                brief: {
                  kind: 'copy',
                  instructions: `${bandPrompts[scenarioBand]} seed=${seed}`,
                  platform: 'xiaohongshu',
                  cta: '私信预约',
                  factRefs: [],
                  assetRefs: [],
                  identityRefs: ['issue-255-recorded-identity'],
                  constraints: ['不得编造事实'],
                },
                workspaceId: 'issue-255-recorded',
                intendedUse: 'public_content',
                generationContext: {
                  bundle: {
                    workspaceId: 'issue-255-recorded',
                    revision: seed,
                  },
                  sourceRefs: [],
                  rightsRefs: [],
                  identityRefs: [
                    {
                      id: 'issue-255-recorded-identity',
                      status: 'registered',
                    },
                  ],
                },
                // Explicit pin (not silent builtin inside selection): the
                // recorded matrix freezes the pilot body under a named pin so
                // fail-closed consumers still see a release-shaped binding.
                prompt: recordedCopyCandidatePin(),
                boundedExecution: {
                  schemaVersion: 'bounded-execution-snapshot/v1',
                  maxIterations: scenarioBand === 'boundary' ? 1 : 2,
                  maxCostCents: 100,
                  maxWallClockMs: 60_000,
                  maxDelegations: 'unset',
                  requiredLimits: [
                    'maxIterations',
                    'maxCostCents',
                    'maxWallClockMs',
                  ],
                  consumption: {
                    iterations: 0,
                    costCents: 0,
                    wallClockMs: 0,
                    delegations: 0,
                  },
                  stopReason: null,
                  triggeredLimit: null,
                },
              },
              {
                runner: new RecordedCopyRunner(router, scenarioBand),
                validator: createHarnessCandidateValidator({
                  phase: 'execution',
                  bundle: {
                    workspaceId: 'issue-255-recorded',
                    revision: seed,
                  },
                  brief: {},
                  sourceRefs: [],
                  rightsRefs: [],
                  identityRefs: [
                    {
                      id: 'issue-255-recorded-identity',
                      workspaceId: 'issue-255-recorded',
                      status: 'registered',
                    },
                  ],
                }),
              },
            );
            const consumption =
              'state' in result
                ? result.snapshot.consumption
                : result.boundedExecution?.consumption;
            iterations = consumption?.iterations ?? 0;
            costCents = consumption?.costCents ?? 0;
          } else {
            const catalogModelId =
              modality === 'image_text'
                ? 'gpt-image-2'
                : 'seedance-1-5-pro';
            const operation =
              modality === 'image_text'
                ? 'image.generate'
                : 'video.generate';
            const request = recordedRequest(catalogModelId, operation, {
              width: 512,
              height: 512,
              ...(modality === 'video' ? { durationSeconds: 1 } : {}),
            });
            request.jobId = `issue-255-${sampleId}`;
            request.submission.idempotencyKey = `issue-255-${sampleId}`;
            request.submission.prompt = `${bandPrompts[scenarioBand]} seed=${seed}`;
            const result = await router.execute(request);
            if (result.kind !== 'completed') {
              throw new Error(
                `Issue 255 recorded ${modality} adapter did not complete.`,
              );
            }
          }
          samples.push({
            axes: {
              skillRevision: `issue-255/${modality}@recorded-v1`,
              promptVersion: `issue-255/${scenarioBand}@v1`,
              catalogRevision: 'issue-255-recorded-catalog-v1',
              scene: `${modality}.generate`,
            },
            artifactRef: `recorded://issue-255/${sampleId}`,
            evidenceKind: 'recorded',
            loopEvidence:
              modality === 'copy'
                ? scenarioBand === 'low'
                  ? 'bounded_single_pass'
                  : 'full_limit_loop'
                : 'non_limit_loop',
            modality,
            sampleId,
            scenarioBand,
            scenarioId: `${modality}-${scenarioBand}`,
            seed,
            observed: {
              delegations: 0,
              iterations,
              costCents,
              wallClockMs: Math.max(
                1,
                Math.ceil(performance.now() - startedAt),
              ),
              suspendedMs: 0,
            },
          });
        }
      }
    }
    return assertIssue255RecordedMatrix(samples);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function recordedCopyCandidatePin(): HarnessFrozenPrompt {
  const content = HARNESS_BUILTIN_PROMPTS.copyCandidate;
  return {
    name: HARNESS_PROMPT_SITES.copyCandidate.name,
    version: 'recorded-v1',
    content,
    contentHash: createHash('sha256').update(content).digest('hex'),
    label: 'production',
    source: 'langfuse',
    isFallback: false,
  };
}
