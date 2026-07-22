import {
  creation_entry_asset_intent,
  creation_entry_example_remix_intent,
  creation_entry_platform_douyin,
  creation_entry_platform_xiaohongshu,
  creation_entry_suggestion_asset_source,
  creation_entry_suggestion_common_source,
  creation_entry_suggestion_local_intent,
  creation_entry_suggestion_local_label,
  creation_entry_suggestion_project_intent,
  creation_entry_suggestion_project_label,
  creation_entry_suggestion_repeat_intent,
  creation_entry_suggestion_repeat_label,
  creation_entry_suggestion_task_source,
  creation_entry_task_intent,
  example_store_browsing_no_allowance,
} from '@/locale/paraglide/messages';
import type { Locale } from '@/lib/locale';
import {
  systemInlineAuthEvidence,
  type AssetAuthorizationDraft,
} from '@/product/asset-authorization-model';
import {
  isRestrictedProductAsset,
  type Asset,
  type Platform,
} from '@meiye/contracts';

export { systemInlineAuthEvidence } from '@/product/asset-authorization-model';

export type OpeningSuggestion = {
  id: string;
  intent: string;
  label: string;
  sourceLabel: string;
};

export const CREATION_DRAFT_INTENT_STORAGE_KEY =
  'meiye.creation-draft-intent.v1';

export function primaryCreationOperations() {
  return ['copy.generate', 'video.generate'] as const;
}

export function shouldLaunchAgentHarness(
  mode: 'agent' | 'direct',
  operation: string
) {
  return mode === 'agent' && operation === 'copy.generate';
}

export function readCreationDraftIntent(storage: Pick<Storage, 'getItem'>) {
  const value = storage.getItem(CREATION_DRAFT_INTENT_STORAGE_KEY)?.trim();
  return value && value.length >= 2 && value.length <= 4_000
    ? value
    : undefined;
}

export function writeCreationDraftIntent(
  storage: Pick<Storage, 'setItem'>,
  value: string
) {
  const intent = value.trim().slice(0, 4_000);
  if (intent.length < 2) return false;
  storage.setItem(CREATION_DRAFT_INTENT_STORAGE_KEY, intent);
  return true;
}

function commonSuggestions(): OpeningSuggestion[] {
  return [
    {
      id: 'common-local-discovery',
      intent: creation_entry_suggestion_local_intent(),
      label: creation_entry_suggestion_local_label(),
      sourceLabel: creation_entry_suggestion_common_source(),
    },
    {
      id: 'common-project-seeding',
      intent: creation_entry_suggestion_project_intent(),
      label: creation_entry_suggestion_project_label(),
      sourceLabel: creation_entry_suggestion_common_source(),
    },
    {
      id: 'common-repeat',
      intent: creation_entry_suggestion_repeat_intent(),
      label: creation_entry_suggestion_repeat_label(),
      sourceLabel: creation_entry_suggestion_common_source(),
    },
  ];
}

function shortLabel(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized;
}

