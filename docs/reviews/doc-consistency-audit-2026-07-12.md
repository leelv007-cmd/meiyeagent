# 文档一致性全面复核报告

- 日期：2026-07-12
- 状态：`closed`，已完成逐项确认与活动文档统一
- 方法：`grill-with-docs`（逐项识别冲突、给出推荐、不越权改写未决口径）+ `domain-modeling`（以当前术语和边界检查文档与实现）
- 范围：P1 规格、P1/模型供应/UIUX 决策地图、ADR、实施交接、评审/证据文档，以及与规范直接相关的代码事实。

## 权威链（当前建议）

1. 用户最后确认的产品结论。
2. `CONTEXT.md` 的现行术语与边界。
3. P1 产品：`.scratch/p1-wayfinding/map.md`、`.scratch/model-supply-wayfinding/map.md`、`docs/specs/beauty-content-agent-p1-spec.md`、经修订的 ADR-0003~0009 和已关闭决策票。
4. UI/UX 重构：`.scratch/creatok-uiux-wayfinding/assets/13-uiux-implementation-handoff.md`、`13-uiux-acceptance-matrix.md`、`15-secondary-surfaces-shell-decision-record.md` 及 UIUX 实施地图。
5. `docs/evidence/*` 是证据声明，`docs/reviews/*` 是评审记录；研究资产、P0 规格和旧合集只作历史追溯，不能覆盖以上口径。

> 已处理：UI/UX 交接规格的“信源优先级”已调整为用户结论/`CONTEXT.md` → 当前 P1 规格与 ADR → UI/UX 交接与验收；P0 定稿和 P0 spec 仅作历史证据。

## 已确认一致

- 图片目录：GPT Image 2、Nano Banana 2、Nano Banana Pro、Seedream 5.0 Pro。
- 视频目录：Seedance 2.0、Kling 最新系列、Grok 最新视频系列、Veo 最新系列；图片/视频显式选模，不跨品牌静默换模。
- 创作、草稿、模板、自由画布、AI 生图/改图和批量图文动作开放；发布动作单独确认。
- 品牌水印和产品侧 AIGC 标识是开关；供应方/平台强制来源信号只如实记录。
- 官方模板由后台版本化规划、发布、灰度、更新和下架；用户自选快捷展示，历史作品固定版本。
- 真实目标用户可用性测试已正式取消；验收可使用自动化和内部专家代理，但不得写成“真实用户验证通过”。
- 真实模型、账号、成本、质量和负载是 activation/evidence，不阻塞 recorded/fake 功能骨架。

## 冲突与漂移

### C-01（已解决，P1，高）：Owner-only 与 UI/UX 四层工作区角色冲突

- 2026-07-12 用户确认：四层固定角色纳入当前 P1 workspace 权限合同；P1 规格、P1 map、模型 BYOK 票和 `CONTEXT.md` 已统一为单店固定角色，保留无多门店/Agency、无自定义 ACL、无功能墙边界。
- 原 Owner-only 文字保留在决策票的历史记录中，并由同票 superseding amendment 明确覆盖，不再作为现行口径。

### C-02（已解决，P1，中）：发布阶段审核与“保存/导出触发 Preflight”并存

- ADR-0003、P0 spec 的活动说明已统一为：Preflight 只在发布包交接、L1 提交或明确公开交付时触发；普通 Work 保存、导出和下载不触发发布审核。
- P0 合集中的旧语句继续作为历史记录保留，并由文件顶部历史说明降级。

### C-03（已解决，P1，高）：AIGC 开关与“移除 AIGC 标识/覆盖率 100%”语义冲突

- ADR-0003/0004、P0 spec 和 P1 stage Gate 已改成：关闭可选的产品侧 AIGC 开关不构成违规；硬停止只针对伪造、篡改或绕过 provider/platform 强制 provenance/发布标识。
- 发布 Gate 的 100% 现在明确指 AIGC 状态、开关值、provider/platform provenance 和必要隐式元数据的记录完整性，不指可见产品标签始终开启。

### C-04（已解决，P1，中）：当前评审报告与已交付证据的状态不同步

- 一致性评审已重校为“实现/证据状态”，区分 legacy JSONB 兼容来源、当前 P1 relational/cutover 实现、recorded contract 和仍待 live activation 的外部证据。
- 评审不再把已交付的关系表、durable runtime、Model Supply、连接/MCP 和质量闭环写成未实现。

### C-05（已缓解，P2，文档卫生）：历史研究资产会被关键词检索误当现行决策

- 图文证据文件已加历史提示，问题票的“强制 AIGC”表述已改为 provider/platform 强制 provenance；ADR-0008 已注明旧模型名只是决策时参考。
- 其余研究报告中的供应商名、法规原文和实验结论仍按历史证据保留，不把关键词清零作为一致性目标。

## 代码对文档漂移（S0 前历史快照，已重校）

- 模型目录现在只有 `active + live_verified` Deployment 可提交；`recorded/configured` 保持不可用原因，由 `settings-view-model.test.ts` 和创作 E2E 覆盖。
- 品牌水印/AIGC 已作为用户开关进入统一执行合同；画布导出只有在二进制持久化后才投影为 canonical Asset。
- `b074cb0` 已为 `@meiye/web` 增加 `test` script 并让根 `pnpm test` 真实发现 Web 测试；同候选计数见 S5 证据。

## 暂不判为冲突

- “真实可用路径”与“无真实目标用户测试”不是同一概念：前者指真实运行/账号/供应证据，后者指 usability 招募证据；后续应在规格中明文拆开。
- 数据驻留/租户隔离/凭据保护是技术安全边界，不是创作阶段法务门禁；`data_class` 路由硬过滤与“创作开放”可以同时成立。
- P1 产品实施地图与 UIUX 实施地图分别覆盖后端产品交付和前端重构，`implemented-recorded` 与 `planned/S0 frontier` 并不互相矛盾。

## 复核结论

- 无剩余需要产品 Owner 拍板的文档级冲突。
- C-01 已按用户确认纳入 P1；C-02/C-03/C-04 已完成活动文档统一；C-05 已用历史提示和 superseding amendment 降低复活风险。
- 上述 UI/UX S0–S4 与可重复测试入口漂移已关闭；真实供应商和生产发布证据仍按 activation/发布边界单独处理。
