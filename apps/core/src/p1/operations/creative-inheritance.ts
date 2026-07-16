import type {
  CanvasDocument,
  CreativeAssetProjection,
  CreativeContentModuleId,
  CreativeExecutionContract,
  CreativeInheritanceContext,
  CreativeInheritanceFact,
  CreativeInheritanceFieldId,
  CreativeJob,
  CreativeSourceReference,
  CreativeWork,
  OperationsWorkspaceState,
} from './types.js';

export interface ResolvedTemplateInheritanceSource {
  contentModules?: CreativeContentModuleId[];
  document: CanvasDocument;
}

export type CreativeInheritanceResolution =
  | { context: CreativeInheritanceContext; ok: true }
  | {
      kind: CreativeSourceReference['kind'];
      ok: false;
      reason: 'source_not_found' | 'unsupported_source_kind';
    };

function latestJob(
  state: OperationsWorkspaceState,
  work: CreativeWork
): CreativeJob | undefined {
  const current = work.currentJobId
    ? state.creativeJobs.find((job) => job.id === work.currentJobId)
    : undefined;
  if (current) return current;
  return state.creativeJobs
    .filter((job) => job.workId === work.id)
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id)
    )[0];
}

function safeColor(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized &&
    /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(normalized)
    ? normalized
    : undefined;
}

function safeFontFamily(value: string | undefined) {
  const normalized = value?.trim();
  return normalized &&
    normalized.length <= 40 &&
    /^[\p{L}\p{N} ._-]+$/u.test(normalized)
    ? normalized
    : undefined;
}

function outputFact(
  contract: CreativeExecutionContract | undefined,
  assetKind?: CreativeAssetProjection['kind']
): Extract<CreativeInheritanceFact, { field: 'output_specification' }> {
  return {
    field: 'output_specification',
    ...(contract?.aspectRatio ? { aspectRatio: contract.aspectRatio } : {}),
    ...(assetKind ? { assetKind } : {}),
    ...(contract?.durationSeconds
      ? { durationSeconds: contract.durationSeconds }
      : {}),
    ...(contract ? { operation: contract.operation } : {}),
    ...(contract ? { outputCount: contract.outputCount } : {}),
  };
}

function canvasFacts(
  source: ResolvedTemplateInheritanceSource,
  fields: CreativeInheritanceFieldId[]
): CreativeInheritanceFact[] {
  const elements = source.document.pages.flatMap((page) => page.elements);
  const textElements = elements.filter((element) => element.kind === 'text');
  const mediaSlotCount = elements.length - textElements.length;
  const colors = [
    ...new Set(
      textElements
        .map((element) => safeColor(element.fill))
        .filter((value): value is string => Boolean(value))
    ),
  ].slice(0, 8);
  const fontFamilies = [
    ...new Set(
      textElements
        .map((element) => safeFontFamily(element.fontFamily))
        .filter((value): value is string => Boolean(value))
    ),
  ].slice(0, 8);
  const emphasisLevelCount = new Set(
    textElements
      .map((element) => element.fontSize)
      .filter((value): value is number => Number.isFinite(value))
  ).size;

  return fields.map((field): CreativeInheritanceFact => {
    switch (field) {
      case 'content_structure':
        return {
          field,
          ...(source.contentModules?.length
            ? { contentModules: [...source.contentModules] }
            : {}),
          pageCount: source.document.pages.length,
        };
      case 'layout_slots':
        return {
          field,
          mediaSlotCount,
          pageCount: source.document.pages.length,
          textSlotCount: textElements.length,
        };
      case 'copy_skeleton':
        return {
          field,
          emphasisLevelCount,
          textSlotCount: textElements.length,
        };
      case 'output_specification':
        return {
          field,
          height: source.document.height,
          pageCount: source.document.pages.length,
          width: source.document.width,
        };
      case 'visual_style':
        return { colors, field, fontFamilies };
      default:
        throw new Error('Unsupported creative inheritance field.');
    }
  });
}

