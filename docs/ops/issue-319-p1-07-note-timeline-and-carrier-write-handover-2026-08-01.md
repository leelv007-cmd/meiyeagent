# #319 P1-07 交底 —— 多页编辑时间线与 note 载体写方接入

- 分支：`leelv007-cmd/lane-319`（worktree `lane-319`）；**未 push、未关票**，合入与批换锚由主控执行。
- 规格锚：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §4.1 / §8.2 / §3.1 / §10.3-1（P1-5 / P1-8）。
- 前置：#313 AgentFrame 壳、#314 carrier 消费点、#315 prompt、#317 流内确认 + note 过卡、#318 Activity Shelf 均已合入 main（merge-ledger）。

---

## 一、§10.3-1 定案：note 字段级 schema 与 image_text 迁移

### 1.1 note 字段级 schema（页组 / 封面 / 正文）

**不新起第三套 schema。** 落库字段沿用既有：

| 产品语义 | 字段 | 位置 |
| --- | --- | --- |
| 页组 | `note.plan.pages[]` | `imageTextNoteVersionSchema` / `note-plan/v1` |
| 封面 | `pages` 中 `pageRole === 'cover'`；缺省退化为 `order === 1` | 纯函数 `notePlanCoverAndBody` |
| 正文 | 非封面页 `textBlock` 序列；版本级 `body` 为 assemble 拼接 | `ContentPackageVersion.body` + `title`（=`themeAnchor`） |
| 有序媒资 | `orderedAssetIds` ← selected 时 `pages.map(p => p.imageAssetId)` | 写方 `assembleNoteAndDeliver` |
| 重生回执 | `note.regenerationReceipts[]` | merchant_request / consistency_conflict |

产品面时间线投影：`mkfast-template-main/src/product/composer/note-plan-timeline.ts`（`note-plan-timeline/v1`，**不落库**）。

### 1.2 历史 image_text 迁移策略（继承 #288，本票钉死）

| 层 | 取值 | 落库 |
| --- | --- | --- |
| wire / storage `kind` | `image_text` \| `video` | 是（**零变更**） |
| 产品载体 `contentPackageCarrierOf` | `media` \| `copy` \| `note` | 否（读时派生） |

```ts
// packages/contracts/src/content-package.ts
contentPackageCarrierOf({ kind, orderedAssetCount })
// video                      → media
// image_text + count === 0   → copy
// image_text + count > 0     → note
```

- **不做** wire 枚举扩到 media/copy/note 的破坏性迁移。
- 新写方（本票 note 编排落库）保证 selected 版本 `orderedAssetCount > 0`，派生 carrier = **note**。
- 消费点一律 `contentPackageCarrierOf`（#314 已收 workbench / works / result / export）。

### 1.3 写方归位证明

| 链 | 证明 |
| --- | --- |
| 落库 | `assembleNoteAndDeliver` 写 `version.note` + `orderedAssetIds` |
| carrier | core：`unified-media-stage-ports.test.ts` 断言 selected → `contentPackageCarrierOf === 'note'` |
| 投影 / 状态 | #314 `workbench-state-model` / `works-projection` / `result-live-projection` |
| 导出 | #288 `content-package-export-adapter` 三分派走 carrier |

---

## 二、多页编辑时间线产品面（P1-5）

### 2.1 行为

1. 时间线 turn `note_plan` → AgentFrame **`plan`** 族（P1-01 注册表渐进映射完成 plan 消费点）。
2. 大纲逐页可编辑（plain `<input>` / `<textarea>`，**非 Tiptap** — C12 / D-171）。
3. 批量配图状态 per-page：`pending | generating | ready | failed`；随 harness `execution_selection` progress 批量刷新。
4. 逐页重生：UI 按钮 → `requestNotePlanPageRegenerate`（fixture 可 complete；production host 可挂 merchant_request）。
5. Delivered 后 hydration：`content_packages` 读 `version.note` → `applyComposerNotePlan`。

### 2.2 关键文件

| 文件 | 角色 |
| --- | --- |
| `note-plan-timeline.ts` | 纯模型 |
| `note-plan-timeline-frame.tsx` | 时间线 UI |
| `agent-frame-registry.ts` | `note_plan` → `plan` |
| `composer-session.ts` | turn + apply/update + progress 同步状态 |
| `composer-conversation.tsx` | 渲染 Plan 帧 |
| `composer-home.tsx` | 编辑 / 重生 / delivery 后 hydration |

### 2.3 验收锚

- 单元：`note-plan-timeline.test.ts`（edit ≥1 + image status + regenerate + cover/body）
- RTL：`note-plan-timeline.interaction.test.tsx`（data-agent-frame=plan；outline 编辑；配图状态）
- 静态：`workbench-p1.static.test.ts` P1-5 门

---

## 三、Delivered 成品卡 C7 + 导出/发布准备占位

| 动作 | testid / 文案 | 合同 |
| --- | --- | --- |
| 卡面门 | `composer-delivery-object-workspace-gate`「进入对象工作区 · 点开看完整成品」 | C7 |
| 主按钮 | `composer-delivery-action-object-workspace`「进入对象工作区」→ `action: 'open'` | Result Center |
| 导出占位 | `composer-delivery-action-export`「导出/发布准备」 | §4.9 不承诺分发 |
| 采用 / 调整 | 既有 adopt / adjust | 对象工作区精修 |

---

## 四、约束核对（D-171）

- 零新 agent runtime：仅 AgentFrame 注册表 + 既有 DBOS/Task/ContentPackage 真相链。
- Tiptap：多页大纲帧未引入；对象工作区三件套属 P2。
- 无匿名抓取 / 无分发合同。

---

## 五、验证命令（本机 lane）

```bash
# web unit (tsx --test, excludes interaction)
pnpm --filter @meiye/web test -- src/product/composer/note-plan-timeline.test.ts \
  src/product/composer/agent-frame-registry.test.ts \
  src/product/composer/card-language.test.ts \
  src/product/composer/workbench-p1.static.test.ts

# web interaction
pnpm --filter @meiye/web test:interaction -- src/product/composer/note-plan-timeline.interaction.test.tsx

# core note write carrier
pnpm --filter @meiye/core exec tsx --test src/p1/harness/unified-media-stage-ports.test.ts

# typecheck
pnpm typecheck

# e2e (optional long path)
pnpm --filter @meiye/web e2e -- tests/e2e/specs/image-text-note-compiler.spec.ts
```

---

## 六、遗留（非本票）

1. 大纲 dirty → 服务端 OCC hand-edit / 重提 NotePlan（本票仅产品面可编辑 + session 投影）。
2. 逐页重生 production 写路径：`regenerateNotePlanPage` 纯函数在位；HTTP/command 挂载可在对象工作区 P2 收齐。
3. 对象工作区三件套（Tiptap / 手机壳 / 瀑布流封面）= P2。
4. 记忆帧 memory family 仍无 turn 生产者。
