# #322 P2-10 交底 —— 对象工作区壳、Tiptap 与选区 AI 六动作

- 分支：`leelv007-cmd/lane-322`（worktree `/Users/bin/orca/workspaces/美业内容2/lane-322`）；**未 push、未关票**，合入与 P1 验收门由主控执行。
- 开工基线：`69cf06e1a6e18734fcefef8122a833e8a4b8e3a7`（与派发基线 / origin/main 一致）。
- 规格锚：`docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §3.5 / §4.4 / §7.2 / P2-2 前半。
- 约束：D-171 零新 agent runtime；Tiptap 只进对象工作区；无匿名抓取。

---

## 一、「实施时定」定案

### 1.1 选区 AI prompt 路径（票面：依 P1-03 裁决走位点或本地模板）

**定案：对象工作区本地模板（fixture / 预览）**，不新增 Langfuse 位点。

| 项 | 落点 |
| --- | --- |
| 动作 id | `continue` / `rewrite` / `expand` / `shorten` / `tone` / `custom` |
| 本地模板 | `mkfast-template-main/src/product/object-workspace/selection-ai-model.ts` → `SELECTION_AI_LOCAL_TEMPLATES` |
| 美业语境 | 模板内嵌「美业门店内容助手」+ 禁编造项目/价格/疗效 |
| 预览 | `applySelectionAiPreview` 确定性本地预览；采用仍走既有 QuickEdit / derived Task 链 |
| 与 #315 关系 | 生成期六 prompt 仍在 `harness/xhs-*`；选区 AI 编辑期动作本票独立，**后续**可再挂 Langfuse 位点而不改动作 id |

理由：规格 §6「评估后决定：进 Langfuse 位点 vs 对象工作区本地模板」；P2 壳阶段本地模板足够支撑 interaction 验收，避免与 P1 位点命名/版本 pin 抢语义锁。

### 1.2 三载体复用

| 载体 | shell `data-carrier` | 挂点 |
| --- | --- | --- |
| copy | `copy` | `CopyImageTextWorksurface` 经 `objectWorkspaceCarrierFromFacts`（无有序媒资） |
| note | `note` | 同上（`orderedAssetIds.length > 0`）或独立 `ObjectWorkspaceShell carrier="note"` |
| media / 图文 | `media` | `workspaceKind: 'video' \| 'image'` 映射 |

正文 Tiptap + 选区 AI 六动作共用同一编辑面；**手机壳 / 瀑布流留给 #326**；**编辑期扫词留给 #327**。

### 1.3 与既有选区改写的关系

- 既有 stable-anchor / base-drift / QuickEdit 采用链保留。
- 工具条主集 = 六动作；`weaker_promo` / `stronger_cta` 仍为 QuickEdit 促销快捷（非六动作成员）。
- `tone_shift` 保留为 `tone` 别名。

---

## 二、实现落点

| 文件 | 角色 |
| --- | --- |
| `src/product/object-workspace/object-workspace-shell.tsx` | 对象工作区壳（carrier 徽标 + 标题） |
| `src/product/object-workspace/object-workspace-editor.tsx` | Tiptap 正文（仅工作区） |
| `src/product/object-workspace/selection-ai-model.ts` | 六动作 + 本地模板 + 预览 |
| `src/product/object-workspace/selection-ai-toolbar.tsx` | 独立工具条组件（可复用） |
| `src/product/results/copy-image-text-worksurface.tsx` | Result Center 挂载：壳 + Tiptap + 选区 AI |
| `src/product/results/copy-image-text-worksurface-model.ts` | 动作枚举扩展 + 预览逻辑 |
| `package.json` | `@tiptap/core` / `pm` / `react` / `starter-kit` ^2.27.2 |

Delivered 入口（#319 C7）不变：`composer-delivery-action-object-workspace` → Result Center。

---

## 三、验收对照（行为为证）

| 票面验收 | 证据 |
| --- | --- |
| 选区 AI 至少 3 个动作可测（interaction） | `object-workspace.interaction.test.tsx`：continue / rewrite / shorten 预览；custom 指令步进 |
| Composer 主输入无编辑器（合同） | `object-workspace-c12.static.test.ts` + `workbench-p1.static.test.ts`（Composer 无 `@tiptap/`） |
| typecheck | `pnpm --filter @meiye/web typecheck` 绿 |
| 触达 e2e | **留给主控**（lane 纪律） |

### 验证命令摘要

```text
# unit
pnpm exec tsx --test \
  src/product/object-workspace/selection-ai-model.test.ts \
  src/product/object-workspace/object-workspace-c12.static.test.ts \
  src/product/results/quick-edit-model.test.ts \
  src/product/results/copy-image-text-worksurface-model.test.ts
# → 全部 pass

# interaction（先 locale:compile）
pnpm locale:compile
pnpm exec vitest run \
  src/product/object-workspace/object-workspace.interaction.test.tsx \
  src/product/results/copy-image-text-worksurface.interaction.test.tsx \
  src/product/results/quick-edit.interaction.test.tsx
# → Test Files 3 passed · Tests 22 passed

# typecheck
pnpm typecheck  # exit 0
```

---

## 四、四门（摘要）

1. **消费者证明**：Delivered C7 → Result Center → `object-workspace-shell` + Tiptap body + 选区 AI 工具条；QuickEdit 采用仍写 ContentPackage。
2. **可达性**：有 `onSelectionRewrite` 时挂工具条；无 handler 不露死按钮（既有合同）。
3. **出口（含负向）**：预览 → 就用这版 / 丢弃；tone/custom 需指令面板；base drift → conflict 三选。负向：Composer 无 Tiptap。
4. **反向复核**：非对象工作区（Composer / note-plan 大纲）静态断言无 `@tiptap/`；六动作外促销芯片不冒充主六。

---

## 五、边界与欠账

- **不做**：#326 手机壳 / 瀑布流；#327 违禁词内联；e2e 全量；Langfuse 选区位点挂接；自行合入 / 关票。
- **e2e 欠账**：`s5-work-page` 仍点 `copy-rewrite-weaker_promo`（促销快捷仍在）；主控合入后可按需补触达 e2e。
- **合入闸**：P2 可先开发；不得先于 P1 验收门齐验自行合入。