export function openingSuggestions(input: {
  assets: Array<{ id: string; label: string }>;
  tasks: Array<{ id: string; title: string }>;
}): OpeningSuggestion[] {
  const candidates: OpeningSuggestion[] = [
    ...input.tasks.map((task) => ({
      id: `task:${task.id}`,
      intent: creation_entry_task_intent({ title: shortLabel(task.title) }),
      label: shortLabel(task.title),
      sourceLabel: creation_entry_suggestion_task_source(),
    })),
    ...input.assets.map((asset) => ({
      id: `asset:${asset.id}`,
      intent: creation_entry_asset_intent({
        label: shortLabel(asset.label),
      }),
      label: shortLabel(asset.label),
      sourceLabel: creation_entry_suggestion_asset_source(),
    })),
    ...commonSuggestions(),
  ];
  const seen = new Set<string>();
  return candidates
    .filter((item) => {
      const key = item.label.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

/** Historical scene id tokens retained for marketing secondary map typing only. */
export type SceneId =
  | 'lead-gen-nail'
  | 'seeding-nail'
  | 'promotion-nail'
  | 'retention-nail'
  | 'lead-gen-hair'
  | 'seeding-hair'
  | 'lead-gen-skin'
  | 'seeding-skin';

// Z1/#105: T6 scene chips + named-preset resolve path physically retired.
// Composer Recipe cards own cold-start entry.

export function exampleStoreBrowsingMessage(locale: Locale) {
  return example_store_browsing_no_allowance(undefined, { locale });
}

export function exampleStoreVisibility(input: {
  assetCount: number;
  contentCount: number;
  hidden: boolean;
  queriesReady: boolean;
  taskCount: number;
  workCount: number;
}): 'visible' | 'hidden' | 'unknown' {
  if (!input.queriesReady) return 'unknown';
  if (
    input.hidden ||
    input.assetCount > 0 ||
    input.contentCount > 0 ||
    input.taskCount > 0 ||
    input.workCount > 0
  ) {
    return 'hidden';
  }
  return 'visible';
}

export function exampleRemixIntent(example: {
  platform: 'xiaohongshu' | 'douyin';
  title: string;
}) {
  const platform =
    example.platform === 'xiaohongshu'
      ? creation_entry_platform_xiaohongshu()
      : creation_entry_platform_douyin();
  return creation_entry_example_remix_intent({
    platform,
    title: shortLabel(example.title),
  });
}

export function canCreateFromUploads(
  uploads: Array<{ status: 'uploading' | 'ready' | 'failed' }>
) {
  return uploads.every((upload) => upload.status === 'ready');
}

/** Cmd/Ctrl+Enter submits the composer without leaving the keyboard. */
export function isComposerSubmitShortcut(event: {
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
}) {
  return (event.metaKey || event.ctrlKey) && event.key === 'Enter';
}

export type AssetFactAnswers = {
  category: NonNullable<Asset['category']> | undefined;
  consentScope: 'internal_only' | 'public_marketing' | undefined;
  containsPerson: boolean | undefined;
  containsSensitiveData: boolean | undefined;
  minorStatus: 'none' | 'minor' | undefined;
  rightsEvidence: string;
  rightsNoFixedExpiry: boolean;
  rightsPlatforms: readonly Platform[];
  rightsValidUntil: string;
};

export type ConfirmedAssetFacts = {
  category: NonNullable<Asset['category']>;
  consentScope: 'internal_only' | 'public_marketing';
  containsPerson: boolean;
  containsSensitiveData: boolean;
  minorStatus: 'none' | 'minor';
  /** Rights subject from progressive rights (#149); falls back to store name. */
  rightsOwner?: string;
  rightsEvidence?: string;
  rightsNoFixedExpiry?: boolean;
  rightsPlatforms?: Platform[];
  rightsValidUntil?: string;
};

export function composerAssetAuthorizationDraft(input: {
  assetId: string;
  currentAsset?: Pick<Asset, 'rightsOwner' | 'tags'>;
  facts: ConfirmedAssetFacts;
  fallbackRightsOwner: string;
}): AssetAuthorizationDraft {
  return {
    assetId: input.assetId,
    category: input.facts.category,
    consentScope: input.facts.consentScope,
    containsPerson: input.facts.containsPerson,
    containsSensitiveData: input.facts.containsSensitiveData,
    minorStatus: input.facts.minorStatus,
    rightsEvidence: input.facts.rightsEvidence,
    rightsNoFixedExpiry: input.facts.rightsNoFixedExpiry,
    rightsOwner:
      input.facts.rightsOwner?.trim() ||
      input.currentAsset?.rightsOwner ||
      input.fallbackRightsOwner,
    rightsPlatforms: input.facts.rightsPlatforms,
    rightsValidUntil: input.facts.rightsValidUntil,
    systemEvidence: { context: 'composer', nonce: input.assetId },
    tags: input.currentAsset?.tags ?? [],
  };
}

/** Ordinary real-store defaults for the one-click public/internal path. */
export function ordinaryOneClickAnswers(input: {
  confirmsNoPeopleBeforeAfterCustomerCaseOrSensitiveData?: boolean;
  consentScope: 'internal_only' | 'public_marketing';
}): AssetFactAnswers | undefined {
  if (
    input.consentScope === 'public_marketing' &&
    input.confirmsNoPeopleBeforeAfterCustomerCaseOrSensitiveData !== true
  ) {
    return undefined;
  }
  return {
    category: 'store',
    consentScope: input.consentScope,
    containsPerson: false,
    containsSensitiveData: false,
    minorStatus: 'none',
    rightsEvidence: '',
    rightsNoFixedExpiry: false,
    rightsPlatforms: [],
    rightsValidUntil: '',
  };
}

export function confirmedAssetFacts(
  answers: AssetFactAnswers,
  options?: {
    evidenceContext?: 'asset-library' | 'composer';
    evidenceNonce?: string;
  }
): ConfirmedAssetFacts | undefined {
  if (
    answers.category === undefined ||
    answers.consentScope === undefined ||
    answers.containsPerson === undefined ||
    answers.containsSensitiveData === undefined ||
    answers.minorStatus === undefined
  ) {
    return undefined;
  }
  const base = {
    category: answers.category,
    consentScope: answers.consentScope,
    containsPerson: answers.containsPerson,
    containsSensitiveData: answers.containsSensitiveData,
    minorStatus: answers.minorStatus,
  };
  if (answers.consentScope === 'internal_only') return base;
  // Minors cannot be authorized for public marketing.
  if (answers.minorStatus === 'minor') return undefined;
  const restricted = isRestrictedProductAsset(base);
  if (
    restricted &&
    (answers.rightsPlatforms.length === 0 ||
      (!answers.rightsNoFixedExpiry && !answers.rightsValidUntil) ||
      (answers.rightsNoFixedExpiry && Boolean(answers.rightsValidUntil)))
  ) {
    return undefined;
  }
  // External archive ID is optional supplemental; inject system pointer when empty
  // so evidenceRecorded / non-empty rightsEvidence still holds for public use.
  const rightsEvidence = answers.rightsEvidence.trim()
    ? answers.rightsEvidence.trim()
    : options?.evidenceNonce
      ? systemInlineAuthEvidence({
          context: options.evidenceContext ?? 'composer',
          nonce: options.evidenceNonce,
        })
      : undefined;
  if (!rightsEvidence) return undefined;
  return {
    ...base,
    rightsEvidence,
    ...(restricted
      ? {
          rightsNoFixedExpiry: answers.rightsNoFixedExpiry,
          rightsPlatforms: [...answers.rightsPlatforms],
          rightsValidUntil: answers.rightsNoFixedExpiry
            ? undefined
            : new Date(
                `${answers.rightsValidUntil}T23:59:59.999Z`
              ).toISOString(),
        }
      : {}),
  };
}
