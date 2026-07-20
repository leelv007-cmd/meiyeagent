import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  composeVideo,
  DEFAULT_AIGC_VISIBLE_LABEL,
  type ComposeVideoOptions,
  type ImplicitVideoLabel,
  type TimedSubtitle,
} from './composer.js';
import {
  type GenerateVideoClipRequest,
  type ProviderCost,
  type VideoProvider,
} from './provider.js';
import {
  validateVideoLabels,
  type ValidatedVideoLabels,
} from './validation.js';

export type VideoProofClip =
  | { kind: 'provided'; path: string }
  | {
      kind: 'generated';
      request: Omit<GenerateVideoClipRequest, 'outputPath'>;
    };

export interface VideoProofMetrics {
  outputId: string;
  providerCost: ProviderCost;
  endToEndLatencyMs: number;
  technicalSuccess: boolean;
  usableQuality:
    | { status: 'assessed'; usable: boolean; reason: string }
    | { status: 'not_assessed'; reason: 'technical_failure' };
}

export interface VideoProofResult {
  outputPath: string;
  labels?: ValidatedVideoLabels;
  metrics: VideoProofMetrics;
}

export interface RunVideoProofOptions {
  outputId: string;
  outputPath: string;
  provider: VideoProvider;
  clips: VideoProofClip[];
  subtitles: TimedSubtitle[];
  aigcLabelEnabled?: boolean;
  implicitLabel?: ImplicitVideoLabel;
  bgmPath?: string;
  bgmVolume?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
  fontFilePath?: string;
  signal?: AbortSignal;
  evaluateUsableQuality: (outputPath: string) => Promise<{
    usable: boolean;
    reason: string;
  }>;
  recordMetrics: (metrics: VideoProofMetrics) => Promise<void>;
}

interface VideoProofDependencies {
  composeVideo: (options: ComposeVideoOptions) => Promise<void>;
  validateVideoLabels: typeof validateVideoLabels;
  now: () => number;
}

function aggregateCost(costs: ProviderCost[], zeroCost: ProviderCost): ProviderCost {
  if (costs.length === 0) return { ...zeroCost };
  const currency = costs[0]?.currency ?? zeroCost.currency;
  if (costs.some((cost) => cost.currency !== currency)) {
    throw new Error('Provider cost evidence used mixed currencies for one output.');
  }
  return {
    amount: costs.reduce((sum, cost) => sum + cost.amount, 0),
    currency,
    estimated: costs.some((cost) => cost.estimated),
  };
}

export async function runVideoProof(
  options: RunVideoProofOptions,
  dependencies: VideoProofDependencies = {
    composeVideo,
    validateVideoLabels,
    now: () => performance.now(),
  }
): Promise<VideoProofResult> {
  if (options.clips.length === 0) throw new Error('Video proof requires at least one clip.');
  const startedAt = dependencies.now();
  const providerCosts: ProviderCost[] = [];
  let outputCreated = false;
  let recordingSuccessMetrics = false;
  await mkdir(dirname(options.outputPath), { recursive: true });
  const workDirectory = await mkdtemp(join(dirname(options.outputPath), '.video-proof-'));

  try {
    const clipPaths: string[] = [];
    let generatedIndex = 0;
    for (const clip of options.clips) {
      if (clip.kind === 'provided') {
        clipPaths.push(clip.path);
        continue;
      }
      generatedIndex += 1;
      const generated = await options.provider.generateClip({
        ...clip.request,
        outputPath: join(workDirectory, `generated-${generatedIndex}.mp4`),
      }, options.signal);
      clipPaths.push(generated.path);
      providerCosts.push(generated.cost);
    }
    await dependencies.composeVideo({
      clipPaths,
      outputPath: options.outputPath,
      subtitles: options.subtitles,
      aigcLabelEnabled: options.aigcLabelEnabled === true,
      ...(options.implicitLabel ? { implicitLabel: options.implicitLabel } : {}),
      ...(options.bgmPath ? { bgmPath: options.bgmPath } : {}),
      ...(options.bgmVolume === undefined ? {} : { bgmVolume: options.bgmVolume }),
      ...(options.ffmpegPath ? { ffmpegPath: options.ffmpegPath } : {}),
      ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
      ...(options.fontFilePath ? { fontFilePath: options.fontFilePath } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    outputCreated = true;
    const labels = options.aigcLabelEnabled === true
      ? await dependencies.validateVideoLabels({
          filePath: options.outputPath,
          expectedVisibleLabel: DEFAULT_AIGC_VISIBLE_LABEL,
          expectedImplicitLabel: options.implicitLabel,
          ...(options.ffprobePath ? { ffprobePath: options.ffprobePath } : {}),
        })
      : undefined;
    const quality = await options.evaluateUsableQuality(options.outputPath);
    const metrics: VideoProofMetrics = {
      outputId: options.outputId,
      providerCost: aggregateCost(providerCosts, options.provider.zeroCost),
      endToEndLatencyMs: Math.max(0, dependencies.now() - startedAt),
      technicalSuccess: true,
      usableQuality: {
        status: 'assessed',
        usable: quality.usable,
        reason: quality.reason,
      },
    };
    recordingSuccessMetrics = true;
    await options.recordMetrics(metrics);
    return {
      outputPath: options.outputPath,
      ...(labels ? { labels } : {}),
      metrics,
    };
  } catch (error) {
    if (recordingSuccessMetrics) throw error;
    if (outputCreated) await rm(options.outputPath, { force: true });
    const metrics: VideoProofMetrics = {
      outputId: options.outputId,
      providerCost: aggregateCost(providerCosts, options.provider.zeroCost),
      endToEndLatencyMs: Math.max(0, dependencies.now() - startedAt),
      technicalSuccess: false,
      usableQuality: { status: 'not_assessed', reason: 'technical_failure' },
    };
    await options.recordMetrics(metrics);
    throw error;
  } finally {
    await rm(workDirectory, { force: true, recursive: true });
  }
}
