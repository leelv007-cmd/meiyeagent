import { createHash } from 'node:crypto';
import sharp from 'sharp';

export interface RendererComparisonApproval {
  approvedAt: string;
  reference: string;
  reviewer: string;
}

export interface RendererComparisonThresholds {
  maxDifferentPixelRatio: number;
  minSsim: number;
}

export interface RendererComparisonInput {
  approval: RendererComparisonApproval;
  candidate: Uint8Array;
  legacy: Uint8Array;
  sampleId: string;
  thresholds: RendererComparisonThresholds;
}

export interface RendererComparisonResult {
  approval: RendererComparisonApproval;
  candidate: { bytes: number; sha256: string };
  dimensions: { height: number; width: number };
  legacy: { bytes: number; sha256: string };
  metrics: { differentPixelRatio: number; ssim: number };
  passed: boolean;
  sampleId: string;
  thresholds: RendererComparisonThresholds;
}

export interface RendererComparisonManifest {
  approval: RendererComparisonApproval;
  samples: Array<{
    approvedLegacySha256: string;
    candidatePath: string;
    id: string;
    legacyPath: string;
  }>;
  schemaVersion: 1;
  thresholds: RendererComparisonThresholds;
}

export interface RendererComparisonReport {
  approval: RendererComparisonApproval;
  results: RendererComparisonResult[];
  schemaVersion: 1;
  status: 'failed' | 'passed';
  thresholds: RendererComparisonThresholds;
}

export async function compareRendererManifest(
  manifest: RendererComparisonManifest,
  load: (path: string) => Promise<Uint8Array>
): Promise<RendererComparisonReport> {
  if (manifest.schemaVersion !== 1 || manifest.samples.length === 0) {
    throw new Error('Renderer comparison manifest must contain samples.');
  }
  const ids = new Set<string>();
  const results: RendererComparisonResult[] = [];
  for (const sample of manifest.samples) {
    const sampleId = requiredText(sample.id, 'Renderer comparison sample id');
    if (ids.has(sampleId)) {
      throw new Error(`Renderer comparison sample ${sampleId} is duplicated.`);
    }
    ids.add(sampleId);
    const [legacy, candidate] = await Promise.all([
      load(requiredText(sample.legacyPath, 'Legacy renderer path')),
      load(requiredText(sample.candidatePath, 'Candidate renderer path')),
    ]);
    const approvedLegacySha256 = parseSha256(
      sample.approvedLegacySha256,
      'Approved legacy SHA-256'
    );
    if (digest(legacy).sha256 !== approvedLegacySha256) {
      throw new Error(
        `Renderer comparison sample ${sampleId} does not match its approved legacy SHA-256.`
      );
    }
    results.push(
      await compareRendererOutputs({
        approval: manifest.approval,
        candidate,
        legacy,
        sampleId,
        thresholds: manifest.thresholds,
      })
    );
  }
  return {
    approval: parseApproval(manifest.approval),
    results,
    schemaVersion: 1,
    status: results.every((result) => result.passed) ? 'passed' : 'failed',
    thresholds: parseThresholds(manifest.thresholds),
  };
}

export async function compareRendererOutputs(
  input: RendererComparisonInput
): Promise<RendererComparisonResult> {
  const approval = parseApproval(input.approval);
  const thresholds = parseThresholds(input.thresholds);
  const sampleId = requiredText(
    input.sampleId,
    'Renderer comparison sample id'
  );
  const [legacy, candidate] = await Promise.all([
    decodeRaster(input.legacy),
    decodeRaster(input.candidate),
  ]);
  if (
    legacy.info.width !== candidate.info.width ||
    legacy.info.height !== candidate.info.height
  ) {
    throw new Error('Renderer comparison dimensions do not match.');
  }
  const pixelCount = legacy.info.width * legacy.info.height;
  let differentPixels = 0;
  const legacyLuminance = new Float64Array(pixelCount);
  const candidateLuminance = new Float64Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    let different = false;
    for (let channel = 0; channel < 4; channel += 1) {
      if (legacy.data[offset + channel] !== candidate.data[offset + channel]) {
        different = true;
      }
    }
    if (different) differentPixels += 1;
    legacyLuminance[pixel] = luminance(legacy.data, offset);
    candidateLuminance[pixel] = luminance(candidate.data, offset);
  }
  const metrics = {
    differentPixelRatio: differentPixels / pixelCount,
    ssim: structuralSimilarity(legacyLuminance, candidateLuminance),
  };
  return {
    approval,
    candidate: digest(input.candidate),
    dimensions: {
      height: legacy.info.height,
      width: legacy.info.width,
    },
    legacy: digest(input.legacy),
    metrics,
    passed:
      metrics.differentPixelRatio <= thresholds.maxDifferentPixelRatio &&
      metrics.ssim >= thresholds.minSsim,
    sampleId,
    thresholds,
  };
}

async function decodeRaster(bytes: Uint8Array) {
  if (bytes.byteLength === 0) {
    throw new Error('Renderer comparison raster is empty.');
  }
  const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  if (
    !decoded.info.width ||
    !decoded.info.height ||
    decoded.info.channels !== 4
  ) {
    throw new Error(
      'Renderer comparison raster could not be normalized to RGBA.'
    );
  }
  return decoded as typeof decoded & {
    info: typeof decoded.info & { channels: 4; height: number; width: number };
  };
}

function parseApproval(value: RendererComparisonApproval) {
  const approvedAt = Date.parse(value.approvedAt);
  if (
    !Number.isFinite(approvedAt) ||
    new Date(approvedAt).toISOString() !== value.approvedAt ||
    !value.reference.trim() ||
    !value.reviewer.trim()
  ) {
    throw new Error('Renderer comparison approval is required.');
  }
  return {
    approvedAt: value.approvedAt,
    reference: value.reference.trim(),
    reviewer: value.reviewer.trim(),
  };
}

function parseThresholds(value: RendererComparisonThresholds) {
  if (
    !unitInterval(value.maxDifferentPixelRatio) ||
    !unitInterval(value.minSsim)
  ) {
    throw new Error(
      'Renderer comparison thresholds must be between zero and one.'
    );
  }
  return { ...value };
}

function unitInterval(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function requiredText(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function parseSha256(value: string, label: string) {
  const normalized = requiredText(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error(`${label} must be a 64-character hexadecimal digest.`);
  }
  return normalized;
}

function luminance(data: Uint8Array, offset: number) {
  return (
    0.2126 * data[offset]! +
    0.7152 * data[offset + 1]! +
    0.0722 * data[offset + 2]!
  );
}

function structuralSimilarity(left: Float64Array, right: Float64Array) {
  const count = left.length;
  let leftMean = 0;
  let rightMean = 0;
  for (let index = 0; index < count; index += 1) {
    leftMean += left[index]!;
    rightMean += right[index]!;
  }
  leftMean /= count;
  rightMean /= count;
  let leftVariance = 0;
  let rightVariance = 0;
  let covariance = 0;
  for (let index = 0; index < count; index += 1) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
    covariance += leftDelta * rightDelta;
  }
  leftVariance /= count;
  rightVariance /= count;
  covariance /= count;
  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  return (
    ((2 * leftMean * rightMean + c1) * (2 * covariance + c2)) /
    ((leftMean ** 2 + rightMean ** 2 + c1) *
      (leftVariance + rightVariance + c2))
  );
}

function digest(bytes: Uint8Array) {
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
