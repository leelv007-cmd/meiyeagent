# 票 12 · variant 编辑 + 版本 + 回滚
> 建设面: E4 三平台 ｜ 决策: DEC-THREE-VARIANTS ｜ Blocked-by: 11

> 合同变更通知（2026-07-17）：票 01 冻结后的 `needs_replacement` 允许动作已增加 `edit_text`；版本编辑可以抢救仍有效的文字事实，不解除 rights revoked，也不得绕过导出守卫。

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "12",
  "decisionIds": [
    "DEC-THREE-VARIANTS"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [],
  "contractIds": [
    "X-THREE-VARIANTS-EDITABLE"
  ],
  "blockedBy": [
    "11"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **US13 空转（confirmed）**：规格 User Story 13"编辑某个平台版本并保留版本历史，能改稿、回滚、对比"当前三个动词全部落空——全仓 `ContentPackage` 零命中（复核 ADR-0011"真实空白"结论仍成立），而新采用唯一写入的 P1 `CreativeContent` 根本没有版本器官：`apps/core/src/p1/operations/types.ts:731-742` 的接口只有 `title/body/assetIds/status:'accepted'`，无 versions、无 variant、无 currentVersionId；`apps/core/src/p1/operations/application-service.ts` 全文对 `creativeContents` 只有一处 push（`:5641`，采用时），此后**不存在任何编辑/版本/回滚命令**。商户在工作台采用一条文案后，结果卡只剩一枚"已采用为内容"徽标（`mkfast-template-main/src/product/unified-creation-workbench.tsx:2365-2369`）——采用即死路，改一个字都不行。
- **旧系统的版本器官残缺且按 D06 已判只读（confirmed）**：唯一有版本概念的是旧 Product `ContentItem`（`packages/contracts/src/product.ts:84-115`：`ContentVersion[]` + `currentVersionId` + `aiDefaultVersionId`），但它是 ADR-0011 判定的迁移只读来源，且能力本身对不上 US13：
  - 编辑＝4 个固定指令追加一行套话（`apps/core/src/product/product-service.ts:1963-1983`，schema enum 在 `packages/contracts/src/product-schema.ts:183-188`），**不能自由改稿**；且 `currentVersion(content)` 默认参数写死 `'xiaohongshu'`（`product-service.ts:233`）、`quick_edit` 调用不传 platform（`:1965`），永远只编辑小红书 variant。
  - 回滚＝两个指针动作：`undo_edit` 后退一步（`:1984-1992`）、`revert_to_ai` 跳回 AI 初稿（`:1993-1999`）——不能回滚到任意历史版本；前端把两个按钮的 platform 硬编码 `'xiaohongshu'`（`mkfast-template-main/src/routes/dashboard/content.tsx:567,582`），抖音 variant 只渲染一枚时长徽标（`:478-488`），正文、编辑、回滚入口全无。
  - **版本历史面与对比面全仓不存在**：没有任何页面列出 `versions` 数组（`content.tsx:456-458` 只取 currentVersionId 单版本渲染），i18n 只有"撤销/回到 AI 版本"两个键（`project.inlang/messages/zh.json:1016,1022`），官方模板域的"版本生命周期"是另一对象，不是成品版本历史。
- **旧锚点漂移说明**：ADR-0011 所引 `application-service.ts:5638`（单元素数组）现为 `:5631`（`assetIds: [asset.id]`），漂移 7 行、逻辑未变，与票 08 复核一致；`content.tsx:100` 现为 sourceContent 查找，列表过滤在 `:136,141`。
- **票界**：本票在票 11 落成的三平台 variant 之上，交付 variant 的自由编辑、不可变版本历史、任意版本回滚与版本对比，全部读写 ContentPackage。variants 的生成归票 11；导出与回执归票 13；复用血缘归票 14；撤权阻止导出与水印烧录归票 15；手机端同对象轻编辑的界面接线归票 16；旧 ContentItem 版本链迁移映射归票 17。
- **锁定边界**：不重开 D4——版本体系发生在"3 选 1 单选采用"**之后**的包内（ADR-0008 D4"采用后进入 Package 版本体系"），不新增多选采用或二次候选；商户一级导航维持创作/内容/素材/门店，编辑入口在内容库包详情二级；状态用语只用创作中/可使用/需处理（D14），编辑改稿不得把包推回创作中、不得创建付费任务（十条状态契约"不创建付费任务补齐缺项"）。

## 现状代码入口（实核 file:line）

- `apps/core/src/p1/operations/types.ts:731-742`：`CreativeContent` 接口——无版本字段，本票不给它加（D06 只读），版本器官长在 ContentPackage 上。`:1104-1126`：`OperationsWorkspaceState`（`creativeContents` 在 `:1123`）——ContentPackage 聚合在 state 中的落位以票 01/06 冻结为准。
- `apps/core/src/p1/operations/application-service.ts:5572-5667`：`acceptCreativeAsset` 全貌（采用写入点，`assetIds: [asset.id]` 在 `:5631`）——票 06 改写为开包后，本票的版本链从包的首版本长出。
- `apps/core/src/p1/operations/application-service.ts:612-652`：`executeIdempotentModuleCommand`——workspace-scoped idempotency key + canonical payload hash，同 key 不同 payload 抛 `IDEMPOTENCY_CONFLICT` 409（`:625-631`），完成后落 command receipt。规格 §6"所有写命令要求幂等键"的现成机制，本票编辑/回滚命令直接穿它。
- `apps/core/src/p1/operations/foundation-module.ts:303-320`：`OperationsFoundationModule.execute` 命令分发（带 idempotencyKey 即走上述包装，`:308-315`）；`:433-437` `accept_creative_asset` case 是新命令 case 的同形态样板；`:712` 起是 query 分发——版本历史查询挂点。
- `mkfast-template-main/src/p1/client.ts:65-97,107-113`：`commandP1`/`operationsCommand` 自带 `idempotency-key` header（`:71` 缺省 `crypto.randomUUID()`——注意：编辑保存的重试必须传稳定 key，见风险）；`mkfast-template-main/src/routes/api/core/p1/commands.ts:4-11`：BFF 经 `forwardWorkspaceCoreRequest` 透传，无需新路由。
- `apps/core/src/product/product-service.ts:233-239,1963-1999`：旧 quick_edit/undo_edit/revert_to_ai 三命令——语义参照物与迁移对照物，本票不动它们（票 17 处理冻结）；`apps/core/src/p1/operations/adapters.ts:441-448`：周批 revise 效果器仍打旧 `quick_edit`，属旧通道既有事实，本票不碰。
- `mkfast-template-main/src/routes/dashboard/content.tsx:447-608`：现内容卡——单版本渲染（`:456-458`）、固定指令编辑（`:528-545`）、硬编码小红书的撤销/回到 AI（`:558-588`）。票 07/11 落成包详情与 variant 面后，本票在其上加编辑/历史/回滚/对比；旧卡的去留随票 07 切换，不在本票。
- `mkfast-template-main/src/product/mobile-action-book.tsx:207-216,1467-1499`：手机侧 `currentVersion` 本地 helper 与 2 个固定指令 quick_edit，仍走旧 Product 通道（`runProduct`）——D17"手机轻编辑"现状挂在旧事实上的证据；本票命令即为票 16 手机复用的同一 seam。
- `apps/core/src/product/publish-content-snapshot.ts:47,67,81`：发布快照绑定 `contentVersionId` 的既有先例——"下游绑定具体版本、回滚不改写既有绑定"是本票版本语义必须保住的不变量（票 13 导出回执沿用）。
- 测试 prior art：`apps/core/src/p1/operations/creative-work.test.ts:991-1006`（采用幂等/单采用合同）、`:1241-1302`（IDEMPOTENCY_CONFLICT 断言形态）；`apps/core/src/p1/operations/postgres-repository.test.ts`（真实事务 + workspace 隔离形态）。

## 改造方案（步骤级）

1. **契约层（跟随票 01 冻结合同与票 06 契约落点，不另开第二份契约）**：为 variant 版本记录定形——`id / variantId / source: 'ai_generated' | 'merchant_edited' | 'rollback_restored' / 内容字段（以票 11 落的 variant 内容形态为准：标题、正文、转化钩子、话题、视觉顺序等）/ revertedFromVersionId? / createdBy / createdAt`，版本记录**不可变**（CONTEXT.md 红线"原地覆盖历史版本"）；variant 持 `currentVersionId` 指向当前版本。命令 payload：编辑（`packageId + variantId + baseVersionId + 变更字段`）与回滚（`packageId + variantId + targetVersionId`）；查询返回版本历史列表（含当前标记）。
2. **Application Service 命令（最高 seam 上，不新增 seam；命令名以票 01 冻结合同为准，下述为语义）**：
   - **编辑 variant 版本**：校验包与 variant 存在、包不在 cancelled 等终态；`baseVersionId` 必须等于该 variant 当前版本（乐观并发，落后返回明确冲突码，不静默覆盖）；追加新不可变版本（source=merchant_edited）→ `currentVersionId` 前移 → 审计。纯文本事实操作：不创建 Job、不扣额度、不改包的权利合规态与主状态（可使用保持可使用；需处理的包允许改稿——改稿正是"处理"，但编辑不解除需处理）。
   - **回滚 variant 版本**：`targetVersionId` 必须在该 variant 历史内；把 target 内容复制为新版本（source=rollback_restored、revertedFromVersionId=target）→ `currentVersionId` 前移。**回滚长链不动历史**：被滚掉的版本原文永在，可再滚回来；target 已是当前版本时幂等返回不建版本。不采用旧系统"指针后移"语义——指针制在"回滚后再编辑"时历史分叉不可审计，且新版本制天然保住导出回执/发布快照对旧版本 id 的绑定（`publish-content-snapshot.ts` 先例）。
   - **版本历史查询**：并入票 07 的包详情查询或以独立 query action 挂 `foundation-module.ts:712` 分发（跟随票 07 已落的查询形态，不开第二套投影）；逐版本返回来源、时间、当前标记与完整内容字段——对比视图不需要专门 diff API，两版本内容由前端并排。
   - 两条写命令全部穿 `executeIdempotentModuleCommand`（`application-service.ts:612`）：同 key 重放只返回既有结果、不重复版本——直接落实十条状态契约"幂等查询不重复版本"。
3. **前端（挂在票 07 包详情 + 票 11 variant 面上）**：
   - variant 面新增"编辑"：字段级表单（标题/正文/钩子等现值直接可改），保存经 `operationsCommand` 发编辑命令并带稳定幂等键；保存后当前内容即时更新；base 落后冲突时按"需处理"口径提示刷新重试，不吞错误。
   - "版本历史"面板：列表逐行显示 版本序号/来源徽标（AI 生成/商户编辑/回滚恢复）/时间/当前标记，行动作＝"设为当前版本"（回滚，带确认）与"与当前对比"。
   - 对比视图：任选历史版本与当前版本逐字段并排（标题/正文/钩子/顺序），变更字段打标——最小实现字段级并排，不引重型 diff 库。
   - 三平台各 variant 独立入口独立版本链；模型/RouteSnapshot 等来源证据只在版本详情二级出现（D07）。新增 i18n 键进 `project.inlang/messages/zh.json` + `en.json`。手机布局接线归票 16，本票保证命令与查询设备无关。
4. **测试（打 Application Service 外部行为，形态沿用 `creative-work.test.ts` 幂等合同与 `postgres-repository.test.ts` 真实事务）**：
   - 编辑追加新版本且历史不可变：原版本逐字段原样、版本数 +1、currentVersion 前移。
   - 同幂等键重放编辑恰好一个新版本；同 key 不同 payload → `IDEMPOTENCY_CONFLICT`；base 落后 → 冲突码且零写入。
   - 回滚产生 source=rollback_restored 新版本、引用 target、target 原文不动；回滚→再编辑→再回滚链路全程历史完整；对当前版本回滚为幂等 no-op。
   - 平台隔离：编辑抖音 variant 不改小红书/视频号 variant 的 currentVersion 与历史。
   - 编辑与回滚全程不产生 Generation Job、不产生 Product Usage 与 Provider Cost 新事实、不改包权利合规态（对齐测试哲学"同时断言产品结果与双账"，此处为零变化断言）。
   - workspace 隔离：跨 workspace 编辑/回滚/查历史一律拒绝。
   - 防回归（D06）：编辑与回滚不写旧 `contents`/`creativeContents`。前端 E2E 按既有单 Worker Playwright 配置补"编辑→历史→回滚→对比"种子旅程。测试只作工程护栏，不作为关票依据。

## DoD（全部必须是用户可见行为）

- 商户在内容库打开一个"可使用"成品的小红书版本，自由改写标题与正文（任意文字，非固定指令）并保存后，页面立即显示改后内容；打开版本历史能同时看到 AI 原版与自己的编辑版，各自来源与时间清晰可辨。
- 商户在版本历史中点任意历史版本"设为当前"，该平台版本内容立即回到那一版；被滚掉的版本仍留在历史里原文可查，商户可以再滚回来——不存在"回滚即丢稿"。
- 商户选择某历史版本"与当前对比"，看到标题、正文、转化钩子逐字段并排且变更处有标识，据此决定改稿或回滚。
- 商户分别编辑小红书、抖音、视频号三个平台版本，三条版本链互不影响——改抖音不动小红书；每个平台版本各自显示自己的历史。
- 编辑与回滚过程中成品状态徽标保持"可使用"（或原"需处理"），不出现"创作中"，不产生任何新的用量/费用提示——改稿是免费的事实操作。
- 商户在编辑面停留期间同一版本已在别处被更新时，保存会得到明确的冲突提示并可刷新后重试，自己的稿子不静默覆盖别人的版本。
- **对照证据（至少 1 条，当前 vs 改造后）**：同一条已采用文案录屏对照——当前产品：`/dashboard/content` 卡片只有 4 个固定"快捷编辑"按钮（点击只会在正文尾部追加一行套话）+"撤销/回到 AI 版本"两个仅对小红书生效的按钮，抖音版本只剩一枚徽标、正文不可见，全程无版本历史面；改造后：同一成品可自由改稿、三平台各自有版本历史列表、任选版本回滚并对比。两段并排存档。
- 证据必须来自真实可操作 `/dashboard` 的包详情面（桌面视口）；真实 provider 端到端留证按 D01 归票 22 回挂，本票不得以"命令存在/契约测试绿/组件完成"关票。

## Blocked-by / Blocks

- **Blocked-by**：票 01（ContentPackage 聚合合同 + 十条状态契约冻结——版本与 variant 的合同形状由它定，未冻结不得扩建）；票 06（ContentPackage 写通道/repository/服务基座）；票 07（内容库与包详情只读 ContentPackage——编辑入口所在的面）；票 11（三平台 variants 生成——没有 variant 就没有编辑对象）。
- **Blocks**：票 13（导出绑定"当前版本"并出回执——版本指针语义由本票落）；票 14（复用血缘引用具体版本）；票 15（撤权与合规作用面需要"编辑不解除权利态"的本票约束先成立）；票 16（手机同一 Package 轻编辑复用本票命令与查询）；票 17（迁移差异校验须覆盖"内容版本"，旧 ContentItem 版本链映射进包版本体系以本票模型为靶）；票 22（真实链路验收中"三平台可编辑 variants"一段）。解阻不等于关票；本票以上述用户可见证据关票。
- 遵守 MAP 全局规则：本票关票前置以装配脚本生成的 decision-ticket-map 为准。

## 风险与回退

- **幂等键被前端稀释**：`operationsCommand` 缺省每次生成新 UUID（`client.ts:110`），网络重试若换 key 会造出重复版本。控制：编辑保存以"packageId+variantId+baseVersionId+载荷哈希"派生稳定 key（或一次保存会话固定 key），重试复用；seam 侧同 key 重放合同已由 `executeIdempotentModuleCommand` 兜底，契约测试双向断言。
- **并发丢失更新**：桌面与手机（票 16 后）可同时基于同一 baseVersion 改稿。控制：baseVersionId 乐观并发，落后即 409 冲突提示，不做自动合并——两边的已保存版本都在历史里，商户手动取舍。绝不静默覆盖。
- **版本爆炸**：自由编辑高频保存可能刷出长链。控制：只有显式"保存"落版本，输入中的本地草稿不落版本（对齐"作品编辑上下文"中 transient autosave 不改已提交 revision 的既有语义）；v1 不做版本上限与折叠，历史列表分页即可，膨胀真实发生再议。
- **状态机污染**：编辑/回滚若误触包状态推进或创建付费任务，即违反十条状态契约。控制：两命令实现里物理上不接触 Job/Usage/Cost 写路径，测试以"双账零变化"断言钉死。
- **回滚语义与旧系统直觉冲突**：旧商户习惯"撤销=后退一步"。控制：历史面首行提供"回到上一版"快捷动作（等价于对上一版本回滚），语义仍是新版本制；文案不用"撤销"字样以免暗示可丢历史。
- **D4 红线**：版本/编辑绝不回头改采用策略——不出现"编辑出多个候选再选一次"的面；code review 检查编辑命令与采用命令零耦合。
- **回退方案**：功能开关只撤前端编辑/历史/回滚入口，seam 命令保留；已产生的版本历史与审计事实由新链路继续持有并可读，不删除、不用旧快照覆盖（spec §9 回滚原则）。variants 只读展示（票 11 交付面）全程不受影响，回退零损失。
