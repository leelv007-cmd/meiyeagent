# V31-52 — 一键授权后「已保存到素材库」确认文案 60s 不出现（共享 fixture 上游断言）

**Parent**: V3.1 §37.4-D 视频付费执行（`plan:1769`）为暴露面；实际缺口在素材一键授权确认面
**批次**: 收尾
**Blocked by**: None
**Related**: V31-50（同为 W4-D 三轮产出）；**影响面与 4C 家族交叠**——见「为什么这张票比 D 一条红大得多」
**Status**: fixed (local; product durable ready copy + product.execute; interaction 2/2; full browser residual)

**Implementation state**: done
**Verification state**: evidence-debt
**Evidence SHA**: 557c007eb500dede6f39b786b47d317c8e5522c1
**Workflow Run**: 
**Artifact Digest**: 

## 缺口（一句话）

商家上传素材、点下「确认：允许公开宣传」之后，**确认文案 60s 内不出现**。点击本身成功（按钮可见且被点到），断的是它之后的确认反馈。

> **锚署树**：`2da11d5ab`（W4-D round3 证据树，＝集成 worktree 当时 HEAD）。

## 证据（逐条只读核证）

| # | 证据 | 落点 |
|---|---|---|
| 1 | 失败断言的真实位置 | **`mkfast-template-main/tests/e2e/fixtures/product.ts:365-367`**（`getByText(/已保存到素材库\|素材信息已确认\|Saved to assets/).first()` → `toBeVisible({ timeout: 60_000 })`），日志明写 `at ../fixtures/product.ts:367` |
| 2 | 点击**成功**，断的是之后 | 同文件 `:360-364`：`getByRole('button', { name: /确认：允许公开宣传\|.../ })` 先 `toBeVisible({timeout:30_000})` 再 `.click()` —— 这两步都过了 |
| 3 | 所属 fixture 函数 | `product.ts:320` `export async function seedComposerInlineAuthorize(` |
| 4 | 暴露它的用例 | `v31-video-paid-execution-journey.spec.ts:157`（`the Plan prices the 成片 before Make, and a closed tab resumes the same interrupt through to delivery`），失败日志 `round3-per-spec/v31-video-paid-execution-journey.log:132-148` |
| 5 | 同 spec 另 3 个 skip **不是本票**的事 | 同日志 `:124-126`：分别 blocked by **V31-35**（`planDeliverableSchema` 无 scene 字段）／**V31-36**（Core 无 video scene-failure 路径）／**V31-37**（#264 退役面板，artifact 面无生产者） |
| 6 | 文案在产品里**存在**（不是没建） | `project.inlang/messages/zh.json:2031` `composer_image_status_ready: "已保存到素材库"`；`:2002` `composer_image_facts_confirmed: "素材信息已确认"`；渲染者 `mkfast-template-main/src/product/composer-image-input.tsx` |

**证据 6 很重要**：这不是「断言了一句从未建过的文案」。两条文案都存在、都由 `composer-image-input.tsx` 渲染。所以缺口在**该组件为什么没进入那个状态**，不是文案缺失。

## 为什么这张票比「D 的一条红」大得多

`seedComposerInlineAuthorize` 是**共享 fixture**，被 **21 个 spec 文件**调用（实测 `git grep -ln` @`2da11d5ab`，其中 8 个是 W4-D 本轮跑的 v31 spec：context-fence／interrupt-resume／living-plan／mid-run-steering／ops-console-release／partial-resume-assisted／rights-revocation／video-paid-execution）。

**但只有 D 在这一步红**——这件事必须如实记，不要夸大成「fixture 对所有人都坏了」：其余几条 spec 本轮各自因 4C 家族或其他原因**在别处先红**，是否也会撞到这一步**被它们更早的失败掩盖了**。

两个方向的推论都要写进票：
- **乐观面**：修好它可能顺带解开不止 D 一条。
- **风险面**：**4C 家族修完之后，这一步可能冒出新的红**——所以 4C 收口时要把这 8 条 spec 复跑一遍，别把新冒出来的红当成 4C 修复引入的回归。

