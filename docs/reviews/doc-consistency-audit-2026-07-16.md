# 文档一致性全面复核 — 2026-07-16

> **SUPERSEDED as consistency entry (2026-07-17)**  
> 当前一致性入口：`docs/reviews/doc-consistency-audit-2026-07-17.md`。  
> **北极星 / D01 测量**以 `docs/evidence/contentpackage/README.md` 与 `CONTEXT.md` Language 为准（**真实跑通链路数 = 1**，`real-run-0001`）。  
> 本文件正文中「链路数仍为 0 / D01 仍为 0」是 **2026-07-16 当日快照**，不得再当活源。  
> **仍可引用**：§二 B1–B14 的 Pro Studio 两线边界与术语裁决（在与 07-17 / ADR-0012 不冲突的范围内）。

状态：**历史收口记录；非当前一致性入口**

本轮使用 `grill-with-docs` 的 `/grilling` 与 `/domain-modeling` 规则，结合两路并行只读审计、当前代码/测试和最新文档完成复核。用户已确认的产品边界是：**P1 Composer 收窄为日常轻编辑；无限画布、高阶精修、TTS+音效、画布 Agent 归入 Pro Studio 独立加购线**。

## 一、当前权威顺序（2026-07-16 当日；入口已迁走）

1. 当前 HEAD 的代码、测试与真实运行证据；
2. `CONTEXT.md` 与**当时**本报告（现由 07-17 报告接棒）；
3. `docs/adr/0012-two-lane-pro-studio-overlay.md`（两线边界）；
4. `references/analysis/vozeb-方案合集-2026-07-16.md`（评审主入口）；
5. `docs/specs/vozeb-adoption-pro-studio-spec.md` rev2（Pro Studio 工程合同）；
6. `docs/specs/contentpackage-productization-spec.md` + ADR-0011（ContentPackage 唯一成品）；
7. `docs/specs/beauty-content-agent-p1-spec.md`（P1 主线 Scope）；
8. 旧 P0、07-15 Vozeb 研究、07-15 一致性报告、rev2 前的复核报告与 canvas 草案均是历史证据，不能覆盖以上口径。

## 二、已裁决并落文档的冲突

| 编号 | 冲突/偏差 | 当前裁决与落点 |
|---|---|---|
| B1 | P1“自由画布”与 Pro Studio 无限画布重叠 | P1 改为 Composer 日常轻编辑；无限画布/精修/TTS+SFX/Agent 只在 Pro Studio。见 `CONTEXT.md`、P1 spec、ADR-0012。 |
| B2 | Pro Studio “并行”与“按证据触发”互相矛盾 | 主线后端/深层能力继续 evidence-triggered；Pro Studio 是唯一批准的产品面并行例外。见主方案 §5/§8。 |
| B3 | 共享资源“不碰撞”与实际会改 contracts/core/PG/wiring 矛盾 | 客群/DoD/发布面分离，但共享文件必须登记 owner、contracts-first 顺序和冲突处理。见 ADR-0012、Pro Studio MAP。 |
| B4 | Canvas 事实 owner 不明 | `AdvancedCanvasProject + revision` 为独立服务器规范图；页式 `画布作品/WorkRevision` 仍归 Composer/Polotno；只有 adoption 回写 ContentPackage。 |
| B5 | HostBridge 被写成首发必需 | 首发独立同页子域仅依赖 BackendPort；HostBridge 只在 iframe/opener 形态启用，需额外 origin/nonce/schema 合同。 |
| B6 | workspace 列表/新建没有 projectId，却要求 project 绑定启动码 | 冻结两种 bootstrap audience：workspace-level（列表/新建，逐 action 校验）与 project-level（带 projectId，校验项目归属）。 |
| B7 | adoption 幂等 target 与业务唯一性冲突 | identity 固定为 `projectId + resolvedRevisionId + normalizedSelection`；`orderedMediaNodeIds` 保留顺序、不排序；无论 new/existing target 重复提交均返回首次结果或 `ADOPTION_ALREADY_EXISTS`，零副作用。 |
| B8 | `selectedNodeIds` 未说明顺序/节点删除语义 | sourceRef 增加 `orderedMediaNodeIds`；未知/删除节点导致冻结校验失败，不静默重排或丢弃。 |
| B9 | Audio `audio.generate` 与 rev2 双操作合同冲突 | 统一为 `audio.speech` + `audio.sfx`；ContentPackage 仍不新增独立音频成品 kind。 |
| B10 | Agent “触发式/少量动词”与用户确认的全集冲突 | 工程现在并行；首发固定七动词：`read_canvas/create_node/update_node/delete_node/connect_nodes/disconnect_nodes/run_generation`。外部客户使用仍需净节时、费用与双会话零串写验证。 |
| B11 | “Vozeb runtime 直接复制=0”与“画布/精修整套照搬”相反 | 后端/业务 runtime（auth、JSON/Map、代理、Points、Agent bridge）直接复制=0；获授权 canvas/render/retouch core 可按 A2/A3 manifest 复用，接入层必须重建。 |
| B12 | P1 的 Growth/高用量 Pro 不设功能墙与 Pro Studio 加购冲突 | Pro Studio 是新增产品 surface，可在进入处做加购 gate；不能锁住 P1 草稿、模板、编辑和既有对象，Pro Studio 新的生成/采用/导出动作再做动作级权益校验。 |
| B13 | `pnpm check` 历史 PASS 被当成当前绿灯 | 07-12/07-15 报告均加历史基线标记；当前验证以现场命令为准。 |
| B14 | 旧文档仍将 P0/旧计划/旧画布草案写成 ready-to-run | P0 改为 historical/superseded；07-15 研究、画布草案、rev2 前 r1-r6、Wayfinder assets 加历史叠加，不改写原始证据。 |

