import type { CreativeSourceReference } from '@meiye/contracts';
import {
  global_command_business_page,
  global_command_open,
} from '@/locale/paraglide/messages';
import { BUSINESS_NAVIGATION } from '@/lib/uiux/navigation';
import type { ModelOperation } from '@/p1/settings-view-model';
import {
  canonicalHistoryItems,
  type RawCanonicalHistory,
} from './canonical-history-model';
import type { CreationCatalogEntry } from './creation-catalog-model';

export interface GlobalNavigationEntry {
  actionLabel: string;
  detail: string;
  href: string;
  id: string;
  kind: 'page' | 'task' | 'session' | 'job';
  label: string;
}

export interface PendingCreationAction {
  detail: string;
  id: string;
  key: string;
  kind: CreationCatalogEntry['kind'];
  label: string;
  operation?: ModelOperation;
  reference?: CreativeSourceReference;
  version: 1;
}

export const PENDING_CREATION_ACTION_STORAGE_KEY =
  'meiye.pending-creation-action.v1';

export function isGlobalCommandShortcut(event: {
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  repeat: boolean;
}) {
  return (
    !event.repeat &&
    (event.metaKey || event.ctrlKey) &&
    event.key.toLocaleLowerCase('en-US') === 'k'
  );
}

export function projectGlobalNavigation(
  history?: RawCanonicalHistory
): GlobalNavigationEntry[] {
  const pages = BUSINESS_NAVIGATION.map(
    (entry): GlobalNavigationEntry => ({
      actionLabel: global_command_open(),
      detail: global_command_business_page(),
      href: entry.href,
      id: entry.id,
      kind: 'page',
      label: entry.label,
    })
  );
  const canonical = history
    ? canonicalHistoryItems(history)
        .filter(
          (
            item
          ): item is typeof item & {
            kind: 'task' | 'session' | 'job';
          } =>
            item.kind === 'task' ||
            item.kind === 'session' ||
            item.kind === 'job'
        )
        .slice(0, 18)
        .map(
          (item): GlobalNavigationEntry => ({
            actionLabel: global_command_open(),
            detail: item.detail,
            href: item.href,
            id: item.id,
            kind: item.kind,
            label: item.title,
          })
        )
    : [];
  return [...pages, ...canonical];
}

export function createPendingCreationAction(
  entry: CreationCatalogEntry
): PendingCreationAction {
  return {
    detail: entry.detail,
    id: entry.id,
    key: entry.key,
    kind: entry.kind,
    label: entry.label,
    ...(entry.operation ? { operation: entry.operation } : {}),
    ...(entry.reference ? { reference: entry.reference } : {}),
    version: 1,
  };
}

const operations = new Set<ModelOperation>([
  'copy.generate',
  'image.generate',
  'image.edit',
  'video.generate',
]);
const referenceKinds = new Set<CreativeSourceReference['kind']>([
  'asset',
  'template',
  'work',
]);
const allowedKeys = new Set([
  'detail',
  'id',
  'key',
  'kind',
  'label',
  'operation',
  'reference',
  'version',
]);

export function parsePendingCreationAction(
  serialized: string | null
): PendingCreationAction | undefined {
  if (!serialized) return undefined;
  try {
    const value = JSON.parse(serialized) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
      return undefined;
    }
    if (
      input.version !== 1 ||
      typeof input.id !== 'string' ||
      typeof input.key !== 'string' ||
      typeof input.kind !== 'string' ||
      !['template', 'tool', 'reference'].includes(input.kind) ||
      typeof input.label !== 'string' ||
      typeof input.detail !== 'string'
    ) {
      return undefined;
    }
    const operation = input.operation;
    if (operation !== undefined) {
      if (
        typeof operation !== 'string' ||
        !operations.has(operation as ModelOperation)
      ) {
        return undefined;
      }
    }
    const reference = input.reference;
    if (reference !== undefined) {
      if (
        !reference ||
        typeof reference !== 'object' ||
        Array.isArray(reference) ||
        typeof (reference as Record<string, unknown>).id !== 'string' ||
        typeof (reference as Record<string, unknown>).kind !== 'string' ||
        !referenceKinds.has(
          (reference as Record<string, unknown>)
            .kind as CreativeSourceReference['kind']
        ) ||
        (reference as Record<string, unknown>).id !== input.id
      ) {
        return undefined;
      }
    }
    if (
      (input.kind === 'tool' && operation === undefined) ||
      (input.kind === 'tool' && reference !== undefined) ||
      (input.kind !== 'tool' && operation !== undefined) ||
      (input.kind !== 'tool' && reference === undefined)
    ) {
      return undefined;
    }
    const referenceKind =
      reference && typeof reference === 'object'
        ? (reference as CreativeSourceReference).kind
        : undefined;
    if (
      (input.kind === 'template' && referenceKind !== 'template') ||
      (input.kind === 'reference' &&
        referenceKind !== 'asset' &&
        referenceKind !== 'work')
    ) {
      return undefined;
    }
    const expectedKey =
      input.kind === 'reference'
        ? `${referenceKind}:${input.id}`
        : `${input.kind}:${input.id}`;
    if (input.key !== expectedKey) return undefined;
    return value as PendingCreationAction;
  } catch {
    return undefined;
  }
}