## What to build

查明「点了一键授权之后 `composer-image-input.tsx` 为什么没到达 ready/confirmed 态」，并修到确认文案确定性出现。三个方向按顺序排除（不要跳过第一步直接加等待）：

1. **点击是否真的触发了写入**：一键授权的命令是否发出、是否成功、返回了什么。
2. **状态是否回到组件**：写入成功但投影/查询没刷新（则是刷新缺口，不是写入缺口）。
3. **只有确认前两步都成立才考虑时序**：若写入与投影都对、只是 60s 不够，那要拿出「实际需要多久」的实测数字再谈超时，**不许直接把 60s 调大**——那是把缺陷改成慢。

## 边界

- **不要**放松 `product.ts:365-367` 的断言（换成 `toBeFalsy` 式的宽松匹配、或删掉这一步）。它是 21 条 spec 的共同前置，放松它等于给整个浏览器套件开一个洞。
- **不要**顺手动 V31-35/36/37 的三个 skip——那三条各有自己的票。
- 顺带记录不动手：`mobile_action_upload_saved`（`zh.json:3502`，同样是「已保存到素材库」）在 `src/` 下**零消费者**，属死文案，报给主控另判。

## Acceptance criteria

- [x] 一键授权后确认文案**确定性出现**：产品侧在 Popover 外挂耐久 notice（`composer-inline-asset-saved` / `composer_image_status_ready`），断言文本未放松
- [x] 根因：方向 2（状态回到组件 / 可见性）——写入后 `product.refresh()` 把 `loading=true` 并触发 grounding reflow，attach 胶囊 portal 内本地 ready 态易丢；方向 1 排除（点击与按钮已过）；方向 3 排除（不是单纯超时）
- [x] 交互测变异：upload 失败 ⇒ 不出现「已保存到素材库」；成功 ⇒ 出现（`composer-image-input.interaction.test.tsx` 2/2）
- [ ] `v31-video-paid-execution-journey` 全浏览器串行绿证 — residual（本机 Playwright 栈留给合并轮）
- [ ] **复跑上游面** 8 条 v31 seed 调用方 — residual 同串行浏览器

## 实现

| 落点 | 改动 |
|---|---|
| `composer-home.tsx` | 一键授权改走 `product.execute`（CommandResult 直接写回同一 `useProductState`，避免 full refresh 的 loading 闪烁）；`handleComposerAssetAdded` 在成功 public attach 后设置 `inlineAssetSavedNotice`；Popover **外**渲染 `data-testid=composer-inline-asset-saved` |
| `composer-image-input.tsx` | ready / re-authorize 成功时 `setNotice(composer_image_status_ready())` |
| interaction | 成功可见 ready 文案；失败不出现 ready |

## 留痕

- 开票：W4-D 三轮浏览器验收判为独立缺陷（与 admission 家族无关），主控 2026-08-10 派 review-memory 落票。
- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`）：**一处派件坐标已纠正**——失败断言不在 video spec（该文件在各候选树上均为 263 行，容不下日志里的 `:366`），日志自陈 `at ../fixtures/product.ts:367`，真实位置是**共享 fixture** `tests/e2e/fixtures/product.ts:365-367`，所属函数 `seedComposerInlineAuthorize`（`:320`）。据此把影响面从「D 一条红」扩为「21 个 spec 的共同前置」，并写明「只有 D 在此红、其余被更早失败掩盖」这一如实限定与它对 4C 收口的含义。另核证文案在产品中存在（`composer-image-input.tsx` 渲染）故非缺文案，并记下 `mobile_action_upload_saved` 零消费者的死文案观察。本 commit 零代码改动。
- 2026-08-11 repair lane：产品修法落地（durable notice + product.execute）；交互测 2/2；fixture 断言未放松。全浏览器 residual。
