import type { Locale } from '@/lib/locale';

const WORKS_COPY = {
  en: {
    all: 'All',
    dashboard: 'Dashboard',
    description: 'Your copy, images, image-text posts, and videos live here.',
    emptyAction: 'Create content',
    emptyDescription:
      'Create something and the finished result will appear here automatically.',
    emptyTitle: 'No content yet',
    loading: 'Organizing your content…',
    searchLabel: 'Search content',
    searchPlaceholder: 'Search titles or copy',
    shapeFilter: 'Content type',
    title: 'Content',
    unavailable: 'Content is unavailable right now. Refresh and try again.',
    detail: {
      adopt: 'Adopt this version first',
      archive: 'Historical archive',
      back: 'Back to content',
      confirmUnavailable: 'Historical content cannot be confirmed',
      copy: 'Copy text',
      copied: 'Copied',
      download: 'Download text',
      downloadPackage: 'Download this delivery package',
      evidence: 'What this is based on',
      export: 'Export',
      exporting: 'Exporting…',
      exportFailed: 'Export failed. Try again later.',
      handoff: 'Assisted handoff',
      loading: 'Opening this content…',
      missingDescription:
        'It may still be generating or may have been replaced by a newer version.',
      missingTitle: 'Content not found',
      unavailableDescription: 'Refresh and open it again.',
      unavailableTitle: 'Content is temporarily unavailable',
      pendingConfirmation:
        'A confirmation is waiting. Complete it before exporting.',
      readonly: 'Read-only',
      readonlyDescription:
        'This historical video is view-only. It cannot be confirmed, edited, or exported.',
      use: 'How to use this content',
    },
    light: {
      copyAsNew: 'Save as a new copy',
      loading: 'Opening light editor…',
      missingDescription: 'It may have been replaced or deleted.',
      missingTitle: 'Content not found',
      revision: (revision: number, total: number) =>
        `Version ${revision} of ${total}`,
      title: 'Light edit',
      updateDescription:
        'Move this content to the latest layout, or save a new copy before editing.',
      updateTitle: 'A newer layout is available',
      upgrade: 'Use latest layout',
    },
    revision: (revision: number) => `Version ${revision}`,
    shapes: {
      copy: 'Copy',
      image: 'Image',
      note: 'Image and text',
      video: 'Video',
    },
  },
  zh: {
    all: '全部',
    dashboard: '工作台',
    description: '你做过的文案、图片、图文和视频都在这里。',
    emptyAction: '去创作',
    emptyDescription: '去创作一条内容，做出来的成品会自动进到这里。',
    emptyTitle: '还没有内容',
    loading: '正在整理你的内容…',
    searchLabel: '搜索内容',
    searchPlaceholder: '搜内容标题或正文',
    shapeFilter: '内容类型',
    title: '内容',
    unavailable: '内容暂时没能取回来，刷新一下再看。',
    detail: {
      adopt: '先采用这一版',
      archive: '历史档案',
      back: '回到内容列表',
      confirmUnavailable: '历史内容无法继续确认',
      copy: '复制文字',
      copied: '已复制',
      download: '下载文字',
      downloadPackage: '下载这一版的交付包',
      evidence: '创作依据',
      export: '导出使用',
      exporting: '正在导出…',
      exportFailed: '这次导出没成功，稍后再试一次。',
      handoff: '协办交接',
      loading: '正在打开这份内容…',
      missingDescription: '它可能还没生成完，或者已经被换成了新的一版。',
      missingTitle: '没找到这份内容',
      unavailableDescription: '刷新一下再打开。',
      unavailableTitle: '这份内容暂时没能取回来',
      pendingConfirmation: '有一笔待处理的确认，处理完成后再导出。',
      readonly: '只读',
      readonlyDescription: '这份历史成片仅供查看，不能继续确认、编辑或导出。',
      use: '怎么用这份内容',
    },
    light: {
      copyAsNew: '另存一份新的',
      loading: '正在打开轻编辑…',
      missingDescription: '它可能已经被替换或删除了。',
      missingTitle: '没找到这份内容',
      revision: (revision: number, total: number) =>
        `第 ${revision} 版 · 共 ${total} 版`,
      title: '轻编辑',
      updateDescription: '可以把这份内容换到新版式，也可以另存一份再改。',
      updateTitle: '这个版式有新版本',
      upgrade: '换到新版式',
    },
    revision: (revision: number) => `第 ${revision} 版`,
    shapes: {
      copy: '文案',
      image: '图片',
      note: '图文',
      video: '视频',
    },
  },
} as const;