function workFacts(
  state: OperationsWorkspaceState,
  work: CreativeWork,
  fields: CreativeInheritanceFieldId[],
  templateSources: ReadonlyMap<string, ResolvedTemplateInheritanceSource>
): CreativeInheritanceFact[] {
  const contentModules = work.contentModules?.length
    ? work.contentModules
    : (['social_cover'] satisfies CreativeContentModuleId[]);
  const job = latestJob(state, work);
  const textAssets = state.creativeAssets.filter(
    (asset) => asset.workId === work.id && asset.kind === 'text'
  );
  const visualSource = work.sourceReferences
    .filter((reference) => reference.kind === 'template')
    .map((reference) => templateSources.get(reference.id))
    .find((source): source is ResolvedTemplateInheritanceSource =>
      Boolean(source)
    );
  const visualFact = visualSource
    ? canvasFacts(visualSource, ['visual_style'])[0]
    : undefined;

  return fields.map((field): CreativeInheritanceFact => {
    switch (field) {
      case 'content_structure':
        return { contentModules: [...contentModules], field };
      case 'layout_slots':
        return { field, moduleSlotCount: contentModules.length };
      case 'copy_skeleton':
        return {
          contentModuleOrder: [...contentModules],
          field,
          hasConversionHook: textAssets.some((asset) =>
            Boolean(asset.conversionHook)
          ),
          textSlotCount: textAssets.length,
        };
      case 'output_specification':
        return outputFact(job?.contract);
      case 'visual_style':
        return visualFact?.field === 'visual_style'
          ? visualFact
          : { colors: [], field, fontFamilies: [] };
      default:
        throw new Error('Unsupported creative inheritance field.');
    }
  });
}

function assetFacts(
  state: OperationsWorkspaceState,
  asset: CreativeAssetProjection,
  fields: CreativeInheritanceFieldId[]
): CreativeInheritanceFact[] {
  const sourceJob = state.creativeJobs.find((job) => job.id === asset.jobId);
  const textSlotCount =
    asset.kind === 'text'
      ? 1 + Number(Boolean(asset.body)) + Number(Boolean(asset.conversionHook))
      : 0;

  return fields.map((field): CreativeInheritanceFact => {
    switch (field) {
      case 'content_structure':
        return { assetKind: asset.kind, field, pageCount: 1 };
      case 'layout_slots':
        return {
          field,
          mediaSlotCount: asset.kind === 'text' ? 0 : 1,
          pageCount: 1,
          textSlotCount,
        };
      case 'copy_skeleton':
        return {
          field,
          hasConversionHook: Boolean(asset.conversionHook),
          textSlotCount,
        };
      case 'output_specification':
        return outputFact(sourceJob?.contract, asset.kind);
      case 'visual_style':
        return { colors: [], field, fontFamilies: [] };
      default:
        throw new Error('Unsupported creative inheritance field.');
    }
  });
}

export function resolveCreativeInheritanceContext(input: {
  state: OperationsWorkspaceState;
  templateSources: ReadonlyMap<string, ResolvedTemplateInheritanceSource>;
  work: CreativeWork;
}): CreativeInheritanceResolution {
  const sources: CreativeInheritanceContext['sources'] = [];
  for (const reference of input.work.sourceReferences) {
    const fields = reference.inheritanceFields;
    if (!fields?.length) continue;
    if (reference.kind === 'template') {
      const source = input.templateSources.get(reference.id);
      if (!source) {
        return { kind: reference.kind, ok: false, reason: 'source_not_found' };
      }
      sources.push({
        facts: canvasFacts(source, fields),
        kind: reference.kind,
      });
      continue;
    }
    if (reference.kind === 'work') {
      const source = input.state.creativeWorks.find(
        (work) => work.id === reference.id
      );
      if (!source) {
        return { kind: reference.kind, ok: false, reason: 'source_not_found' };
      }
      sources.push({
        facts: workFacts(input.state, source, fields, input.templateSources),
        kind: reference.kind,
      });
      continue;
    }
    if (reference.kind === 'asset') {
      const source = input.state.creativeAssets.find(
        (asset) => asset.id === reference.id
      );
      if (!source) {
        return { kind: reference.kind, ok: false, reason: 'source_not_found' };
      }
      sources.push({
        facts: assetFacts(input.state, source, fields),
        kind: reference.kind,
      });
      continue;
    }
    return {
      kind: reference.kind,
      ok: false,
      reason: 'unsupported_source_kind',
    };
  }
  return { context: { sources }, ok: true };
}
