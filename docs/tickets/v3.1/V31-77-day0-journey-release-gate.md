# V31-77 — Day-0 零素材首访旅程升格为 release gate：门内 fail-fast 首位 ＋ 种子掩码纪律可执行化

**Parent**: `docs/reviews/v31-batch-retrospective-2026-08-13.md` §4 R1（用户 2026-08-13 拍板）
**批次**: 待排（改约票，优先级高于一切功能票）
**Blocked by**: 无（与 V31-76 并行；本票只改门与静态契约，不修产品红）
**Related**: V31-73（零素材 spec 来源）、V31-54（seed 掩码根源与「发现≠回归」规则）、V31-29（常驻静态契约先例）、V31-64（NOT evaluated 判据，fail-fast 语义复用）

**Status**: open（2026-08-13）— 改约票，未派工

**Implementation state**: not-started
**Verification state**: not-started
**Evidence SHA**: 0487afd99e724d6ca9ac3e0fccdecf3a32126ca0
Evidence 注：开票锚树
**Workflow Run**:
**Artifact Digest**:

## 缺口（一句话）

「零素材新商家首访 → 提交 → 拿到成品」从未是任何验收门的问题，V31-73 的确定性死路
因此在 e2e 全绿下不可见；本票把这条旅程钉成 v3.1 的首要 release gate，并把「day-0 类
spec 禁用提交门种子」从注释约定升级为可执行契约。

## What to build

1. **门内 fail-fast 首位**：`scripts/ci/run-v31-browser-acceptance.sh` 的 `v31_specs`
   目录里，`v31-zero-source-image-text-first-visit.spec.ts` 移到首位并单独先跑：
   它红 ⇒ 整门立即红，其余 spec 按 V31-64 语义记 `not_evaluated`（day-0 不可用时，
   其余旅程绿证没有 release 意义）；它绿 ⇒ 继续现有目录顺序。评语注明这是
   retro R1 的刻意排序，不是字母序。
2. **种子掩码纪律可执行化**：新增常驻静态契约测试（先例：V31-29 的
   `src/lib/e2e-ui-journey-truthfulness.test.ts`），断言 day-0/首访类 spec 文件
   （首批锚定：`v31-zero-source-image-text-first-visit.spec.ts`、
   `v31-day0-free-creation-journey.spec.ts`、`uiux-creation-loop.spec.ts`、
   `dashboard-home-mount.spec.ts`）不 import / 不调用 `seedComposerInlineAuthorize`
   （注释提及不算命中）。清单显式列举（同 `v31_specs` 的目录哲学：新增豁免必须
   动清单文件并在票面留痕，不允许静默漂移）。挂进现有静态质量门使之 required。
3. **release 边界回写**：`docs/ops/current-project-status.md` 的未完成清单加入
   「Day-0 旅程门绿」为 release-ready 前置条件（本票开票同轮已由主控写入，实施时核对
   仍在即可）。

## 边界与禁止修法

- 不修任何产品红：`uiux-creation-loop:101`（remix）归 V31-76，本票的 fail-fast 不
  依赖它先绿——zero-source spec 当前本地 1/1 绿（V31-73 Evidence）。
- 不动 `seedComposerInlineAuthorize` 本体与其合法消费者（K 旅程等 10 个 spec 继续
  合法使用；本票只禁 day-0 类清单内文件）。
- 不放宽/改写 zero-source spec 的断言强度（0 submissions POST、无确认卡、无重试文案
  三断言是门的牙齿）。

## Acceptance criteria

- [x] zero-source spec 在门内首位先跑；人为改红它（本地变异，如临时改断言）时整门红且
      其余 spec 记 not_evaluated；还原后整门恢复
- [x] 静态契约测试落地：清单内任一文件加入 seed import 时测试红（变异反证），还原绿
- [x] 静态契约挂进 required 静态门（与 V31-29 契约同一挂点）
- [x] `pnpm check` / `pnpm typecheck` / 门脚本 shellcheck（如仓内有约定）干净
- [x] CURRENT 的 release 前置条件含「Day-0 旅程门绿」且与实现一致

## 实施记录（2026-08-13 主控）

**「首位」不是排序问题**：Playwright 按发现到的文件路径序走，不按命令行给出的顺序。本轮
门跑实证——目录首位写的是 day-0 自由创作，实际第一个跑的是 `v31-82`。所以 fail-fast 只能
靠**独立先跑一次**实现，目录里的位置只是让清单读起来和门跑起来一致。

判决书按 V31-64 形制：`DAY-0 RELEASE GATE RED: <spec> failed — remaining 23 specs NOT
evaluated;` ＋ day-0 证据路径 ＋ 逐条列出未评估 spec，落 `day0-gate-not-evaluated.log`。

变异反证（真跑，非桩）：临时把 zero-source 的 `本次用量已确认` 断言由 `toHaveCount(0)`
改 `(1)` → 门 exit 1、`playwright-v31-browser-acceptance.log` **根本没生成**（第二段从未
发起）、not-evaluated 清单 23 条齐；还原后 day-0 单跑 1 passed（49.3s）。

静态契约 `mkfast-template-main/src/lib/e2e-day0-seed-discipline.test.ts` 三条：清单文件存在／
被禁 helper 仍存在（防改名后契约空绿）／清单内不得 import 或调用（先剥注释——zero-source
自己的头注释就点名了这个 helper）。变异反证：给 `dashboard-home-mount.spec.ts` 加一行引用即红。
挂点＝web 包 `pnpm test` 的 `src/**/*.test.ts` glob，经 root `pnpm test` → `run-root-required-quality.sh`
进 required，与 V31-29 契约同一条路。

门契约同步进 `scripts/ci/quality-gates.test.mjs`：两段调用的精确序列 ＋ 新增「day-0 红则第二段
不发起」用例 ＋ 判决书措辞三条 assert。`node --test scripts/ci/quality-gates.test.mjs` 15/15 绿。

## 留痕

- 开票：2026-08-13 主控，V3.1 批次 retro（§4 R1）落地票。R2（旅程票先行）/R3（冻结与
  清红队列）/R4（批次减半）为流程改约，不需要代码票，原文在 retro §4，执行事实在 CURRENT。
