# 项目文档一致性复核（2026-07-19）

> **固定快照 / 已被 2026-07-22 口径取代**：本文保留 2026-07-19 的审计事实与处置记录，不再作为当前一致性入口。当前入口是 [`doc-consistency-review-2026-07-22.md`](./doc-consistency-review-2026-07-22.md)。其中 Pro Studio K01–K11 engineering DoD 与 K03 pass 只表示当时的工程票据结论；D-099 rev2 已撤销 K03 的上游 parity 完成判据，当前执行前沿改为 K1–K7（#163–#169）。

- 基线：`main` @ `e3032b0`
- 规则：最新提交决定“当前实现了什么”；未被明确 supersede 的产品目标与开放决策继续有效
- 历史策略：评审报告、研究材料和证据快照保留原文，只补充固定提交/已取代提示
- 范围：根目录活文档、`docs/specs/`、`docs/adr/`、`docs/handoff/`、`docs/reviews/`；`references/` 与 `docs/evidence/` 只核权威误用和链接，不改快照正文

## 1. 当前权威链

1. 最新用户拍板与 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md` D-001～D-046
2. `PRODUCT.md`（产品目的与边界）+ `CONTEXT.md`（术语和当前权威入口）+ `DESIGN.md`（视觉合同）
3. 已接受且未被修订取代的 ADR
4. 当前规格、代码与测试；实现状态冲突时，以最新提交的可执行行为和测试为准
5. `docs/reviews/implementation-gap-ledger-2026-07-19.md`（持续更新的实现状态总账）
6. 固定提交评审、handoff、证据和研究材料（只作追溯，不作当前状态）

机器票图、GitHub issue 开闭状态、旧分支名、单次测试数字或 fixture 截图均不能独自推翻上述权威链。

## 2. 最新提交事实

| 事实 | 当前结论 | 代码/测试锚点 |
|---|---|---|
| D-046 result 自由文本调整 | 已实现：提交后派生新 Work，继承并自动确认 Brief，保留 `sourceWorkId` 血缘并自动启动 Harness；不新增消息持久化实体 | `unified-creation-workbench.tsx`、`unified-creation-workbench-fold.test.ts`、`creative-work.test.ts` |
| Day-0 平台默认供给 | 已实现：trial allowance 大于 0 的模态必须有有效默认绑定；零额度模态未配置时跳过，配置后仍校验并落偏好 | `workspace-provision.ts`、`workspace-provision.test.ts` |
| UX 折叠与供给票包 | T1～T6、Ta～Td、V1 已完成；GL-23 仍是 P2 UX | UX 规格、Day-0 evidence、实现总账 §7.7 |
| Pro Studio K01～K11 | engineering DoD 已完成；不等于公开发售批准 | K01～K11 STATUS、kernel V1 acceptance |
| 发布状态 | 仍不可宣称 P1 功能完成、可试点、可面世或宣发闭环 ≥1 | 实现总账 §7.7 与现行 release gates |

## 3. 本轮发现与处置

| ID | 漂移 | 处置 |
|---|---|---|
| DC-01 | `CONTEXT.md` 仍把 07-18 一致性报告和 `1656da7` 深审作为当前入口，决策上限停在 D-042 | 当前入口改为本报告 + 实现总账，权威上限同步 D-046 |
| DC-02 | `CONTEXT.md` 仍写阶段诊断 D11/D12 管理后台“待实现” | 按当前 admin-config 代码改为已落地；生产激活与发布门独立保留 |
| DC-03 | 07-19 深审仍把 D-042 修复写成“未合 main” | 不改原评审正文；顶部标记为 `1656da7` 固定提交快照并指向当前总账 |
| DC-04 | 07-18 consistency / implementation / walkthrough / ticket review 容易被误读为当前状态 | 各自补历史快照横幅，保留原数字和判断 |
| DC-05 | WT-1～WT-4 handoff 仍以“读完即可开工”口吻存在 | README 与四份 handoff 标为已完成的历史交付编排，禁止据此重开分支 |
| DC-06 | P1 / full-feature / ContentPackage 规格的决策上限停在 D-038～D-042 | 活规格叠加更新到 D-046；需求正文保留，实施状态转为 maintenance / release-gated |
| DC-07 | Pro Studio 与 UX/供给规格没有传达已完成工程票与仍开放商业/发布门的区别 | 补 implementation status；K01～K11 与 T/供给票不再显示成待开工 |
| DC-08 | 实现总账顶部仍只显示初始 `9788f20` 与已合并工作分支 | 分开记录初始/当前基线，当前指向 `e3032b0` 和 `main` |
| DC-09 | 术语表缺少 D-046 与 GL-22 的稳定语义 | 新增“流内自由追问口”“Day-0 平台默认供给”，明确非聊天真相层与正额度模态规则 |

## 4. 有意不改

- 未重写任何旧评审正文、证据数字、研究结论或历史票体；它们描述各自固定提交。
- 未新建 ADR。本轮没有新增跨组件、长期且难逆的架构决定，只是把已接受的 D-043～D-046 与当前实现传导到活文档。
- 未把开放 release gate 写成已完成。GL-23、GL-25、GL-26、GL-27、真实支付/视频运营/远程 CI 等环境门，以及 Pro Studio 五项商业门继续开放。
- 未把工程完成外推为产品/商业完成；真实跑通链路数 1 也不等于宣发闭环数 1。

## 5. 后续引用规则

- 查“产品要做什么”：读产品设计权威 D-001～D-046。
- 查“现在实现到哪里”：先读实现总账，再看最新代码和对应测试。
- 查“当时为什么这样做”：读 ADR、固定提交评审、handoff 和 evidence。
- 任何后续提交改变当前行为时，先更新实现总账；只有产品边界或长期架构决定变化时，才更新产品决策或 ADR。

## 6. 验证

- `git diff --check`：通过
- 本轮 18 份变更 Markdown 的本地链接解析：通过，0 缺失
- 活文档范围 125 份 Markdown 的本地链接解析：通过，0 缺失（抓取快照中的站内路由、镜像未入库源码锚点不计为项目活链接）
- `node scripts/uiux/decision-ticket-guard.mjs`：通过（UIUX 10 decisions / ContentPackage 13 decisions）
- `node --test scripts/uiux/decision-ticket-guard.test.mjs`：10/10 通过
- 权威漂移检索：活文档中不再存在把 07-18 consistency、`1656da7` 深审、已合并 handoff 或 D-038～D-042 上限当作当前实现入口的未标注引用
