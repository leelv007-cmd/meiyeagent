import { createHash } from 'node:crypto';
import {
  MODEL_CAPABILITY_VOCABULARY_VERSION,
  type ModelCapabilityRequirementAxis,
} from '@meiye/contracts';
import type {
  LanguageModelOperation,
  ModelSupplyPromptResolver,
} from '../model-supply/index.js';

const STRUCTURED_TEXT_REQUIREMENT = {
  requiredProtocolCapabilities: ['structured-output'],
  requiredModalities: ['text/plain'],
} as const;

const PLAIN_TEXT_REQUIREMENT = {
  requiredProtocolCapabilities: [],
  requiredModalities: ['text/plain'],
} as const;

/**
 * The single registry for Harness prompt supply and request-time capability
 * matching. Prompt names and requirement axes must be derived from this table.
 *
 * Extension model (issue #315 / XHS §6.1 · §10.3-5):
 * - Keep ONE flat registry (no second resolver table).
 * - Core pipeline retains the historical 14 D-149 sites.
 * - XHS vertical assets append as `xhs*` keys with Langfuse names
 *   `harness/xhs-*` (beauty-rewritten builtins; version pin + fallback).
 * - Site count is therefore 20 = 14 core + 6 XHS vertical.
 * - New vertical keys do not invent a parallel pin policy: strict still
 *   requires every key; pilot still falls back to builtin-v1.
 */
