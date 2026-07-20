import {
  QUICK_EDIT_ACTIONS,
  QUICK_EDIT_EXPORT_USE_BY_ACTION,
  QUICK_EDIT_TARGET_BY_ACTION,
  quickEditIntentSchema,
  type ContentPackageVersion,
  type QuickEditAction,
  type QuickEditExportUse,
  type QuickEditIntent,
} from '@meiye/contracts';

export const CONTENT_PACKAGE_QUICK_EDIT_ACTIONS = QUICK_EDIT_ACTIONS;

/** One-click rewrite chips (natural_language is the textarea path, not a chip). */
export const CONTENT_PACKAGE_QUICK_EDIT_REWRITE_ACTIONS = [
  'identity_brand',
  'identity_person',
  'promotion_weaker',
  'promotion_stronger',
  'replace_assets',
  'platform_variant',
] as const satisfies readonly QuickEditAction[];

/** Export / material chips — secondary, collapsed by default in the UI. */
export const CONTENT_PACKAGE_QUICK_EDIT_EXPORT_ACTIONS = [
  'wechat_moments_export',
  'offline_material_export',
  'poster',
  'image_set',
  'spoken_script',
  'appointment_card',
] as const satisfies readonly QuickEditAction[];

type QuickEditField =
  | 'body'
  | 'conversionHook'
  | 'orderedAssetIds'
  | 'title'
  | 'topics';

type QuickEditChanges = Pick<
  ContentPackageVersion,
  'body' | 'conversionHook' | 'orderedAssetIds' | 'title' | 'topics'
>;

interface QuickEditContentPackage {
  generated: { assetIds: string[] };
  marketing?: {
    factRefs: string[];
    rightsRefs: string[];
  };
  source: { assetIds: string[] };
}

interface QuickEditActionConfig {
  allowedFields: readonly QuickEditField[];
  defaultInstruction: string;
  exportUse?: QuickEditExportUse;
  target: QuickEditIntent['target'];
}

export const CONTENT_PACKAGE_QUICK_EDIT_ACTION_CONFIG: Record<
  QuickEditAction,
  QuickEditActionConfig
> = {
  natural_language: {
    allowedFields: ['body', 'conversionHook', 'title', 'topics'],
    defaultInstruction: '按本次自然语言要求改稿',
    target: QUICK_EDIT_TARGET_BY_ACTION.natural_language,
  },
  identity_brand: {
    allowedFields: ['body'],
    defaultInstruction: '改成门店品牌口吻',
    target: QUICK_EDIT_TARGET_BY_ACTION.identity_brand,
  },
  identity_person: {
    allowedFields: ['body'],
    defaultInstruction: '改成主理人本人口吻',
    target: QUICK_EDIT_TARGET_BY_ACTION.identity_person,
  },
  promotion_weaker: {
    allowedFields: ['body', 'conversionHook'],
    defaultInstruction: '弱化促销感',
    target: QUICK_EDIT_TARGET_BY_ACTION.promotion_weaker,
  },
  promotion_stronger: {
    allowedFields: ['body', 'conversionHook'],
    defaultInstruction: '加强优惠和到店动作',
    target: QUICK_EDIT_TARGET_BY_ACTION.promotion_stronger,
  },
  replace_assets: {
    allowedFields: ['orderedAssetIds'],
    defaultInstruction: '换用本店另一组素材',
    target: QUICK_EDIT_TARGET_BY_ACTION.replace_assets,
  },
  platform_variant: {
    allowedFields: ['body', 'title', 'topics'],
    defaultInstruction: '转换为当前平台版本',
    target: QUICK_EDIT_TARGET_BY_ACTION.platform_variant,
  },
  wechat_moments_export: {
    allowedFields: ['body', 'conversionHook', 'title'],
    defaultInstruction: '导出朋友圈版',
    exportUse: QUICK_EDIT_EXPORT_USE_BY_ACTION.wechat_moments_export,
    target: QUICK_EDIT_TARGET_BY_ACTION.wechat_moments_export,
  },
  offline_material_export: {
    allowedFields: ['body', 'conversionHook', 'title'],
    defaultInstruction: '导出线下门店物料版',
    exportUse: QUICK_EDIT_EXPORT_USE_BY_ACTION.offline_material_export,
    target: QUICK_EDIT_TARGET_BY_ACTION.offline_material_export,
  },
  poster: {
    allowedFields: ['body', 'conversionHook', 'title'],
    defaultInstruction: '做成海报',
    exportUse: QUICK_EDIT_EXPORT_USE_BY_ACTION.poster,
    target: QUICK_EDIT_TARGET_BY_ACTION.poster,
  },
  image_set: {
    allowedFields: ['body', 'title', 'topics'],
    defaultInstruction: '做成项目套图',
    exportUse: QUICK_EDIT_EXPORT_USE_BY_ACTION.image_set,
    target: QUICK_EDIT_TARGET_BY_ACTION.image_set,
  },
  spoken_script: {
    allowedFields: ['body', 'conversionHook', 'title'],
    defaultInstruction: '做成口播稿',
    exportUse: QUICK_EDIT_EXPORT_USE_BY_ACTION.spoken_script,
    target: QUICK_EDIT_TARGET_BY_ACTION.spoken_script,
  },
  appointment_card: {
    allowedFields: ['body', 'conversionHook', 'title'],
    defaultInstruction: '做成预约引导卡',
    exportUse: QUICK_EDIT_EXPORT_USE_BY_ACTION.appointment_card,
    target: QUICK_EDIT_TARGET_BY_ACTION.appointment_card,
  },
};

