import type { CatalogModelView, ModelOperation } from './settings-view-model';

export type CurrentModelSelection = { mode: 'fixed'; catalogModelId: string };

interface SelectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
  removeItem(key: string): unknown;
}

const KEY_PREFIX = 'meiye:p1:model-selection:v1:';

export interface CreationModelSelection {
  model: CatalogModelView;
  source:
    | 'current_selection'
    | 'user_default'
    | 'workspace_default'
    | 'platform_default';
}

export function resolveCreationModelSelection(input: {
  catalog: CatalogModelView[];
  currentSelection?: string;
  platformDefault?: string;
  userDefault?: string;
  workspaceDefault?: string;
}): CreationModelSelection | undefined {
  const executable = (candidate: CatalogModelView) =>
    candidate.available && Boolean(candidate.unitPrice);
  const eligible = (modelId?: string) =>
    input.catalog.find(
      (candidate) => candidate.id === modelId && executable(candidate)
    );
  const current = eligible(input.currentSelection);
  if (current) return { model: current, source: 'current_selection' };
  const userDefault = eligible(input.userDefault);
  if (userDefault) return { model: userDefault, source: 'user_default' };
  const workspaceDefault = eligible(input.workspaceDefault);
  if (workspaceDefault) {
    return { model: workspaceDefault, source: 'workspace_default' };
  }
  const platformDefault = eligible(input.platformDefault);
  if (platformDefault) {
    return { model: platformDefault, source: 'platform_default' };
  }
  return undefined;
}

function browserSessionStorage(): SelectionStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.sessionStorage;
}

function key(operation: ModelOperation) {
  return `${KEY_PREFIX}${operation}`;
}

export function readCurrentModelSelection(
  operation: ModelOperation,
  storage: SelectionStorage | undefined = browserSessionStorage()
): CurrentModelSelection | undefined {
  const raw = storage?.getItem(key(operation));
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.mode === 'auto') {
      storage?.removeItem(key(operation));
      return undefined;
    }
    if (
      value.mode === 'fixed' &&
      typeof value.catalogModelId === 'string' &&
      value.catalogModelId.length > 0
    ) {
      return { mode: 'fixed', catalogModelId: value.catalogModelId };
    }
  } catch {
    storage?.removeItem(key(operation));
  }
  return undefined;
}

export function writeCurrentModelSelection(
  operation: ModelOperation,
  selection: CurrentModelSelection,
  storage: SelectionStorage | undefined = browserSessionStorage()
) {
  storage?.setItem(key(operation), JSON.stringify(selection));
}

export function clearCurrentModelSelection(
  operation: ModelOperation,
  storage: SelectionStorage | undefined = browserSessionStorage()
) {
  storage?.removeItem(key(operation));
}
