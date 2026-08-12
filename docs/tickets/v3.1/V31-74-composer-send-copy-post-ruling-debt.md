# V31-74 — Composer 发送键与 hint 文案仍承诺「流内问店」：08-12 分权裁决后的文案债（承诺与行为脱节）

**Parent**: dashboard 首访旅程实测（2026-08-13 主控亲验）；上游裁决＝V31-28「2026-08-12 深夜 免费 copy 腿裁决」（Brief 高危确认＝知情继续 consent，方案期提问＝非高危补充征询 supplement，按 prompt 形态分权、不叠加）
**批次**: 待排（首访旅程）
**Blocked by**: 无（与 V31-73 无实施依赖，可并行；文案落点有一处重叠见下）
**Related**: V31-28（裁决原文）、V31-73（同一旅程的 P0 死路）、V31-75（展示层收尾包）

**Status**: implementation-complete / release-verification-pending（2026-08-13）— grok lane 实现＋主控亲验（静态 33/33、interaction 17/17、变异反证、tsc/biome、dev 真浏览器复核），余 required CI；`:212` e2e 断言首执行被 V31-76 红 1 挡住（residual）

**Implementation state**: done（main@2284ecb0 实现＋2bfa196e test-contract 解封）
**Verification state**: locally verified（见 Evidence 补记）；`uiux-creation-loop:212` e2e 轴 residual（blocked by V31-76 红 1）
**Evidence SHA**: 2284ecb0／2bfa196e；缺陷取证基线 39ca4b399361a9226848c71009d3d6500612ce2c
**Workflow Run**:
**Artifact Digest**:

## 缺口（一句话）

促销/缺价类 prompt 下，发送按钮 label「先补门店信息」与 hint「门店信息还差几条：点发送我先问这几条，补完接着生成」仍是旧「流内问店」设计的遗留——08-12 裁决后该类 prompt 走 Brief 知情继续→deliver-first、**设计上不再问店**，用户被旧文案许诺了一个已不存在的流程，这是「旅程很怪」体感的直接来源之一。

## 证据

| # | 证据 | 落点 |
|---|---|---|
| 1 | 文案落点 | `mkfast-template-main/src/product/composer/composer-home.tsx:459-460`（`label: '先补门店信息'` ＋ hint 原文） |
| 2 | 行为权威 | V31-28 票「2026-08-12 深夜」节：促销缺价 prompt 一律 Brief 高危确认（商家不输入信息）→ deliver-first；方案期提问只留给泛化模糊 prompt；image_text 执行内 interrupt 另算 |
| 3 | 实测脱节 | 主控亲验：点「先补门店信息」→ 无任何问店卡 → 直接出「确认本次创作」Brief 卡（待确认项＝价格缺失，商家无输入位）→ 确认后进入执行（本轮撞 V31-73 的 400，另票） |
| 4 | 方位词错误 | 未选类型时 hint「还没选创作类型：在**上面**的『创作类型（必选）』里选一个」——选择器实际位于输入框**下方** |
| 5 | 状态文案打架 | 「还差一点信息才能算这次花多少，补齐后会自动更新」与「本次用量已确认」可同屏并存（两个状态源各说各话；溢出布局归 V31-75，本票只管互斥语义） |

## What to build

1. 按分权裁决重写发送键三态文案：
   - 促销/缺价类（触发 Brief 高危确认）：label/hint 描述真实流程——「发送后先跟你核对一遍关键信息，确认了就开始」一类的 consent 语义，不再说「先问这几条、补完接着生成」。
   - 泛化模糊类（方案期 clarification）：hint 描述「我会先问一个方向问题」。
   - 常规可直跑：普通发送语义。
2. 修正方位词（或改为不依赖方位的指称，如直接高亮目标控件）。
3. 「还差一点信息才能算」与「本次用量已确认」互斥渲染，单一状态源。

## 边界与禁止修法

- 只动文案与其渲染条件，**不动**提问分权行为本身（那是 V31-28 已锁裁决）；若实施中发现文案无法诚实描述行为，停手报主控，不得反向改行为迁就文案。
- live 模型路线「Brief 确认过的缺口不再重问」属提示词调优（V31-28 follow-up 已记），不进本票。

## Acceptance criteria

- [x] 促销 prompt：label=「先核对信息」、hint=「发送后我先核对这次要用的信息，需要确认的会先问你。」——consent 语义，无「问店」承诺（dev 真浏览器复核＋静态测试钉住）
- [x] 泛化模糊 prompt：采用**中性诚实文案**方案（前端不区分 prompt 形态——分流在 Core 方案期，前端造启发式=行为变更，任务书明令禁止）；同一句对 Brief consent 与方案期提问两形态均为真
- [x] 方位词修正：lens hint 删「在上面的」（`composer_submit_lens_required_hint`）
- [x] 用量两条状态互斥：收敛进 `resolveComposerQuoteUsageLine` 单一决策（quote-readiness.ts；变异反证 2 红→还原 22/22）
- [x] 测试同步不弱化：静态 33/33、interaction 17/17、biome、tsc 全绿；4 个 e2e spec 断言同步为新文案

## Evidence 补记（2026-08-13 主控亲验，实现树 2284ecb0＋2bfa196e）

- 执行过程：grok lane 自述「接下来按任务书提交」后未 commit 即退出（已知形态二次复现）；验证与 commit 主控亲落
- `uiux-creation-loop:212`（e2e 轴的「先核对信息」断言）仍未执行过：该用例死在 `:205` 的 remix 重定向红（V31-76 红 1）；V31-76 关票时须回写首执行结果
- 解封连带：修 6 处空态标题 h3→h2 与 1 处按钮名（2bfa196e），`:245` 转绿；暴露的两条既有红开 V31-76

## 留痕

- 开票：2026-08-13 主控首访旅程亲验发现三层脱节（按钮名≠按钮行为≠hint 承诺）；核 V31-28 裁决原文后定性为文案债而非行为缺陷，单独成票避免混进 V31-73 的产品决策面。