export function worksCopy(locale: Locale) {
  return WORKS_COPY[locale];
}

const ENGLISH_WORKS_TEXT = new Map([
  ['创作中', 'Creating'],
  ['可使用', 'Ready to use'],
  ['需处理', 'Needs attention'],
  ['可继续编辑', 'Continue editing'],
  ['在轻编辑里做的图文内容', 'Image-text content made in light editor'],
  ['用了本店已确认的门店信息', 'Uses confirmed shop details'],
  ['内容基于本次确认的创作依据', 'Based on the confirmed creation brief'],
  ['按已选营销身份的口吻表达', 'Uses the selected marketing identity'],
  ['按门店官方中性口吻表达', 'Uses the store’s neutral official voice'],
  ['用了你上传的真实素材', 'Uses your uploaded material'],
  ['这一版含你自己的修改', 'Includes your edits'],
  ['已带 AI 生成标识', 'Includes an AI-generated label'],
  [
    '这份内容里的素材授权已撤回，先换掉素材再导出。',
    'Material rights were withdrawn. Replace the material before exporting.',
  ],
  [
    '这份内容还在流程里，完成后会出现在这里。',
    'This content is still in progress and will appear here when complete.',
  ],
  [
    '这份内容得先换掉不能用的素材，之后才能接着用。',
    'Replace unavailable material before continuing.',
  ],
  [
    '成品已就绪，先采用这一版，之后就能导出或协办交接。',
    'The result is ready. Adopt this version to export or hand it off.',
  ],
  [
    '成品已就绪，先采用这一版，之后就能导出。',
    'The result is ready. Adopt this version to export it.',
  ],
  [
    '这一版的文字已经能直接用，可以复制文字或协办交接。',
    'This copy is ready to use. Copy it or hand it off.',
  ],
  ['这一版的文字已经能直接用，可以复制文字。', 'This copy is ready to use.'],
  [
    '上次导出没成功，成品还在，重试导出即可。',
    'The last export failed, but the result is safe. Retry the export.',
  ],
  [
    '这一版已确认，可以直接导出或协办交接。',
    'This version is confirmed. Export it or hand it off.',
  ],
  [
    '这一版已确认，可以直接导出。',
    'This version is confirmed and ready to export.',
  ],
  [
    '复制正文就能贴到平台或发给顾客。',
    'Copy the text to a platform or send it to a customer.',
  ],
  [
    '图片可以导出使用，也可以进轻编辑改字改版式。',
    'Export the image or open light edit to change text and layout.',
  ],
  [
    '图片可以进轻编辑改字改版式。',
    'Open light edit to change text and layout.',
  ],
  [
    '图和文是一整份，导出时会一起带走。',
    'Images and text export together as one package.',
  ],
  ['成片可以导出使用。', 'Export the video.'],
  ['成片会作为一份完整内容交付。', 'The video is delivered as one result.'],
]);

export function translateWorksSystemText(locale: Locale, value: string) {
  if (locale === 'zh') return value;
  const direct = ENGLISH_WORKS_TEXT.get(value);
  if (direct) return direct;
  const platform = value.match(/^按(.+)的发布习惯适配$/u);
  return platform ? `Adapted to ${platform[1]} publishing conventions` : value;
}