export function buildContentPackageQuickEditIntent(input: {
  action: QuickEditAction;
  baseVersion: ContentPackageVersion;
  contentPackage: Pick<QuickEditContentPackage, 'marketing'>;
  instruction?: string;
}) {
  const config = CONTENT_PACKAGE_QUICK_EDIT_ACTION_CONFIG[input.action];
  return quickEditIntentSchema.parse({
    action: input.action,
    ...(config.exportUse ? { exportUse: config.exportUse } : {}),
    instruction: input.instruction?.trim() || config.defaultInstruction,
    target: config.target,
    scope: 'current_task',
    baseVersionId: input.baseVersion.id,
    preservedFactRefs: input.contentPackage.marketing?.factRefs ?? [],
    preservedRightsRefs: input.contentPackage.marketing?.rightsRefs ?? [],
  });
}

export function buildContentPackageQuickEdit(input: {
  action: QuickEditAction;
  baseVersion: ContentPackageVersion;
  contentPackage: QuickEditContentPackage;
  instruction?: string;
}) {
  return {
    changes: quickEditChanges(input),
    intent: buildContentPackageQuickEditIntent(input),
  };
}

function quickEditChanges(input: {
  action: QuickEditAction;
  baseVersion: ContentPackageVersion;
  contentPackage: QuickEditContentPackage;
  instruction?: string;
}): QuickEditChanges {
  const base = editableVersion(input.baseVersion);
  switch (input.action) {
    case 'natural_language':
      return {
        ...base,
        body: naturalLanguageEdit(
          base.body,
          input.instruction?.trim() ||
            CONTENT_PACKAGE_QUICK_EDIT_ACTION_CONFIG.natural_language
              .defaultInstruction
        ),
      };
    case 'identity_brand':
      return { ...base, body: withVoice(base.body, '门店品牌表达') };
    case 'identity_person':
      return { ...base, body: withVoice(base.body, '主理人表达') };
    case 'promotion_weaker': {
      const body = base.body
        .replace(/(?:限时|优惠|抢购|必买|冲|立即)/gu, '')
        .replace(/\s{2,}/gu, ' ')
        .trim();
      return {
        ...base,
        body: body === base.body ? `${body}\n先了解是否适合自己。` : body,
        conversionHook: '私信了解适合自己的方案',
      };
    }
    case 'promotion_stronger':
      return {
        ...base,
        body: `${base.body}\n当期到店名额开放，现在可预约咨询。`,
        conversionHook: '现在预约到店咨询',
      };
    case 'replace_assets':
      return {
        ...base,
        orderedAssetIds: replacementAssets(input.contentPackage, base),
      };
    case 'platform_variant':
      return {
        ...base,
        body: `平台版\n${base.body}`,
        title: `平台适配｜${base.title}`,
        topics: unique([...base.topics, '平台适配']),
      };
    case 'wechat_moments_export':
      return {
        ...base,
        body: `【朋友圈】${base.body.slice(0, 180)}`,
        conversionHook: '私信预约',
        title: `朋友圈｜${base.title}`,
      };
    case 'offline_material_export':
      return {
        ...base,
        body: `${base.title}\n${base.body}\n到店可咨询详情`,
        conversionHook: '到店咨询',
        title: `门店物料｜${base.title}`,
      };
    case 'poster':
      return {
        ...base,
        body: `${base.body.slice(0, 96)}\n${base.conversionHook ?? '私信咨询'}`,
        conversionHook: '扫码或私信咨询',
        title: base.title.slice(0, 18),
      };
    case 'image_set':
      return {
        ...base,
        body: `封面｜${base.title}\n项目介绍｜${base.body}\n行动引导｜${base.conversionHook ?? '私信咨询'}`,
        title: `项目套图｜${base.title}`,
        topics: unique([...base.topics, '项目套图']),
      };
    case 'spoken_script':
      return {
        ...base,
        body: `口播稿\n大家好，今天想和大家聊聊${base.title}。\n${base.body}\n${base.conversionHook ?? '欢迎私信咨询。'}`,
        conversionHook: '欢迎私信咨询',
        title: `口播｜${base.title}`,
      };
    case 'appointment_card':
      return {
        ...base,
        body: `${base.body}\n预约方式：扫码或私信留言`,
        conversionHook: '扫码或私信预约',
        title: `预约卡｜${base.title}`,
      };
  }
}

function editableVersion(version: ContentPackageVersion): QuickEditChanges {
  return {
    body: version.body,
    ...(version.conversionHook
      ? { conversionHook: version.conversionHook }
      : {}),
    orderedAssetIds: [...version.orderedAssetIds],
    title: version.title,
    topics: [...version.topics],
  };
}

function naturalLanguageEdit(body: string, instruction: string) {
  if (/(?:更短|简短|精简)/u.test(instruction)) {
    return body.slice(0, Math.max(1, Math.floor(body.length * 0.6)));
  }
  const replacement = /^(?:改成|改为)[:：]?\s*(.+)$/u.exec(instruction)?.[1];
  return replacement?.trim() || instruction;
}

function withVoice(body: string, voice: string) {
  const normalized = body.replace(/^(门店品牌表达|主理人表达)｜/u, '');
  return `${voice}｜${normalized}`;
}

function replacementAssets(
  contentPackage: QuickEditContentPackage,
  base: QuickEditChanges
) {
  const candidates = unique([
    ...contentPackage.source.assetIds,
    ...contentPackage.generated.assetIds,
  ]);
  if (JSON.stringify(candidates) !== JSON.stringify(base.orderedAssetIds)) {
    return candidates;
  }
  if (candidates.length > 1) return [...candidates.slice(1), candidates[0]!];
  return [];
}

function unique(values: string[]) {
  return [...new Set(values)];
}
