export type LegacyCanvasDisposition =
  | 'convertible'
  | 'read_only'
  | 'raster_fallback';

export interface LegacyCanvasRevisionInput {
  createdAt?: string;
  document: unknown;
  id: string;
}

export interface LegacyCanvasManagedRaster {
  contentType: 'image/jpeg' | 'image/png';
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  target:
    | { kind: 'work_revision'; revisionId: string; workId: string }
    | {
        kind: 'template_version';
        templateId: string;
        versionId: string;
      };
}

export interface LegacyCanvasInventoryInput {
  expectedInventory: {
    exportReceiptIds: string[];
    revisionIds: string[];
    templateIds: string[];
    templateVersionIds: string[];
    workIds: string[];
  };
  exportReceipts: Array<{ createdAt?: string; id: string; workId: string }>;
  managedRasters: LegacyCanvasManagedRaster[];
  templates: Array<{
    currentVersionId: string;
    id: string;
    versions: Array<{ document: unknown; id: string }>;
  }>;
  workspaceId: string;
  works: Array<{
    currentRevisionId: string;
    id: string;
    revisions: LegacyCanvasRevisionInput[];
  }>;
}

interface DocumentInspection {
  disposition: LegacyCanvasDisposition;
  elementKinds: Record<string, number>;
  pageCount: number;
  unknownFields: Record<string, number>;
}

const DOCUMENT_FIELDS = new Set(['height', 'pages', 'width']);
const PAGE_FIELDS = new Set(['elements', 'id']);
const TEXT_FIELDS = new Set([
  'fill',
  'fontFamily',
  'fontSize',
  'height',
  'id',
  'kind',
  'opacity',
  'rotation',
  'text',
  'width',
  'x',
  'y',
]);
const IMAGE_FIELDS = new Set([
  'assetId',
  'height',
  'id',
  'kind',
  'opacity',
  'rotation',
  'sourceJobId',
  'src',
  'width',
  'x',
  'y',
]);

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function increment(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

function collectUnknownFields(
  target: Record<string, number>,
  value: Record<string, unknown>,
  allowed: Set<string>,
  prefix: string
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) increment(target, `${prefix}.${key}`);
  }
}

