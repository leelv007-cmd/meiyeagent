import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  inventoryLegacyCanvasData,
  type LegacyCanvasDisposition,
  type LegacyCanvasInventoryInput,
  type LegacyCanvasManagedRaster,
} from './polotno-retirement-inventory.js';

export type LegacyCanvasHistoryTarget =
  | { id: string; kind: 'work' }
  | { id: string; kind: 'revision'; workId: string }
  | { id: string; kind: 'template' }
  | { id: string; kind: 'template_version'; templateId: string };

export interface LegacyCanvasManagedStorage {
  read(workspaceId: string, objectKey: string): Promise<Uint8Array | null>;
}

export class FileSystemLegacyCanvasManagedStorage
  implements LegacyCanvasManagedStorage
{
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async read(workspaceId: string, objectKey: string) {
    assertManagedObjectKey(workspaceId, objectKey);
    const path = resolve(this.root, objectKey);
    const relativePath = relative(this.root, path);
    if (
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error('Historical Canvas artifact escaped the managed root.');
    }
    try {
      return new Uint8Array(await readFile(path));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw cause;
    }
  }
}

interface ResolvedTarget {
  disposition: LegacyCanvasDisposition;
  document: unknown;
  rasterTarget: LegacyCanvasManagedRaster['target'];
}

export class LegacyCanvasHistoryAccess {
  readonly inventory;
  private readonly input: LegacyCanvasInventoryInput;

  constructor(
    input: LegacyCanvasInventoryInput,
    private readonly storage: LegacyCanvasManagedStorage
  ) {
    this.input = structuredClone(input);
    this.inventory = inventoryLegacyCanvasData(this.input);
  }

  async open(
    context: { workspaceId: string },
    target: LegacyCanvasHistoryTarget
  ) {
    this.requireWorkspace(context.workspaceId);
    const resolved = this.resolve(target);
    if (resolved.disposition === 'raster_fallback') {
      const raster = await this.readRaster(resolved.rasterTarget);
      return {
        bytes: raster.bytes,
        contentType: raster.contentType,
        disposition: resolved.disposition,
        editable: false as const,
        mode: 'managed_raster' as const,
        target: structuredClone(target),
      };
    }
    return {
      disposition: resolved.disposition,
      document: structuredClone(resolved.document),
      editable: resolved.disposition === 'convertible',
      mode:
        resolved.disposition === 'convertible'
          ? ('light_composer' as const)
          : ('read_only_document' as const),
      target: structuredClone(target),
    };
  }

  async export(
    context: { workspaceId: string },
    target: LegacyCanvasHistoryTarget
  ) {
    this.requireWorkspace(context.workspaceId);
    const resolved = this.resolve(target);
    const raster = await this.readRaster(resolved.rasterTarget);
    return {
      ...raster,
      disposition: resolved.disposition,
      source: 'existing_managed_raster' as const,
      target: structuredClone(target),
    };
  }

  private requireWorkspace(workspaceId: string) {
    if (workspaceId !== this.input.workspaceId) {
      throw new Error('Historical Canvas target belongs to another workspace.');
    }
  }

  private resolve(target: LegacyCanvasHistoryTarget): ResolvedTarget {
    if (target.kind === 'work' || target.kind === 'revision') {
      const work = this.input.works.find((item) =>
        target.kind === 'work'
          ? item.id === target.id
          : item.id === target.workId
      );
      if (!work) throw new Error('Historical Canvas target was not found.');
      const revisionId =
        target.kind === 'revision' ? target.id : work.currentRevisionId;
      const revision = work.revisions.find((item) => item.id === revisionId);
      const report = this.inventory.works.find((item) => item.id === work.id);
      const revisionReport = report?.revisions.find(
        (item) => item.id === revisionId
      );
      if (!revision || !report || !revisionReport) {
        throw new Error('Historical Canvas target was not found.');
      }
      return {
        disposition: revisionReport.disposition,
        document: revision.document,
        rasterTarget: {
          kind: 'work_revision',
          revisionId,
          workId: work.id,
        },
      };
    }

    const template = this.input.templates.find((item) =>
      target.kind === 'template'
        ? item.id === target.id
        : item.id === target.templateId
    );
    if (!template) throw new Error('Historical Canvas target was not found.');
    const versionId =
      target.kind === 'template_version' ? target.id : template.currentVersionId;
    const version = template.versions.find((item) => item.id === versionId);
    const report = this.inventory.templates.find(
      (item) => item.id === template.id
    );
    const versionReport = report?.versions.find(
      (item) => item.id === versionId
    );
    if (!version || !report || !versionReport) {
      throw new Error('Historical Canvas target was not found.');
    }
    return {
      disposition: versionReport.disposition,
      document: version.document,
      rasterTarget: {
        kind: 'template_version',
        templateId: template.id,
        versionId,
      },
    };
  }

