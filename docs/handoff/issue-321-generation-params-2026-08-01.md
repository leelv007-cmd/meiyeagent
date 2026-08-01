# Issue #321 P2-09 — 生成参数显露（tone/role 美业选择器 + 深度思考档位）交底

| Field | Value |
| --- | --- |
| Issue | #321 |
| Spec | `docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §4.5 / §4.7 |
| Date | 2026-08-01 |
| Merge-review follow-up | 2026-08-02 |
| Branch | `leelv007-cmd/lane-321` |
| Baseline | `69cf06e1a6e18734fcefef8122a833e8a4b8e3a7` |

## 1. 「实施时定」闭合

### 1.1 与既有 `note_style` 合流（§4.5）

**定案：双维并存，不合并枚举。**

| 维 | 职责 | 挂点 | 词汇 |
| --- | --- | --- | --- |
| `note_style` | **结构/叙事骨架**（干货科普版 / 种草叙事版…） | 中途 `ask_merchant` 双候选；admin `NOTE_STYLE_CONFIG_KEY` | 既有 `DEFAULT_NOTE_STYLES` |
| `beautyVoiceRole` | **美业生成口吻/角色**（美容师 / 店主 / 顾客） | Composer 参数选择器 → 提交体 → 快照 | 本票新枚举 |

理由：

- 审计 §3 的 `note_style` 是图文双风格**结构候选**，不是 xhswork 式 tone/role 前台选择器。
- `xhsNoteGen` 占位符是 `{tone}` + `{roleBlock}`，与 note plan 风格 id 正交。
- MarketingIdentity 继续是**品牌表达默认值**；自由创作未选角色时，按冻结快照的 identity ref 只取已登记的 `expression_identity` 贡献；选择器是**显式覆盖**（C5）。

### 1.2 深度思考 → 模型档位映射（§4.7）

**定案：UI 两档映射既有 route profile / provider thinking，不新建积分开关。**

| `thinkingLevel` | `routeProfile` | provider thinking | `reasoningEffort` |
| --- | --- | --- | --- |
| `standard`（默认） | `balanced` | `{ type: 'disabled' }` | — |
| `deep` | `quality` | `{ type: 'enabled' }` | `high` |

约束：

- **不**引入 `thinkingPointsCost` / 独立 entitlement bucket（「不另建开关」）。
- 不支持 thinking 的模型可忽略 provider 字段；routeProfile 仅由现有 XHS NotePlan auto 路由消费，不覆盖非 XHS 或 image/video brief 的既有选路。
- **定制创作强制 `standard` 且隐藏控件**；**自由创作展开区显露**。

### 1.3 美业口吻词汇

| id | 标签 | tone → `{tone}` | roleBlock 摘要 |
| --- | --- | --- | --- |
| `beautician` | 美容师口吻 | 专业干货 | 资深美容师 |
| `owner` | 店主口吻 | 温暖治愈 | 门店店主（定制默认注入） |
| `customer` | 顾客口吻 | 闺蜜聊天 | 到店顾客 |

## 2. 代码落点

| 层 | 路径 |
| --- | --- |
| contracts | `packages/contracts/src/composer-generation-params.ts` |
| core snapshot | `apps/core/src/p1/execution-spine/creation-execution-snapshot.ts`（`beautyVoiceRole` / `thinkingLevel` 可选冻结） |
| core consumer | `apps/core/src/p1/harness/note-plan-structured-port.ts` + `unified-media-stage-ports.ts`（XHS NotePlan prompt / model route） |
| provider options | `apps/core/src/p1/model-supply/structured-node-runner.ts`（request-scoped thinking） |
| web pure | `mkfast-template-main/src/product/composer/composer-generation-params.ts` |
| web UI | `…/composer-generation-params-panel.tsx`；仅在 XHS `image_text` + `note` 路径挂 `composer-home` free 展开区（attachment 槽） |
| 提交注入 | `composer-home` → `buildSubmissionGenerationParams` → `composer-submission-client` body |
| 浏览器验收 | `tests/e2e/specs/uiux-upgrade-b-composer.spec.ts` + `tests/e2e/TEST-CATALOG.md` §16 #9 |

**2026-08-02 合入审核修复：** 原交底只停在请求合同与快照，造成生产零消费者。现在参数从冻结快照进入既有 XHS NotePlan / `xhsNoteGen` 文本节点与 Model Supply auto profile/provider options；自由创作未选角色时消费同一冻结 ContextBundle 中的 MarketingIdentity；非 XHS 不显示、不提交且不改变模型路由。仍不重写 note 全链、不新建 runtime、不改前端计价。

## 3. 验收映射

| 票面验收 | 证据 |
| --- | --- |
| 选择器选择注入生成请求（interaction + core 合同） | web interaction + `composer-submission-client` 合同；core snapshot freeze + XHS NotePlan 生产消费测试 |
| 深度思考定制隐藏 / 自由显露（interaction） | `composer-generation-params.interaction.test.tsx` |
| 档位映射行为测试绿 | contracts + core `mapThinkingLevelToModelOptions`；Model Supply route + request-scoped provider body |
| MarketingIdentity 默认口吻进入真实 prompt | `production-context-port.test.ts` 真实 free 路由冻结 + `unified-media-stage-ports.test.ts` 冻结 identity 生产消费 + `note-plan-structured-port.test.ts` prompt 正向证据 |
| 仅 XHS 图文笔记显示并提交 | web pure/static 负向证据 + Catalog #9 Chromium Playwright |

## 4. 语义锁 / 边界

- 只动 Composer 参数选择器、请求注入与既有 NotePlan / Model Supply 消费缝。
- 不改 `docs/design` / `docs/adr` / `docs/specs`。
- 不 push、不关票、不写 merge-ledger。