function finite(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validElementGeometry(value: Record<string, unknown>) {
  return (
    typeof value.id === 'string' &&
    finite(value.x) &&
    finite(value.y) &&
    finite(value.width) &&
    finite(value.height) &&
    Number(value.width) > 0 &&
    Number(value.height) > 0 &&
    finite(value.rotation)
  );
}

function inspectDocument(value: unknown): DocumentInspection {
  const elementKinds: Record<string, number> = {};
  const unknownFields: Record<string, number> = {};
  const document = object(value);
  if (
    !document ||
    !finite(document.width) ||
    !finite(document.height) ||
    Number(document.width) <= 0 ||
    Number(document.height) <= 0 ||
    !Array.isArray(document.pages) ||
    document.pages.length === 0
  ) {
    return {
      disposition: 'raster_fallback',
      elementKinds,
      pageCount: 0,
      unknownFields,
    };
  }
  collectUnknownFields(unknownFields, document, DOCUMENT_FIELDS, 'document');
  let invalid = false;
  for (const pageValue of document.pages) {
    const page = object(pageValue);
    if (!page || typeof page.id !== 'string' || !Array.isArray(page.elements)) {
      invalid = true;
      continue;
    }
    collectUnknownFields(unknownFields, page, PAGE_FIELDS, 'page');
    for (const elementValue of page.elements) {
      const element = object(elementValue);
      const kind = typeof element?.kind === 'string' ? element.kind : 'unknown';
      increment(elementKinds, kind);
      if (!element || !validElementGeometry(element)) {
        invalid = true;
        continue;
      }
      if (kind === 'text') {
        if (typeof element.text !== 'string') invalid = true;
        collectUnknownFields(
          unknownFields,
          element,
          TEXT_FIELDS,
          'element.text'
        );
      } else if (kind === 'image') {
        if (typeof element.assetId !== 'string') invalid = true;
        collectUnknownFields(
          unknownFields,
          element,
          IMAGE_FIELDS,
          'element.image'
        );
      } else {
        invalid = true;
      }
    }
  }
  return {
    disposition: invalid
      ? 'raster_fallback'
      : Object.keys(unknownFields).length > 0
        ? 'read_only'
        : 'convertible',
    elementKinds,
    pageCount: document.pages.length,
    unknownFields,
  };
}

function mergeCounts(
  target: Record<string, number>,
  source: Record<string, number>
) {
  for (const [key, count] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + count;
  }
}

function worstDisposition(
  dispositions: LegacyCanvasDisposition[]
): LegacyCanvasDisposition {
  if (dispositions.includes('raster_fallback')) return 'raster_fallback';
  if (dispositions.includes('read_only')) return 'read_only';
  return 'convertible';
}

function assertExactInventory(
  expected: LegacyCanvasInventoryInput['expectedInventory'],
  actual: LegacyCanvasInventoryInput
) {
  if (!expected) {
    throw new Error(
      'Legacy Canvas snapshot does not match the authoritative inventory.'
    );
  }
  const pairs: Array<[string[], string[]]> = [
    [expected.exportReceiptIds, actual.exportReceipts.map((receipt) => receipt.id)],
    [expected.workIds, actual.works.map((work) => work.id)],
    [
      expected.revisionIds,
      actual.works.flatMap((work) =>
        work.revisions.map((revision) => revision.id)
      ),
    ],
    [expected.templateIds, actual.templates.map((template) => template.id)],
    [
      expected.templateVersionIds,
      actual.templates.flatMap((template) =>
        template.versions.map((version) => version.id)
      ),
    ],
  ];
  for (const [expectedIds, actualIds] of pairs) {
    if (
      !Array.isArray(expectedIds) ||
      expectedIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      new Set(expectedIds).size !== expectedIds.length ||
      new Set(actualIds).size !== actualIds.length ||
      JSON.stringify([...expectedIds].sort()) !==
        JSON.stringify([...actualIds].sort())
    ) {
      throw new Error(
        'Legacy Canvas snapshot does not match the authoritative inventory.'
      );
    }
  }
  if (
    typeof actual.workspaceId !== 'string' ||
    !actual.workspaceId.trim() ||
    actual.works.some(
      (work) =>
        !work.revisions.some(
          (revision) => revision.id === work.currentRevisionId
        )
    ) ||
    actual.templates.some(
      (template) =>
        !template.versions.some(
          (version) => version.id === template.currentVersionId
        )
    )
  ) {
    throw new Error(
      'Legacy Canvas snapshot does not match the authoritative inventory.'
    );
  }
  const workIds = new Set(actual.works.map((work) => work.id));
  const revisionIdsByWork = new Map(
    actual.works.map((work) => [
      work.id,
      new Set(work.revisions.map((revision) => revision.id)),
    ])
  );
  const templateVersionIdsByTemplate = new Map(
    actual.templates.map((template) => [
      template.id,
      new Set(template.versions.map((version) => version.id)),
    ])
  );
  if (
    actual.exportReceipts.some(
      (receipt) =>
        typeof receipt.id !== 'string' ||
        !receipt.id.trim() ||
        typeof receipt.workId !== 'string' ||
        !workIds.has(receipt.workId)
    ) ||
    actual.managedRasters.some((raster) => {
      if (raster.target.kind === 'work_revision') {
        return (
          !revisionIdsByWork.get(raster.target.workId)?.has(raster.target.revisionId)
        );
      }
      return (
        !templateVersionIdsByTemplate
          .get(raster.target.templateId)
          ?.has(raster.target.versionId)
      );
    })
  ) {
    throw new Error(
      'Legacy Canvas snapshot contains an orphaned historical reference.'
    );
  }
}

function managedRasterAvailable(
  input: LegacyCanvasInventoryInput,
  target: LegacyCanvasManagedRaster['target']
) {
  return input.managedRasters.some((raster) => {
    if (raster.target.kind !== target.kind) return false;
    if (target.kind === 'work_revision') {
      return (
        raster.target.kind === 'work_revision' &&
        raster.target.workId === target.workId &&
        raster.target.revisionId === target.revisionId
      );
    }
    return (
      raster.target.kind === 'template_version' &&
      raster.target.templateId === target.templateId &&
      raster.target.versionId === target.versionId
    );
  });
}

export function inventoryLegacyCanvasData(input: LegacyCanvasInventoryInput) {
  assertExactInventory(input.expectedInventory, input);
  const elementKinds: Record<string, number> = {};
  const unknownFields: Record<string, number> = {};
  let pages = 0;
  const works = input.works.map((work) => {
    const inspections = work.revisions.map((revision) => ({
      inspection: inspectDocument(revision.document),
      revision,
    }));
    const revisions = inspections.map(({ inspection, revision }) => {
      return {
        disposition: inspection.disposition,
        id: revision.id,
        managedRasterAvailable: managedRasterAvailable(input, {
          kind: 'work_revision',
          revisionId: revision.id,
          workId: work.id,
        }),
        ...(revision.createdAt ? { createdAt: revision.createdAt } : {}),
      };
    });
    for (const { inspection } of inspections) {
      pages += inspection.pageCount;
      mergeCounts(elementKinds, inspection.elementKinds);
      mergeCounts(unknownFields, inspection.unknownFields);
    }
    const editedAt = work.revisions
      .map((revision) => revision.createdAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    const exportedAt = input.exportReceipts
      .filter((receipt) => receipt.workId === work.id)
      .map((receipt) => receipt.createdAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    return {
      disposition: worstDisposition(
        inspections.map(({ inspection }) => inspection.disposition)
      ),
      exportRecordCount: input.exportReceipts.filter(
        (receipt) => receipt.workId === work.id
      ).length,
      id: work.id,
      ...(editedAt ? { lastEditedAt: editedAt } : {}),
      ...(exportedAt ? { lastExportedAt: exportedAt } : {}),
      currentRevisionId: work.currentRevisionId,
      revisionCount: work.revisions.length,
      revisions,
    };
  });
  let templateVersions = 0;
  const templates = input.templates.map((template) => {
    const inspections = template.versions.map((version) => ({
      inspection: inspectDocument(version.document),
      version,
    }));
    const versions = inspections.map(({ inspection, version }) => {
      return {
        disposition: inspection.disposition,
        id: version.id,
        managedRasterAvailable: managedRasterAvailable(input, {
          kind: 'template_version',
          templateId: template.id,
          versionId: version.id,
        }),
      };
    });
    templateVersions += template.versions.length;
    for (const { inspection } of inspections) {
      pages += inspection.pageCount;
      mergeCounts(elementKinds, inspection.elementKinds);
      mergeCounts(unknownFields, inspection.unknownFields);
    }
    return {
      currentVersionId: template.currentVersionId,
      disposition: worstDisposition(
        inspections.map(({ inspection }) => inspection.disposition)
      ),
      id: template.id,
      versionCount: template.versions.length,
      versions,
    };
  });
  const revisions = input.works.reduce(
    (total, work) => total + work.revisions.length,
    0
  );
  return {
    coverage: {
      revisionPercent: 100,
      templatePercent: 100,
      templateVersionPercent: 100,
      workPercent: 100,
    },
    elementKinds,
    generatedAt: new Date().toISOString(),
    totals: {
      exportRecords: input.exportReceipts.length,
      pages,
      revisions,
      templateVersions,
      templates: input.templates.length,
      works: input.works.length,
    },
    templates,
    unknownFields,
    works,
  };
}
