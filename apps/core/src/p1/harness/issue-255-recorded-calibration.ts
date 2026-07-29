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
  constructor(private readonly router: RecordedAdapterRouter) {}

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
    return {
      output: request.schema.parse({
        ...source,
        factClaims: [],
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

export async function runIssue255RecordedCalibration() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Issue 255 recorded calibration forbids network access.');
  };
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
                boundedExecution: {
                  schemaVersion: 'bounded-execution-snapshot/v1',
                  maxIterations: 2,
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
                runner: new RecordedCopyRunner(router),
                validator: {
                  validate() {
                    return { passed: true, failures: [] };
                  },
                },
              },
            );
            if ('state' in result) {
              throw new Error('Issue 255 recorded copy unexpectedly suspended.');
            }
            iterations = result.boundedExecution?.consumption.iterations ?? 0;
            costCents = result.boundedExecution?.consumption.costCents ?? 0;
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
