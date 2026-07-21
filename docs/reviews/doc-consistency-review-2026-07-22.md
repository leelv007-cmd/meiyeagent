# 项目文档一致性复核（2026-07-22）

> 状态：**当前一致性入口**。本报告在父 Spec、G01–G48 基线、D-099 rev2、P0/P1 当前执行规格与最新代码审查快照之间做权威对账。
>
> 复核基线：文档提交 `4e53d82`；Pro Studio G01–G48 代码事实基线 `4625e4238748196a7fcb12226cb11e2c0420083b`。代码审查报告 `docs/reviews/gptpro项目深度代码审查报告0722.md` 使用独立 review worktree，属于固定代码审查证据，不在未合并时覆盖当前 `main`。

## 0. 已确认的文档治理规则

本轮采用用户确认的处置方式：旧评审、handoff、证据和历史规格保留原正文，仅增加固定提交/已取代横幅；当前入口、live Spec 和持续状态总账才承接最新口径。历史正文中的数字和结论不得被反向解释为今日实现状态。

“最后更新”按范围解释：同一决策域内，最新用户确认的决定和其 live Spec 优先；实现是否存在由当前代码、测试和与其相称的证据决定；固定提交快照只证明当时状态，不因文件后来被重新引用而变成当前事实。

## 1. 当前权威链

1. 最新用户确认与合并产品设计 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（D-001～D-099）。
2. `PRODUCT.md` 与 `CONTEXT.md` 的产品边界、术语和当前入口。
3. 当前 live Spec：
   - P0：`docs/specs/beauty-marketing-agent-p0-remediation-spec-2026-07-22.md`（#129）。
   - P1：`docs/specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md`（#130）。
   - Pro Studio：`docs/specs/pro-studio-parity-rework-spec-2026-07-22.md`（D-099 rev2，#162）。
4. 未被后续决定取代的 ADR，尤其 ADR-0010、ADR-0011、ADR-0012。
5. 当前代码、测试和同一代码基线的验收证据；实现状态以可执行行为为准。
6. 本报告与 `docs/reviews/implementation-gap-ledger-2026-07-19.md` 的 2026-07-22 增量。
7. 旧 review、handoff、evidence、research 和票体：仅作固定快照与追溯证据。

## 2. 已统一的当前事实

| 领域 | 当前口径 | 负责文档 |
|---|---|---|
| P0 | 发布可信度、统一执行主干、账本/存储/ContentPackage 等共享不变量的整改入口；不声称生产发布已通过 | P0 remediation Spec #129 |
| P1 | 结果体验、OwnedAsset/来源治理、经营闭环和产品化增量；P1 功能完成仍需全部 must-have、release Gate 与真实旅程证据，不由单一 north-star count 推导 | P1 productization Spec #130、CONTEXT Language |
| Composer | P1 日常轻编辑与营销 Task，使用 `CreationExecutionSnapshot + DBOS Harness`；不扩成无限画布 | ADR-0012、D-072～D-099、P0/P1 Spec |
| Pro Studio | 独立 workspace add-on；画布工程使用 `AdvancedCanvasProjectRevision + GenerationCheckpoint`，节点级生成不是 Composer Task，只有显式 adoption 写入 ContentPackage | D-099、Pro Studio parity rev2、ADR-0012 |
| Pro Studio parity | 原 K01–K11 handoff 仍是工程事实基线，但 K03“上游内核/parity 已完成”结论已撤销；当前执行前沿是 K1–K7，G42 Agent 对话外壳延期独立处理 | D-099、G01–G48 baseline、#163–#169 |
| 成品事实 | ContentPackage 是唯一用户成品聚合；Work/Job/Asset/画布工程是内部或过程事实，不得形成第二写口 | ADR-0011、P0/P1、CONTEXT |
| 候选呈现 | 默认一个主推荐，备选按需展开；单选采用、换一批和免费重试机制仍保留。旧“固定 3 选 1”只可作为历史回归/采用机制描述，不能作为当前前台产品政策 | D-023、ContentPackage spec、当前设计 |
| 发布状态 | 本地代码/文档完成不等于生产 Go；真实 Provider、网络、保护环境、数据处置和商业门仍需外部证据 | 最新代码审查、P0/P1 release gates |

## 3. 漂移与冲突处置矩阵

