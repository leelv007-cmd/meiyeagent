import { m } from '@/locale/paraglide/messages';
import type { Locale } from '@/lib/locale';

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
      intent: m.creation_entry_suggestion_local_intent(),
      label: m.creation_entry_suggestion_local_label(),
      sourceLabel: m.creation_entry_suggestion_common_source(),
    },
    {
      id: 'common-project-seeding',
      intent: m.creation_entry_suggestion_project_intent(),
      label: m.creation_entry_suggestion_project_label(),
      sourceLabel: m.creation_entry_suggestion_common_source(),
    },
    {
      id: 'common-repeat',
      intent: m.creation_entry_suggestion_repeat_intent(),
      label: m.creation_entry_suggestion_repeat_label(),
      sourceLabel: m.creation_entry_suggestion_common_source(),
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
      intent: m.creation_entry_task_intent({ title: shortLabel(task.title) }),
      label: shortLabel(task.title),
      sourceLabel: m.creation_entry_suggestion_task_source(),
    })),
    ...input.assets.map((asset) => ({
      id: `asset:${asset.id}`,
      intent: m.creation_entry_asset_intent({
        label: shortLabel(asset.label),
      }),
      label: shortLabel(asset.label),
      sourceLabel: m.creation_entry_suggestion_asset_source(),
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

export type SceneId =
  | 'lead-gen-nail'
  | 'seeding-nail'
  | 'promotion-nail'
  | 'retention-nail'
  | 'lead-gen-hair'
  | 'seeding-hair'
  | 'lead-gen-skin'
  | 'seeding-skin';

export interface SceneChip {
  id: SceneId;
  imageUrl: string;
  label: string;
}

export function sceneChipGroups(locale: Locale) {
  return {
    expanded: [
      {
        id: 'lead-gen-hair',
        imageUrl: '/seed/scene/scene-lead-gen-hair.webp',
        label: m.creation_entry_scene_lead_gen_hair_chip(undefined, { locale }),
      },
      {
        id: 'seeding-hair',
        imageUrl: '/seed/scene/scene-seeding-hair.webp',
        label: m.creation_entry_scene_seeding_hair_chip(undefined, { locale }),
      },
      {
        id: 'lead-gen-skin',
        imageUrl: '/seed/scene/scene-lead-gen-skin.webp',
        label: m.creation_entry_scene_lead_gen_skin_chip(undefined, { locale }),
      },
      {
        id: 'seeding-skin',
        imageUrl: '/seed/scene/scene-seeding-skin.webp',
        label: m.creation_entry_scene_seeding_skin_chip(undefined, { locale }),
      },
    ] satisfies SceneChip[],
    primary: [
      {
        id: 'lead-gen-nail',
        imageUrl: '/seed/scene/scene-lead-gen-nail.webp',
        label: m.creation_entry_scene_lead_gen_nail_chip(undefined, { locale }),
      },
      {
        id: 'seeding-nail',
        imageUrl: '/seed/scene/scene-seeding-nail.webp',
        label: m.creation_entry_scene_seeding_nail_chip(undefined, { locale }),
      },
      {
        id: 'promotion-nail',
        imageUrl: '/seed/scene/scene-promo-nail.webp',
        label: m.creation_entry_scene_promotion_nail_chip(undefined, {
          locale,
        }),
      },
      {
        id: 'retention-nail',
        imageUrl: '/seed/scene/scene-retention-nail.webp',
        label: m.creation_entry_scene_retention_nail_chip(undefined, {
          locale,
        }),
      },
    ] satisfies SceneChip[],
  };
}

const SCENE_INTENTS: Record<SceneId, () => string> = {
  'lead-gen-hair': m.creation_entry_scene_lead_gen_hair_intent,
  'lead-gen-nail': m.creation_entry_scene_lead_gen_nail_intent,
  'lead-gen-skin': m.creation_entry_scene_lead_gen_skin_intent,
  'promotion-nail': m.creation_entry_scene_promotion_nail_intent,
  'retention-nail': m.creation_entry_scene_retention_nail_intent,
  'seeding-hair': m.creation_entry_scene_seeding_hair_intent,
  'seeding-nail': m.creation_entry_scene_seeding_nail_intent,
  'seeding-skin': m.creation_entry_scene_seeding_skin_intent,
};

export function sceneIntent(scene: SceneId) {
  return SCENE_INTENTS[scene]();
}

export function exampleStoreBrowsingMessage(locale: Locale) {
  return m.example_store_browsing_no_allowance(undefined, { locale });
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
      ? m.creation_entry_platform_xiaohongshu()
      : m.creation_entry_platform_douyin();
  return m.creation_entry_example_remix_intent({
    platform,
    title: shortLabel(example.title),
  });
}

export function canCreateFromUploads(
  uploads: Array<{ status: 'uploading' | 'ready' | 'failed' }>
) {
  return uploads.every((upload) => upload.status === 'ready');
}

export type AssetFactAnswers = {
  containsPerson: boolean | undefined;
  containsSensitiveData: boolean | undefined;
  minorStatus: 'none' | 'minor' | undefined;
};

export type ConfirmedAssetFacts = {
  containsPerson: boolean;
  containsSensitiveData: boolean;
  minorStatus: 'none' | 'minor';
};

export function confirmedAssetFacts(
  answers: AssetFactAnswers
): ConfirmedAssetFacts | undefined {
  return answers.containsPerson !== undefined &&
    answers.containsSensitiveData !== undefined &&
    answers.minorStatus !== undefined
    ? (answers as ConfirmedAssetFacts)
    : undefined;
}
