# 积分制计费实施轮 — 中控交接书（收口态）

> **2026-08-04 收口**：本文由开工交底改写为**已落地产品事实**说明。  
> 实现权威仍是 `docs/specs/credit-billing-spec-2026-08-01.md`；合入唯一凭证＝`docs/ops/merge-ledger.md`。  
> 历史开工口吻（#298 在飞、未 push 等）作废，以本节「当前状态」为准。

## 一、角色与主权（仍适用）

主控（总控）仍是验收、合入 main、关票、修订 spec 的唯一主权方。lane 不 push、不关票、不动 main。

- 「已合入」唯一有效凭证＝`docs/ops/merge-ledger.md` 对应 sha 行（该文件只由主控提交）。
- 裁决评论前缀「主控裁决」「依赖更新」「主控合同增补」裸写在正文首字符。
- §11.6：不落票下评论＝不存在。

## 二、当前状态（2026-08-04）

**权威链（已闭合，勿重开计量/通道决策）**：

- 产品决策＝设计日志 **D-172**（supersedes D-123 条数计量 / D-044 试用条数 / D-045 条数语义 / ADR-0016 三桶单位 / Creem 口径；**D-061 双真相不废**）。
- 实施权威＝`docs/specs/credit-billing-spec-2026-08-01.md`（§9 验收门、§11 纪律）。
- 冲突序：spec 终稿 > 票资解（#290–#295）> 票面。

**票局（全部 CLOSED）**：

| 范围 | 状态 |
|---|---|
| #297 CB-0 Waffo 人工前置 | CLOSED |
| #298 L1 账本与合同 | CLOSED + ledger |
| #299–#302 lane 父票 | CLOSED（子票齐） |
| #303–#311 CB-01…CB-09 实施子票 | CLOSED + ledger |
| #312 CB-10 §9 十一门回归 | CLOSED（验证轮，无产品 commit） |

关键路径已走完：`#298→#304→#308→#309/#310→#311→#312`。

**git**：

- 收口 tip（#312 验收 ledger 行对应产品态）：`afd05adf`（`docs(ops): record issue 312 acceptance`）。
- main 已与 `origin/main` 对齐（用户授权 push 后）。

**代码纪律（现行）**：

- 运营键族＝**`plan.credits.*` only**（trial/starter/growth/pro、addons、cycle_coefficients、reference_numbers、trial.enabled）。
- **`plan.allowances.*` 已退役**（admin 注册与生产热读清零；#311）。
- 积分账生产写入＝P1 only；P0 `ProductService` 生产装配 `legacyBillingReadOnly: true`。
- 支付＝**Waffo Pancake**；**Creem 已退役**（retirement audit fail-closed）。
- 价格页＝积分卡阵（周期切换 + 四档 + 参考「仅供参考」+ 加油包锚点）。

## 三、验收遗产（不必重跑除非 tip 再变）

- §9 十一门证据汇总：#302 终验评论（#312 触发）。
- 每张实施票合并前唯一 journey 记录在各自关票评论 + merge-ledger 行。
- 完整 journey 在 tip 变化后仍须按 §11.5 重跑才可再合产品变更。

## 四、凭据与环境

- Waffo **测试**凭据＝`docs/_private/waffo.env`（gitignored）；只准 env 注入，禁止进代码/评论/commit/argv。
- 测试卡（历史核销用）＝`4576750000000110`。
- **未**默认开通 Waffo **生产**环境；生产侧仍属远期运营动作（见下节）。

## 五、并发与本机假红纪律（仍适用）

locale:compile 冲突、e2e-lock argv 秘密、占槽 ≤3、宿主退化判红顺序等：仍以 `docs/ops/agent-dispatch-runbook-2026-07-29.md` 与 `docs/ops/local-e2e-host-degradation-runbook-2026-08-01.md` 为准。credit-billing 实施波次已结束，日常开发仍可能多 worktree 并行。

## 六、收口后待办（非实现阻塞）

1. **Waffo 生产环境**开通与复验（spec §5.4 生产侧）——运营/供给动作，非 #298–#312 实现缺口。
2. 其它旧账（#280 PWA、#146 live 门、#240 运营窗等）勿与 credit-billing 混绑。
3. 新计费需求：开新票，**禁止**复活 `plan.allowances.*` / Creem / 三桶扣费。

## 七、信息索引

| 要什么 | 去哪 |
|---|---|
| 产品决策原文 | 设计日志 D-172 |
| 实施/验收门/纪律 | credit spec §1–§9 / §11 |
| 合入台账 | `docs/ops/merge-ledger.md` |
| §9 终验报告 | GitHub #302 评论（#312 关票时） |
| 条数退役清单（历史） | #291 资解；落地＝#311 |
| Waffo 集成事实 | #290 / #297；实现＝#304/#308 |
| 通用纪律 | `docs/ops/agent-dispatch-runbook-2026-07-29.md` |
| 供给清单（积分种子） | `docs/ops/provisioning-manifest.md` C-1 |