| ID | 漂移位置 | 冲突 | 处置 |
|---|---|---|---|
| DC-22-01 | `CONTEXT.md`、7/19 consistency、7/19 ledger、Pro Studio K01–K11 acceptance | 将 K01–K11 engineering DoD/旧 K03 pass 读成当前 Pro Studio parity 已完成 | 当前入口改指本报告；Context 和 ledger 增加 D-099 rev2/K1–K7 状态；旧正文保留并加历史横幅 |
| DC-22-02 | `CONTEXT.md` | 仍把 `doc-consistency-review-2026-07-19.md` 当当前入口 | 改为本报告；7/19 报告降为固定快照 |
| DC-22-03 | `docs/specs/pro-studio-kernel-integration-spec.md`、`docs/evidence/pro-studio/kernel-integration-v1-acceptance-2026-07-19.md` | K03 的“import 即挂载/内核完成”判断与 D-099 rev2 冲突 | 增加历史基线横幅；保留 K02/K04–K11 与已取证行为事实，明确 parity 结论由 D-099 撤销 |
| DC-22-04 | `docs/specs/vozeb-adoption-pro-studio-spec.md` | 原规格把 Audio 与 Agent 写成同一首发实现线，且未包含 G47/G48 和 ports 治理 | 增加 superseded 指针；领域合同与两线边界继续有效，实施以 D-099 rev2/K1–K7 为准 |
| DC-22-05 | `docs/specs/beauty-content-agent-p1-spec.md`、full-feature Spec | 旧规格仍像可直接开工的 P1/全量票源，执行上限停在 D-046 或更早 | 增加 7/22 当前执行入口和“历史 Scope/合同基线”说明，不重写需求正文 |
| DC-22-06 | `docs/handoff/ui-journey-rebuild-handoff-2026-07-20.md`、`admin-supply-handoff-2026-07-20.md` | “开放中的交付编排”容易被读成当前未合并或全部已完成 | 增加固定 handoff 横幅；当前完成度以 7/21 review、admin audit、P0/P1 Spec 和代码证据为准 |
| DC-22-07 | `.scratch/contentpackage-productization/MAP.md` | 顶部已声明 D4 固定 3 选 1 政策废止，但锁定不变量行仍写旧政策 | 修正为当前“主推荐+按需备选”；保留单选采用机制作为不变量 |
| DC-22-08 | D-099 / P0/P1 / latest code review | review worktree 的 7/22 代码审查结论与 `main` 代码基线可能被混读 | 本报告记录 review worktree 为固定证据；未合并项不得覆盖 `main`，代码状态仍按当前 commit 与同基线证据判断 |

## 4. 本轮已回写的文件

- `CONTEXT.md`：切换当前一致性入口，修正 Pro Studio K01–K11/K03 状态并补充 K1–K7 执行前沿。
- `docs/reviews/doc-consistency-review-2026-07-19.md`：增加固定快照/已被 7/22 口径取代横幅。
- `docs/reviews/p1-document-consistency-review-2026-07-11.md`、`docs/reviews/doc-consistency-audit-2026-07-15.md`、`docs/reviews/doc-consistency-audit-2026-07-16.md`、`docs/reviews/doc-consistency-audit-2026-07-17.md`、`docs/reviews/doc-consistency-review-2026-07-18.md` 与 `docs/reviews/agent-team-full-project-deep-review-2026-07-19.md`：保留历史正文，统一当前入口/取代指针至 7/22。
- `docs/reviews/implementation-gap-ledger-2026-07-19.md`：增加 2026-07-22 Pro Studio parity 增量，旧 §7.7 保留为历史审计。
- `docs/specs/pro-studio-kernel-integration-spec.md`、`docs/evidence/pro-studio/kernel-integration-v1-acceptance-2026-07-19.md`：标记旧 K03 parity 结论已由 D-099 撤销。
- `docs/specs/vozeb-adoption-pro-studio-spec.md`：指向 D-099 rev2，保留原领域合同与 release gates。
- `docs/specs/beauty-content-agent-p1-spec.md`、`docs/specs/beauty-marketing-agent-full-feature-dev-spec.md`：标注历史 Scope/合同基线和新的执行入口。
- `docs/handoff/ui-journey-rebuild-handoff-2026-07-20.md`、`docs/handoff/admin-supply-handoff-2026-07-20.md`：标注 handoff 固定快照和当前状态来源。
- `.scratch/contentpackage-productization/MAP.md`：消除与 D-023 的旧候选政策冲突。

## 5. 不改写的历史材料与残留风险

- 旧 review、research、票体和 evidence 的原始数字保留；它们只能回答“当时发生了什么”，不能回答“现在是否完成”。
- D-099 当前只冻结范围、合同、验收和票图；K1–K7 尚未形成实现证据，因此不能把票已创建或 ready-for-agent 解释为功能完成。
- P1 的 north-star count=1 是真实技术旅程证据，不等于 P1 功能完成、宣发闭环完成或可公开销售。
- Pro Studio 外部销售仍受 N2 恢复、安全、定价、升单验证、Audio/SFX activation 与真实商户证据约束。
- 需在 K1 开工前重新检查 G01–G48 代码基线；若 `apps/canvas/**`、`apps/core/src/pro-studio/**` 或共享 model-supply/result-delivery 接缝发生变化，必须重跑基线。

## 6. 复核方法与通过条件

- 权威入口、frontmatter 状态、superseded 指针和术语冲突用 `rg` 复核。
- 历史文档正文不重写，只接受顶部横幅或当前增量节。
- 当前 live 文档不得把旧 ticket close、fixture 绿灯或 review worktree 误写成生产/商业完成。
- `CONTEXT.md`、本报告、P0/P1 Spec、D-099 rev2 与 G01–G48 baseline 的 Pro Studio/P1 交界词条必须互相可追溯。