  private async readRaster(target: LegacyCanvasManagedRaster['target']) {
    const matches = this.input.managedRasters.filter((raster) =>
      sameRasterTarget(raster.target, target)
    );
    if (matches.length === 0) {
      throw new Error('Historical Canvas target has no existing managed raster.');
    }
    if (matches.length !== 1) {
      throw new Error('Historical Canvas target has ambiguous managed rasters.');
    }
    const raster = matches[0]!;
    assertManagedObjectKey(this.input.workspaceId, raster.objectKey);
    const bytes = await this.storage.read(
      this.input.workspaceId,
      raster.objectKey
    );
    if (!bytes) {
      throw new Error('Historical Canvas managed raster was not found.');
    }
    if (
      bytes.byteLength !== raster.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== raster.sha256 ||
      !matchesRasterType(raster.contentType, bytes)
    ) {
      throw new Error('Historical Canvas managed raster failed integrity checks.');
    }
    return {
      bytes,
      contentType: raster.contentType,
      objectKey: raster.objectKey,
      sha256: raster.sha256,
      sizeBytes: raster.sizeBytes,
    };
  }
}

export async function auditLegacyCanvasAccess(
  input: LegacyCanvasInventoryInput,
  storage: LegacyCanvasManagedStorage
) {
  const access = new LegacyCanvasHistoryAccess(input, storage);
  const targets: LegacyCanvasHistoryTarget[] = [
    ...input.works.flatMap((work) => [
      { id: work.id, kind: 'work' as const },
      ...work.revisions.map((revision) => ({
        id: revision.id,
        kind: 'revision' as const,
        workId: work.id,
      })),
    ]),
    ...input.templates.flatMap((template) => [
      { id: template.id, kind: 'template' as const },
      ...template.versions.map((version) => ({
        id: version.id,
        kind: 'template_version' as const,
        templateId: template.id,
      })),
    ]),
  ];
  const results = [];
  for (const target of targets) {
    let opened = false;
    let exported = false;
    let error: string | undefined;
    try {
      await access.open({ workspaceId: input.workspaceId }, target);
      opened = true;
    } catch (cause) {
      error = errorMessage(cause);
    }
    try {
      await access.export({ workspaceId: input.workspaceId }, target);
      exported = true;
    } catch (cause) {
      error ??= errorMessage(cause);
    }
    results.push({
      ...(error ? { error } : {}),
      ...(exported
        ? { exportSource: 'existing_managed_raster' as const }
        : {}),
      exported,
      opened,
      target,
    });
  }
  return {
    exportStrategy: 'existing_managed_raster_only' as const,
    inventory: access.inventory,
    passed: results.every((result) => result.opened && result.exported),
    targets: results,
    workspaceId: input.workspaceId,
  };
}

function sameRasterTarget(
  left: LegacyCanvasManagedRaster['target'],
  right: LegacyCanvasManagedRaster['target']
) {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'work_revision' && right.kind === 'work_revision') {
    return (
      left.workId === right.workId && left.revisionId === right.revisionId
    );
  }
  return (
    left.kind === 'template_version' &&
    right.kind === 'template_version' &&
    left.templateId === right.templateId &&
    left.versionId === right.versionId
  );
}

function assertManagedObjectKey(workspaceId: string, objectKey: string) {
  const segments = objectKey.split('/');
  if (
    !objectKey.startsWith(`${workspaceId}/`) ||
    objectKey.includes('://') ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Historical Canvas managed raster object key is unsafe.');
  }
}

function matchesRasterType(
  contentType: LegacyCanvasManagedRaster['contentType'],
  bytes: Uint8Array
) {
  if (contentType === 'image/png') {
    const magic = [137, 80, 78, 71, 13, 10, 26, 10];
    return magic.every((value, index) => bytes[index] === value);
  }
  return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}

function errorMessage(cause: unknown) {
  return cause instanceof Error
    ? cause.message
    : 'Historical Canvas access failed.';
}
