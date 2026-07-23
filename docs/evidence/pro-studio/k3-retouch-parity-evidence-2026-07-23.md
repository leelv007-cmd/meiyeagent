# K3 图片精修对标（G26–G31）分层验证证据（2026-07-23）

状态：`local candidate / layered verification`。代码基线 `canvas-k3-residual`（起于
`main@d6787b29`）。本记录只覆盖 Issue #165（PRO-K3）残差，未 push、未改远端 Issue
状态；`MODEL_EXECUTION_MODE=fixture`。真实 live 发布证据仍归 #119 / #146。

## 背景：#165 残差的真实面貌

#165 于 2026-07-22 以 PR #184 部分落地后被 reopen。复核 `d6787b29` 基线发现：六个
精修弹窗与后端通路**其实已经实现**（`retouch-dialogs.tsx` 的 CropDialog / MaskDialog /
UpscaleDialog / SplitDialog / AngleDialog + `retouch-generation.ts` 的 image.edit /
text.respond 通路），selection toolbar 已暴露全部六操作 = **能力已生产可达**。真实
残差是**缺浏览器证据**（此前只有 crop 有 e2e），不是缺功能。inventory 曾误报的
`graph-bridge.ts` "持久化丢字段"经核实为**误判**（`CanvasNode.data` 是开放
`Record<string, JsonValue>`，`z.record` 不过滤，`retouchRole/retouchKind` 全程透传）。

## 分层验证策略（用户 2026-07-23 拍板）

- **crop / upscale / split（G26/G28/G29）= 浏览器纯变换**，不依赖模型能力 → 完整 e2e。
- **mask / angle / reverse（G27/G30/G31）= GenerationJob**，需 `image.edit` / `text.respond`
  能力激活。e2e 平台默认供给只 seed 四个 `*.generate/*.speech` operation（见
  `workspace-provision.ts` `PREFERENCE_OPERATION_BY_CONFIG_KEY`），**不含 image.edit /
  text.respond**；fixture 无 live 证据，诚实纪律下这两个能力本就**未激活**。故采分层
  验证：逻辑（纯函数）+ UI 挂载 + 诚实降级 e2e 全证，**完整 job 浏览器流程记为需真实/
  recorded 供给环境的缺口（与 #119 同源）**，不伪造能力激活。

## G26–G31 证据矩阵

| G | 能力 | 通路 | 逻辑（纯函数） | UI/浏览器 | 结果 |
|---|---|---|---|---|---|
| G26 | 交互裁剪 | 浏览器 pure crop | `retouch-crop.test.ts`（8向手柄拖动/比例锁几何）、`retouch-adapter.test.ts`（crop 血缘） | **test1 e2e**：dialog + 8 手柄 + 实时像素 + 比例锁 → 派生子节点 + derive 边 | ✅ 完整 |
| G28 | 1K/2K/4K 放大 | 浏览器 pure upscale | `retouch-adapter.test.ts`（`resolveUpscaleSize` 纯度 + upscale 血缘） | **test1 e2e**：选 4K 目标 + 算法 → 派生子节点 | ✅ 完整 |
| G29 | 网格切分 | 浏览器 pure split | `retouch-adapter.test.ts`（`layoutSplitChildren` + split 血缘/部分失败） | **test1 e2e**：2×2 网格预览 → 4 派生子节点 | ✅ 完整 |
| G27 | 局部蒙版重绘 | `image.edit` GenerationJob | `retouch-generation.test.ts`（mask 冻结 image.edit 合同 + 拒绝非 mask 绑定 + role fail-closed）、`retouch-adapter.test.ts`（mask 血缘） | **test2 e2e**：MaskDialog 可开（UI 挂载）+ 能力诚实标"未激活" | ⚠️ 分层（job e2e 缺口） |
| G30 | AI 多角度 | `image.edit` GenerationJob | `retouch-generation.test.ts`（angle 归一化有界 + prompt 表达且**无 angle 参数泄漏**） | **test2 e2e**：AngleDialog 可开 + 能力诚实标"未激活" | ⚠️ 分层（job e2e 缺口） |
| G31 | 反推提示词 | `text.respond` GenerationJob | `retouch-generation.test.ts`（reverse 只用 text.respond + config 节点持久标记） | **test2 e2e**：反推入口可达 + 能力诚实标"未激活" | ⚠️ 分层（job e2e 缺口） |
| — | 血缘刷新不丢 | 服务端持久 | — | **test1 e2e**：save→reload 后 7 节点 / 6 边全恢复 | ✅ |
| — | 诚实降级 | 能力选择 fail-closed | `retouch-generation.test.ts`（`activeRetouchCapability`：缺失/inactive → RETOUCH_OPERATION_UNAVAILABLE，仅 active+operation-exact 才选） | **test2 e2e**：先 provision 激活 image.generate → 面板**区分** image.generate"可用" vs image.edit/text.respond"未激活"（证真实逐能力供给非全灰，K4 test2 交叉印证）+ "非假可用"横幅可见 | ✅ |

## 命令结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm --filter @meiye/canvas test` | 通过：273 pass / 0 fail / 1 skip | 含新增 `activeRetouchCapability` 诚实降级单测；skip 为 trusted payment 条件测试。 |
| `pnpm --filter @meiye/canvas typecheck` | 通过 | `tsc --noEmit`。 |
| e2e `pro-studio-retouch.spec.ts` test1（G26/G28/G29） | 通过：1 passed | 四服务真机 + 隔离 PG（`meiye_k3_retouch`）+ fixture；交互裁剪/4K放大/2×2切分各派生子节点、血缘刷新不丢。 |
| e2e `pro-studio-retouch.spec.ts` test2（诚实降级 + 逐能力区分） | 通过：1 passed | 先 provision 激活 image.generate"可用"、面板区分其与未激活的 image.edit/text.respond（非全灰）；mask/angle dialog 可开、反推入口可达 + "非假可用" 横幅。 |

## 完整 job e2e 缺口（诚实登记，与 #119 同源）

G27/G30/G31 的**能力激活后完整 job 浏览器流程**（提交 → 报价 → GenerationJob →
插入子节点/config 节点）未在本轮 e2e 覆盖，根因：e2e 环境未激活 `image.edit` /
`text.respond`（平台默认供给不 seed 这两个 operation）。这与 #119 官方渠道 live 连通门
同源——属于"需真实/recorded 供给环境"的范畴，非 UI 缺陷。补齐路径：为 e2e seed 一个
覆盖 image.edit + text.respond 的 recorded 供给（gpt-image-2 已声明支持 image.edit），
再扩 test2 走完整 job → 派生节点断言。

## 证据文件

- e2e：`mkfast-template-main/tests/e2e/specs/pro-studio-retouch.spec.ts`（新增，2 test）
- 纯函数：`apps/canvas/src/kernel-host/retouch-generation.test.ts`（新增诚实降级用例）、
  `retouch-crop.test.ts`、`retouch-adapter.test.ts`（既有）
- 实现（既有，本轮未改）：`retouch-dialogs.tsx`、`retouch-generation.ts`、
  `retouch-adapter.ts`、`kernel-canvas-surface.tsx`