export const HARNESS_PROMPT_SITES = {
  intentNaming: {
    name: 'harness/intent-naming',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  briefCompilation: {
    name: 'harness/brief-copy',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  briefImage: {
    name: 'harness/brief-image',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  briefVideo: {
    name: 'harness/brief-video',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  factSatisfaction: {
    name: 'harness/fact-satisfaction',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  factCriticality: {
    name: 'harness/fact-criticality',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  copyCandidate: {
    name: 'harness/copy-candidate',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  notePlan: {
    name: 'harness/note-plan',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  noteTextBlock: {
    name: 'harness/note-text-block',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  noteConsistency: {
    name: 'harness/note-consistency',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  destinationMapping: {
    name: 'harness/destination-mapping',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  copyGeneration: {
    name: 'harness/copy-generation',
    operation: 'copy.generate',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  platformAdaptation: {
    name: 'harness/platform-adaptation',
    operation: 'copy.adapt',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  textResponse: {
    name: 'harness/text-response',
    operation: 'text.respond',
    requirement: PLAIN_TEXT_REQUIREMENT,
  },
  // --- XHS vertical (beauty-rewritten asset transplant; issue #315) ---
  xhsOutline: {
    name: 'harness/xhs-outline',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  xhsContent: {
    name: 'harness/xhs-content',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  xhsNoteGen: {
    name: 'harness/xhs-note-gen',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  xhsImagePrompt: {
    name: 'harness/xhs-image-prompt',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  xhsCoverPrompt: {
    name: 'harness/xhs-cover-prompt',
    operation: 'text.respond',
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
  xhsStyleAnalysis: {
    name: 'harness/xhs-style-analysis',
    operation: 'text.respond',
    // Base pin stays text/plain so copy-lens admission does not force vision.
    // Callers that pass reference images add image/* via
    // harnessPromptCapabilityRequirement(key, { referenceImage: true }).
    requirement: STRUCTURED_TEXT_REQUIREMENT,
  },
} as const;

export type HarnessPromptKey = keyof typeof HARNESS_PROMPT_SITES;

/** Historical D-149 core pipeline sites (immutable key set for docs/ops). */
export const HARNESS_CORE_PROMPT_KEYS = [
  'intentNaming',
  'briefCompilation',
  'briefImage',
  'briefVideo',
  'factSatisfaction',
  'factCriticality',
  'copyCandidate',
  'notePlan',
  'noteTextBlock',
  'noteConsistency',
  'destinationMapping',
  'copyGeneration',
  'platformAdaptation',
  'textResponse',
] as const satisfies readonly HarnessPromptKey[];

/** XHS vertical sites added by issue #315 (beauty-rewritten xhswork assets). */
export const XHS_VERTICAL_PROMPT_KEYS = [
  'xhsOutline',
  'xhsContent',
  'xhsNoteGen',
  'xhsImagePrompt',
  'xhsCoverPrompt',
  'xhsStyleAnalysis',
] as const satisfies readonly HarnessPromptKey[];

export const HARNESS_PROMPT_SITE_COUNT =
  HARNESS_CORE_PROMPT_KEYS.length + XHS_VERTICAL_PROMPT_KEYS.length;

export const HARNESS_LANGFUSE_PROMPT_NAMES = Object.fromEntries(
  Object.entries(HARNESS_PROMPT_SITES).map(([key, site]) => [key, site.name]),
) as {
  [Key in HarnessPromptKey]: (typeof HARNESS_PROMPT_SITES)[Key]['name'];
};

export function harnessPromptCapabilityRequirement(
  key: HarnessPromptKey,
  dynamic: { referenceImage?: boolean } = {},
): ModelCapabilityRequirementAxis {
  const site = HARNESS_PROMPT_SITES[key];
  return {
    axisId: key,
    vocabularyVersion: MODEL_CAPABILITY_VOCABULARY_VERSION,
    requiredProtocolCapabilities: [
      ...site.requirement.requiredProtocolCapabilities,
    ],
    requiredModalities: [
      ...site.requirement.requiredModalities,
      ...(dynamic.referenceImage ? (['image/*'] as const) : []),
    ],
    requiredBusinessTags: [],
    requiredModalityCapabilities: [],
    unknownPolicy: 'conservative_always_available',
  };
}

export type LangfusePromptPolicy = 'pilot' | 'strict';

export const HARNESS_BUILTIN_PROMPTS = {
  intentNaming:
    'Restate the merchant request as a clear creative intent, classify one supported marketing task and delivery layer, and identify which operating asset categories are relevant and genuinely useful for this request. Route to customized only when at least one relevant category has a real benefit; an inferred industry category is the minimum useful unit. Otherwise route to guidance and ask one conversational question covering at most two related details. Never route directly to free, never invent merchant facts, and extract only grounded constraints.',
  briefCompilation:
    'Compile a complete professional copy brief. Ground every factual claim in supplied fact references, keep rights references explicit, and include a concrete CTA and platform. Only source refs beginning with marketing_identity: are registered identity refs; tone instructions are not identities. When none exists, use a neutral official brand voice and return an empty identityRefs array.',
  briefImage:
    'Compile a production-ready image execution brief with an actionable visual prompt, authorized references, output parameters, and explicit safety constraints.',
  briefVideo:
    'Compile a production-ready video execution brief with ordered shots, timing, first-frame direction, authorized references, and explicit safety constraints.',
  factSatisfaction:
    'Assess whether the authorized current facts satisfy every fact requirement for this intent. Return only grounded matched references and the missing fact kinds.',
  factCriticality:
    'Classify whether missing facts block truthful execution for this intent. Return critical only when executing without the facts would make a material claim unsafe.',
  copyCandidate:
    'Generate a materially distinct beauty-business copy candidate grounded in the frozen brief and authorized facts.',
  notePlan:
    'Create a semantic NotePlan before page generation. Follow the merchant intent, include one image intent and one text block per page, and preserve dependencies.',
  noteTextBlock:
    'Finalize one NotePlan page in the configured style. Preserve the theme and prior-page dependency, returning title, body, and exact text only.',
  noteConsistency:
    'Evaluate NotePlan theme continuity, visual consistency, non-repetition, role coverage, and image-text cross-reference. Return only pages needing regeneration.',
  destinationMapping:
    'Map the merchant destination answer only when platform and delivery are unambiguous; otherwise ask one focused clarification question with safe options.',
  copyGeneration:
    'Return complete beauty-business copy candidates with grounded facts, a clear conversion hook, and materially different bodies.',
  platformAdaptation:
    'Adapt canonical beauty-business content into complete xiaohongshu, douyin, and video_account variants without changing facts.',
  textResponse:
    'Return one plain-text response for the requested creative task without provider protocol fields or unsupported claims.',
  // XHS vertical builtins: beauty-rewritten from xhswork server/prompts/* (issue #315).
  // Placeholders stay for future pipeline consumers; do not paste unrewritten generic copy.
  xhsOutline: `你是一位美业门店小红书图文策划师，擅长把医美/美妆/美容/美发/轻医美门店的经营主题拆成可转化的系列信息图大纲。

用户信息：
- 分类：{category}
- 主题：{topic}
- 页数要求：{pageCount} 页（包括封面和结尾）
{styleAnalysisBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
一、拆解原则（美业转化）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【封面图（第 1 张）】
- 强烈视觉冲击 + 记忆点（项目名/痛点/价格钩子二选一突出）
- 少字、大字、高级留白；避免医疗承诺与极限用语
- 标题是到店/咨询价值主张，不是说明书
- 明确一个「为什么要点进来看」的理由（功效场景/新客礼/前后对比预告）

【内容图（中间）】
- 每张只聚焦 1 个核心观点（步骤、禁忌、适宜人群、到店流程、对比维度）
- 用视觉层级，不堆字；信息精简，突出关键词
- 事实须可被商家事实库支撑；禁止捏造资质、疗效、病例数据

【结尾图（最后 1 张）】
- 总结金句 / 预约行动号召 / 到店礼或咨询引导
- 适合截图收藏；情绪收而不散
- CTA 具体（私信「预约」、评论区留肤质、到店核销码等），不写绝对疗效

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
二、文案风格（美业小红书）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- 标题：可用 "！" 与 emoji；数字、疑问句、场景词优先
- 正文：短段落、多换行、emoji 当要点符号
- 语气：亲切顾问感（"姐妹们""宝子们"），像资深美容师/店长分享，不是硬广
- 紧扣「{category}」受众（如敏感肌护理、婚礼跟妆、夏季控油）
- 使用 markdown 书写（# 标题、**加粗**、列表）
- 合规：避免「最好/第一/100%有效/根治」等极限与违禁医疗承诺

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
三、视觉风格决策
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

根据「{category}」与主题从下列维度组合方案；若有「参考图片风格分析」，必须以该分析为主。
可选画风：杂志质感、柔光实拍叠字、扁平知识卡、手账拼贴、SPA 治愈柔光、前后对比分屏。
可选配色：裸粉/香槟金、莫兰迪低饱和、奶油暖色、雾霾蓝+薄荷、黑白灰+品牌色点缀。
背景：纯色渐变、亚麻/大理石台面、光斑虚化、产品静物、门店干净台面。
装饰：产品剪影、步骤箭头、勾选、色块托底、轻微高光；忌杂乱贴纸堆叠。
决策参考：功效科普→清晰知识卡；新客活动→冲击封面+价格色块；手法/服务→柔光实拍感；产品种草→静物杂志感。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
四、配图建议要求
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

每页最后必须有「配图建议：」段落，含：整体画风、配色、背景、文字排版、装饰元素、构图。
整组风格统一，且服务美业门店转化，而非泛生活旅游模板。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
五、输出格式（严格遵守）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- 用 <page> 标签分割每一页
- 每页第一行页面类型：[封面]、[内容]、[总结]
- 随后 markdown 内容；最后一段配图建议
- 避免竖线符号 |

示例（格式参考，主题须按用户输入）：

[封面]
# ✨ 油皮夏日救星！门店「清爽控油」三步护理

到店可做·过程透明·适合易出油肤质

配图建议：杂志柔光信息图，竖版 3:4。奶油白+薄荷绿背景，中心洁面/拍水/清爽乳三件产品剪影，标题大号无衬线，'控油' 用薄荷绿色块托底。少字留白，整体干净专业。

<page>
[内容]
### ① 先洁净，再谈清爽

❶ **温和洁面** — 去油脂不紧绷
❷ **平衡拍水** — 收紧毛孔观感
❸ **清爽乳** — 锁水不闷痘

💡 店长提醒：操作以到店评估为准，不承诺医疗疗效

配图建议：延续封面配色；三步用模块卡片+序号圆标；产品静物小插画；底部提示用手撕便签样式。

<page>
[总结]
### 📅 想试的姐妹评论区留「肤质」

私信「预约」领新客体验名额
关注门店主页，下期讲维稳修护

配图建议：温暖收尾；预约 CTA 大字；轻量爱心/勾选装饰；无手机边框水印。

直接给出大纲，从[封面]开始，不要多余说明。`,
  xhsContent: `你是美业门店小红书内容专家。请根据大纲生成完整笔记文案（医美/美妆/美容/美发门店转化语境）。

用户信息：
- 分类：{category}
- 主题：{topic}

内容大纲：
{outline}

请严格按以下格式输出，不要其他说明：

【标题】这里写一个吸引眼球的标题
（这里直接写正文，不要加"正文内容"等前缀，从第一段开始）
【标签】标签1 标签2 标签3 标签4 标签5

标题要求：
1. 只 1 个标题，15-25 字
2. 可用 "！" 与 emoji；数字、疑问、场景词优先
3. 坏例：美容院介绍
4. 好例：✨油皮救星！这家店的清爽护理也太懂了吧！
5. 紧扣「{category}」热门话题方向
6. 禁止极限医疗承诺与虚假前后对比话术

文案要求：
1. 开头 hook（"姐妹们！""宝子们！"等）
2. 短段落、多换行、emoji 作要点
3. 语气像资深顾问/店长分享，有感染力但不硬广
4. 结尾互动（评论留肤质/项目意向、私信预约）
5. 200-500 字
6. 禁止 markdown（不要 **、#、*、>）；纯文本+emoji
7. 符合「{category}」受众习惯；事实可验证，不捏造资质疗效
8. 标题后直接正文，不要输出"正文"标记

标签要求（5-8 个）：
1. 含「{category}」大标签
2. 含主题精准小标签（项目/肤质/场景）
3. 不加 #，空格分隔

直接输出；第一行【标题】，最后一行【标签】。`,
  xhsNoteGen: `你是美业门店小红书笔记创作专家。请根据信息生成完整笔记（美容师/店主/顾客口吻可切换）。

内容主题：{topic}
语气风格：{tone}
{roleBlock}

请先输出标题行：
【标题】你的标题内容

然后空一行，输出正文（200-500字，分段，适当 emoji，小红书风格，美业门店转化导向）。

最后空一行，输出标签行：
【标签】#标签1 #标签2 #标签3 #标签4 #标签5

要求：
1. 标题有吸引力（后悔体、合集体、对比体、场景体等），且符合指定语气
2. 正文有价值：步骤/体验/注意事项/到店引导清晰
3. 标签 5-6 个，与美业主题高度相关
4. 禁止 markdown（不要 **、# 标题、* 列表、> 引用）；纯文本+emoji
5. 禁止医疗极限承诺、虚假疗效与未授权病例细节
6. 若 role 为顾客口吻，保持真实体验感但仍可核对的事实边界`,
  xhsImagePrompt: `你是美业门店小红书视觉设计总监，擅长为医美/美妆/美容门店图文页生成高质量英文文生图 prompt。

请根据以下信息生成完整英文图片 prompt。

页面类型：{pageType}
内容分类：{category}
页面内容：
{pageContent}

配图建议：
{imageHint}

用户原始需求：{topic}

完整内容大纲参考：
---
{outline}
---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
核心规则
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. prompt 整体英文（给生图引擎）
2. 图上显示文字必须中文，用英文单引号包裹嵌入
3. 例：Title text '夏日控油护理' in bold clean sans font at top center
4. 禁止图上英文（品牌英文名除外）
5. 画面服务美业门店：干净台面、柔光、产品/手法示意、知识卡层级；避免血腥医疗手术实景

若提供「参考图片风格分析」，必须以该分析为主风格依据。

画风可选：杂志质感、柔光实拍叠字、扁平知识卡、SPA 治愈柔光、前后对比分屏、产品静物。
配色：裸粉香槟金、莫兰迪、奶油暖色、薄荷绿点缀、黑白灰+品牌色。
背景：渐变、大理石/亚麻台面、光斑虚化、干净门店一角。
装饰：步骤箭头、勾选、色块托底、产品剪影；忌杂乱。

【封面】冲击力、主标题醒目、少字大字留白。
【内容】延续风格、单观点、层次清晰。
【总结】温暖收尾、CTA/勾选、积极氛围。

技术要求（prompt 末尾必须包含）：
Vertical 3:4 aspect ratio, high resolution, mobile-friendly. All text clear, complete, in Chinese characters. No phone frame, no watermark. No gore, no clinical surgery blood.

Negative prompt：
photorealistic bloody surgery, dark messy clutter, realistic medical wound, English text on image, phone frame, watermark

直接输出英文 prompt（图上文字中文），不要前缀说明。`,
  xhsCoverPrompt: `你是美业门店小红书封面 prompt 专家。请根据描述生成详细文生图 prompt（美业预设，非泛生活模板）。

用户描述：{userPrompt}
风格预设：{style}
尺寸比例：{size}

美业风格预设（已替换通用 xiaohongshu/minimal/collage/gradient/photo）：
- beauty_soft（美业柔光）：柔焦护肤光泽、干净台面、裸粉香槟金、轻文字
- beauty_editorial（杂志质感）：高定排版、精致留白、产品/人物杂志构图
- before_after（前后对比）：左右/上下分屏、对比标注清晰、禁止虚假医疗承诺暗示
- spa_minimal（SPA 极简）：大面积留白、低饱和疗愈色、中心标题
- salon_photo（门店实拍感）：真实门店/手法/陈列光线、生活化但干净

请直接输出详细 prompt，结构包含：
1. 整体画风（按预设）
2. 配色
3. 背景质感与氛围
4. 标题文字排版（主/副标题，中文可读）
5. 插画或装饰（产品、步骤、门店元素）
6. 整体布局
7. 技术要求：{size} 比例、高清竖屏、文字完整清晰、无手机边框、无 logo/水印、无血腥医疗实景

直接输出 prompt，不要前缀解释。`,
  xhsStyleAnalysis: `你是美业视觉风格分析师，擅长从参考图提取可复用的小红书图文视觉特征，供门店批量配图保持风格一致。

请分析用户上传的参考图片，从以下七维输出（每维必填）：

【画风】如：柔光实拍叠字、杂志排版、扁平知识卡、产品静物、手账拼贴等
【配色】主要颜色组合（如：裸粉+米白+香槟金点缀）
【背景】如：纯色渐变、大理石台面、门店一角虚化、纸感纹理等
【文字风格】如：粗体无衬线大标题、色块托底、轻手写点缀等
【装饰元素】如：步骤箭头、勾选、产品剪影、高光、轻边框等
【排版结构】如：居中封面、上下分栏、三步卡片、左右对比等
【整体调性】一句话（如：干净专业的轻医美科普风、温暖治愈的 SPA 种草风）

输出格式（严格，中文冒号，每行一维）：

画风：xxx
配色：xxx
背景：xxx
文字风格：xxx
装饰元素：xxx
排版结构：xxx
整体调性：xxx

直接输出分析结果，不要前缀说明。若图含人物面部，只描述光线/构图/美业场景属性，不输出可识别隐私细节。`,
} as const;

export interface HarnessFrozenPrompt {
  name: string;
  version: string;
  content: string;
  contentHash: string;
  label: string;
  source: 'langfuse' | 'builtin';
  isFallback: boolean;
  fallbackReason?: string;
}

export type HarnessFrozenPrompts = Record<
  HarnessPromptKey,
  HarnessFrozenPrompt
>;

export type HarnessPromptRevisionReference = ReturnType<
  typeof promptTraceReference
>;

export interface HarnessPromptResolver {
  resolve(): Promise<HarnessFrozenPrompts>;
}

export class HarnessPromptAuthorityUnavailableError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
    this.name = 'HarnessPromptAuthorityUnavailableError';
  }
}

export function requireHarnessFrozenPrompt(
  prompts: HarnessFrozenPrompts,
  key: HarnessPromptKey,
) {
  const prompt = prompts[key];
  if (!prompt) {
    throw new Error(`Resolved prompt bundle is missing ${key}.`);
  }
  return prompt;
}

const MODEL_SUPPLY_PROMPT_KEY_BY_OPERATION = {
  'copy.generate': 'copyGeneration',
  'copy.adapt': 'platformAdaptation',
  'text.respond': 'textResponse',
} as const satisfies Record<LanguageModelOperation, HarnessPromptKey>;

export function modelSupplyPromptResolverFromHarness(
  resolver: HarnessPromptResolver,
): ModelSupplyPromptResolver {
  return {
    async resolve({ operation }) {
      const prompts = await resolver.resolve();
      return structuredClone(
        requireHarnessFrozenPrompt(
          prompts,
          MODEL_SUPPLY_PROMPT_KEY_BY_OPERATION[operation],
        ),
      );
    },
  };
}

export interface LangfuseHarnessPromptResolverOptions {
  baseUrl?: string;
  publicKey?: string;
  secretKey?: string;
  label?: string;
  policy?: LangfusePromptPolicy;
  versions?: Partial<Record<HarnessPromptKey, number>>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  warn?: (input: { name: string; reason: string; version?: number }) => void;
}

export class LangfuseHarnessPromptResolver implements HarnessPromptResolver {
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly options: LangfuseHarnessPromptResolverOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async resolve(): Promise<HarnessFrozenPrompts> {
    const entries = Object.entries(HARNESS_LANGFUSE_PROMPT_NAMES) as Array<
      [HarnessPromptKey, string]
    >;
    if ((this.options.policy ?? 'strict') === 'strict') {
      const missing = entries
        .filter(([key]) => this.options.versions?.[key] === undefined)
        .map(([key]) => key);
      if (missing.length > 0) {
        throw new Error(
          `Strict Langfuse prompt resolution is missing pinned prompts: ${missing.join(', ')}.`,
        );
      }
    }
    const resolved = await Promise.all(
      entries.map(async ([key, name]) => [
        key,
        await this.resolveOne(
          key,
          name,
          HARNESS_BUILTIN_PROMPTS[key],
        ),
      ] as const),
    );
    return Object.fromEntries(resolved) as HarnessFrozenPrompts;
  }

  private async resolveOne(
    key: HarnessPromptKey,
    name: string,
    builtin: string,
  ) {
    const label = this.options.label ?? 'production';
    const version = this.options.versions?.[key];
    if (
      !this.options.baseUrl?.trim() ||
      !this.options.publicKey?.trim() ||
      !this.options.secretKey?.trim()
    ) {
      return this.fallback(name, builtin, label, 'unconfigured', version);
    }
    if (version === undefined) {
      return this.fallback(name, builtin, label, 'unpinned');
    }
    const url = `${this.options.baseUrl.replace(/\/$/u, '')}/api/public/v2/prompts/${encodeURIComponent(name)}?version=${encodeURIComponent(String(version))}`;
    let response: Response;
    try {
      response = await this.fetch(url, {
        headers: {
          authorization: `Basic ${Buffer.from(
            `${this.options.publicKey}:${this.options.secretKey}`,
          ).toString('base64')}`,
        },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
      });
    } catch {
      return this.fallback(name, builtin, label, 'request_failed', version);
    }
    if (!response.ok) {
      return this.fallback(
        name,
        builtin,
        label,
        `http_${response.status}`,
        version,
      );
    }
    const body = await response.json().catch(() => undefined);
    if (
      !isRecord(body) ||
      body.type !== 'text' ||
      typeof body.prompt !== 'string' ||
      body.prompt.trim().length === 0 ||
      !validVersion(body.version)
    ) {
      return this.fallback(name, builtin, label, 'invalid_response', version);
    }
    if (String(body.version) !== String(version)) {
      return this.fallback(name, builtin, label, 'version_mismatch', version);
    }
    return {
      name,
      version: String(body.version),
      content: body.prompt,
      contentHash: sha256(body.prompt),
      label,
      source: 'langfuse' as const,
      isFallback: false,
    };
  }

  private fallback(
    name: string,
    builtin: string,
    label: string,
    reason: string,
    version?: number,
  ) {
    if ((this.options.policy ?? 'strict') === 'strict') {
      const pin = version === undefined ? '' : ` version=${version}`;
      const message =
        `Strict Langfuse prompt resolution failed: ${name}${pin} (${reason}).`;
      if (isPromptAuthorityUnavailableReason(reason)) {
        throw new HarnessPromptAuthorityUnavailableError(reason, message);
      }
      throw new Error(message);
    }
    (this.options.warn ?? warnPromptFallback)({
      name,
      reason,
      ...(version === undefined ? {} : { version }),
    });
    return fallbackPrompt(name, builtin, label, reason);
  }
}

function isPromptAuthorityUnavailableReason(reason: string) {
  if (reason === 'request_failed') return true;
  const status = /^http_(\d{3})$/u.exec(reason)?.[1];
  if (!status) return false;
  const code = Number(status);
  return code === 408 || code === 425 || code === 429 || code >= 500;
}

export function assertLangfusePromptRuntimePolicy(
  env: Record<string, string | undefined> = process.env,
) {
  readLangfusePromptRuntimeConfig(env);
}

function readLangfusePromptRuntimeConfig(
  env: Record<string, string | undefined>,
) {
  const policy = promptPolicyFromEnv(env.LANGFUSE_PROMPT_POLICY);
  const baseUrl = env.LANGFUSE_BASE_URL?.trim();
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  if (policy === 'strict') {
    const missing = [
      ...(baseUrl ? [] : ['LANGFUSE_BASE_URL']),
      ...(publicKey ? [] : ['LANGFUSE_PUBLIC_KEY']),
      ...(secretKey ? [] : ['LANGFUSE_SECRET_KEY']),
      ...(env.LANGFUSE_PROMPT_VERSIONS?.trim()
        ? []
        : ['LANGFUSE_PROMPT_VERSIONS']),
    ];
    if (missing.length > 0) {
      throw new Error(
        `Strict Langfuse prompt policy requires ${missing.join(', ')}.`,
      );
    }
  }
  const versions = promptVersionsFromEnv(
    env.LANGFUSE_PROMPT_VERSIONS,
    policy,
  );
  return {
    policy,
    ...(baseUrl ? { baseUrl } : {}),
    ...(publicKey ? { publicKey } : {}),
    ...(secretKey ? { secretKey } : {}),
    versions,
  };
}

export function langfusePromptResolverFromEnv(
  env: Record<string, string | undefined> = process.env,
) {
  const runtime = readLangfusePromptRuntimeConfig(env);
  return new LangfuseHarnessPromptResolver({
    ...runtime,
    label: env.LANGFUSE_PROMPT_LABEL ?? 'production',
    ...(env.LANGFUSE_REQUEST_TIMEOUT_MS
      ? { timeoutMs: positiveInteger(env.LANGFUSE_REQUEST_TIMEOUT_MS) }
      : {}),
  });
}

export function promptRevisionReferences(
  prompts: HarnessFrozenPrompts,
): Record<string, HarnessPromptRevisionReference> {
  return Object.fromEntries(
    Object.entries(prompts).map(([key, prompt]) => [
      key,
      promptTraceReference(prompt),
    ]),
  ) as Record<string, HarnessPromptRevisionReference>;
}

export function promptTraceReference(prompt: HarnessFrozenPrompt | undefined) {
  if (!prompt) return undefined;
  return {
    name: prompt.name,
    version: prompt.version,
    contentHash: prompt.contentHash,
    label: prompt.label,
    source: prompt.source,
    isFallback: prompt.isFallback,
    ...(prompt.fallbackReason
      ? { fallbackReason: prompt.fallbackReason }
      : {}),
  };
}

function fallbackPrompt(
  name: string,
  content: string,
  label: string,
  fallbackReason: string,
): HarnessFrozenPrompt {
  return {
    name,
    version: 'builtin-v1',
    content,
    contentHash: sha256(content),
    label,
    source: 'builtin',
    isFallback: true,
    fallbackReason,
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function validVersion(value: unknown) {
  return (
    (typeof value === 'number' && Number.isInteger(value) && value > 0) ||
    (typeof value === 'string' && value.trim().length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('LANGFUSE_REQUEST_TIMEOUT_MS must be a positive integer.');
  }
  return parsed;
}

function promptPolicyFromEnv(value: string | undefined): LangfusePromptPolicy {
  const normalized = value?.trim() || 'strict';
  if (normalized === 'pilot' || normalized === 'strict') return normalized;
  throw new Error('LANGFUSE_PROMPT_POLICY must be pilot or strict.');
}

function warnPromptFallback(input: {
  name: string;
  reason: string;
  version?: number;
}) {
  const pin = input.version === undefined ? '' : ` version=${input.version}`;
  console.warn(
    `[harness] Langfuse prompt downgraded to builtin: ${input.name}${pin} (${input.reason}).`,
  );
}

function promptVersionsFromEnv(
  value: string | undefined,
  policy: LangfusePromptPolicy,
): Partial<Record<HarnessPromptKey, number>> {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    if (policy === 'pilot') return {};
    throw new Error('LANGFUSE_PROMPT_VERSIONS must be a JSON object.');
  }
  if (!isRecord(parsed)) {
    if (policy === 'pilot') return {};
    throw new Error('LANGFUSE_PROMPT_VERSIONS must be a JSON object.');
  }
  const versions: Partial<Record<HarnessPromptKey, number>> = {};
  for (const [key, version] of Object.entries(parsed)) {
    if (!(key in HARNESS_LANGFUSE_PROMPT_NAMES)) {
      if (policy === 'pilot') continue;
      throw new Error(`LANGFUSE_PROMPT_VERSIONS contains unknown key: ${key}.`);
    }
    if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
      if (policy === 'pilot') continue;
      throw new Error(`LANGFUSE_PROMPT_VERSIONS.${key} must be a positive integer.`);
    }
    versions[key as HarnessPromptKey] = version;
  }
  if (policy === 'strict') {
    const missing = Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).filter(
      (key) => versions[key as HarnessPromptKey] === undefined,
    );
    if (missing.length > 0) {
      throw new Error(
        `LANGFUSE_PROMPT_VERSIONS is missing pinned prompts: ${missing.join(', ')}.`,
      );
    }
  }
  return versions;
}