## 三、当前产品与架构合同

- **主线**：Composer → ContentPackage。商家一级导航仍严格为创作/内容/素材/门店；任务收件箱是创作页内工作面，不是一级导航。
- **升单线**：Pro Studio 为 workspace add-on，不出现在默认导航；工程事实为 `AdvancedCanvasProject + revision`，通过 `adopt_advanced_canvas_output` 进入 ContentPackage。
- **Polotno**：冻结 → Composer 吸收日常轻编辑 → 五门槛全部通过后退役；Polotno 票 20 不属于 Pro Studio 发布依赖。
- **媒体与安全**：provider result/reference/Audio 统一走 safe-fetch；若现有 Core provider delivery 尚未覆盖，safe-fetch 是 N2/N6 发布依赖，不能用“通用 Egress 尚未触发”绕过。
- **主线成品事实**：`Content` 只是 ContentPackage 的用户语义别名；`ContentItem`、`CreativeContent`、独立视频记录只读迁移，禁止新双写。

## 四、实施前不可猜测的门禁

1. **SSO 部署合同**：冻结 production/staging canvas host、主站 origin、form_post action、allowed Origin、CSRF/HostBridge origin 清单；`canvas.<域名>` 仍是占位符。
2. **N2 恢复**：PITR、对象 inventory、配置 revision、KMS、隔离 restore 和 RPO/RTO 证据；Pro Studio 对外收钱前硬依赖。
3. **授权 manifest**：精确 upstream commit、可复制文件集合、A2/A3 覆盖状态、审核人；fixtures 也要有脱敏来源与审核证据。
4. **Prompt seed 交付物**：30–50 条美业中文配方必须由产品侧提供版本化文件/schema、owner、operation 映射和来源证据，禁止 agent 临场生成。
5. **Pro Studio 验证门**：至少 3 家真实陪跑/中高阶商户完成“进画布→合格成品→采用→导出交付”并明确愿按报价付费；此前只能内部/白名单使用。
6. **P1 真实完成门**：当前真实跑通链路数仍为 0；录制/fixture/孤立 Adapter 测试不增加该数字。

## 五、验证记录

- 文档结构与术语：已同步 `CONTEXT.md`、P1/ContentPackage/Pro Studio specs、ADR-0011/0012、主方案、MAP 与历史材料标记。
- 当前 `pnpm typecheck`：并行审计现场验证通过。
- 当前 `pnpm check`：并行审计现场验证在 Biome 阶段失败，存在 11 个格式问题；不能称为全量通过。secret scan 的历史 `.env` 结论与本次格式失败分开记录。
- 当前真实 ContentPackage 证据：D01 仍为 0；`docs/evidence/contentpackage/` 的 probe/fixture/恢复证据不伪装成连续商户旅程。

## 六、结论

文档冲突已按用户确认的两线边界和最新 rev2 合同收口；旧路线与旧绿灯证据已降级为历史，代理不能再从旧文档推导执行。当前可以进入 M0 合同冻结与实现拆解，但不能宣称 Pro Studio 可公开销售、P1 已真实完成或当前 `pnpm check` 全绿，直到第四节门禁逐项留证。
