# 票 11 · 真实估时替换前后端双硬编码常量（12s/45s/90s）
> 阶段: Phase 1 · 流式与生成反馈 ｜ 差距: P1-3 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "11",
  "decisionIds": [
    "DEC-PATH-B"
  ],
  "guardrailDecisionIds": [
    "DEC-JOB-PROGRESSBAR"
  ],
  "gapIds": [
    "P1-3"
  ],
  "contractIds": [
    "I04"
  ],
  "blockedBy": [],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- 差距报告 `P1-3`（`docs/reviews/uiux-productization-gap-report-2026-07-13.md:178-181`）当前定性为 `部分核实`：前端无条件展示 12/45/90 秒，后端复写并强校验同一组常量；视频“约 90 秒”与项目实测约 18 分钟相差约 12 倍，违背“不伪造进度、预期贴近真实”的承诺。
- 报告§一根因②③（`:24-26`）命中本票：验收只看功能存在、不看用户感知，且前后端接线断层。本票不能只改“90 秒”文案或把常量搬到配置文件，必须让正式工作台消费后端基于真实完成记录给出的估时。
- 报告§二把 P1-3 列入老板点名“流式输出”的关联落点（`:164`）：票 09 负责 Job 自动刷新与阶段白话，票 10 负责全局异步任务浮标；本票只负责提交前时长预期，不扩成进度百分比、历史详情或任务中心。
- ADR-0010:5-11 与 MAP Rules 锁定：验收只看用户可见行为与对标截图；不得以接口、类型、查询或测试存在关票。D3 仍为“对话式外壳、结构化内核”，不做 chat clone；D4 仍为 3 选 1 单选；不复活 L-1 贴链接抓取；禁止模型跨品牌 Auto。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/product/unified-creation-workbench.tsx:119-158`：`quoteFor` 仍按 operation 写死文案 12 秒、视频 90 秒、图片 45 秒；报告锚点 `:135/:146/:153` 未漂移。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:365-394`：前端把 `quote.estimatedSeconds` 写入商家接受的执行合同（`:387`），说明常量不是纯展示文案。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:851-875`：正式 Composer 在 `:857-860` 无条件展示“约 N 秒”；报告锚点 `:858-859` 未漂移。
- `apps/core/src/p1/operations/model-supply-creation-adapter.ts:49-91`：后端在 `:56-61` 再写一遍 12/90/45，并在 `:81` 要求客户端秒数完全相等；报告锚点未漂移。
- `packages/contracts/src/uiux.ts:17-33`、`apps/core/src/p1/operations/types.ts:471-487`：共享合同与 Core 内部合同都把单值 `estimatedSeconds` 定为必填；`apps/core/src/p1/operations/foundation-module.ts:103-135` 继续按单个 number 解析。
- `apps/core/src/p1/operations/application-service.ts:4001-4017`：服务端校验要求 `estimatedSeconds` 为大于 0 的整数，当前协议无法表达“区间”或“样本不足”。
- `apps/core/src/p1/foundation/postgres-repository.ts:125-140,648-667`：现有 `p1_generation_jobs` 已保存 operation、route snapshot、status、`created_at/updated_at`，完成态可形成服务端观察到的端到端时长；无需拿展示常量充当数据源。
- `apps/core/src/p1/foundation/ports.ts:22-38`：Foundation 目前只支持按 job id 读取，没有按模型/媒介聚合完成时长的读取缝；这是需要补的最小后端入口。
- `apps/core/src/main.ts:552-567`：视频 provider 默认 timeout 仍是 `1_080_000ms`（`:561`）。它是失败上限，不是真实分布，禁止直接把 18 分钟改名为“预计时长”。报告对原 `ark-provider.ts` 的错指已更正，当前行号与报告一致。
- `apps/core/src/p1/model-supply/foundation-module.ts:351-382`、`mkfast-template-main/src/p1/settings-view-model.ts:9-31`：后端 catalog view 与前端归一化模型均没有估时字段，当前模型切换不可能带来模型级时长变化。

## 改造方案（步骤级 + 涉及文件清单）

1. **定义唯一估时合同**：新增 `DurationEstimate` 判别联合。可靠样本返回 `observed`、P50/P90 区间、样本数、观察窗口与 `asOf`；样本不足返回 `insufficient_data`，不携带伪造秒数。前端统一显示“通常 X–Y 分钟”和“依据近 30 天 N 次完成记录”，不再显示假精确单值。
2. **从既有事实表取样**：在 Foundation repository 增加只读聚合，使用当前环境近 30 天、终态成功的 `p1_generation_jobs`，按 operation + `p1_route_snapshots.requested_catalog_model_id` 分组，以 `updated_at-created_at` 计算用户等待尺度；排除失败/取消、fixture/recorded 证据和非当前环境记录，不跨品牌、不卡死到 provider timeout。
3. **规定保守统计与降级**：同一模型/媒介至少 5 个有效样本才展示 P50–P90；极端值只通过分位数消化，不手填 12/45/90 fallback。窗口内不足 5 条时返回“暂无可靠估时，实际耗时受模型与队列影响”，提交能力不因缺估时被禁用。
4. **由 catalog 单向下发**：在 ModelSupply catalog 的每个具体模型上附带 `durationEstimate`，前端归一化时原样保留；选择 operation 或具体模型后只展示该组合的估时。保持 fixed model 语义，不借估时做跨品牌 Auto 或静默切换供应商。
5. **移除双写合同**：从新提交的 `CreativeExecutionContract`、请求解析、应用校验与 `ModelSupplyCreationExecutor.inspect` 中移除客户端提供的 `estimatedSeconds` 及 12/45/90 对等校验；价格、产出数、catalog/price revision 的既有报价校验保持不变。旧 Job 中已有的 `estimatedSeconds` 只作历史兼容，不得回流为新报价。
6. **替换正式工作台展示**：删掉 `quoteFor` 内三个时长常量；价格/产出计算继续复用既有逻辑，时长只读 selected model 的后端估时。模型或 operation 切换时先显示加载态，禁止短暂沿用上一个模型的区间；错误或无样本时显示诚实降级文案。
7. **覆盖三媒介与边界样例**：复验文案、图片、视频，模型切换、无样本、陈旧样本、长尾样本、历史旧合同与刷新返回；截图使用同一账号、operation、模型与视口，不能用 fixture 的秒级结果证明生产估时准确。

涉及文件清单：

- 合同与解析：`packages/contracts/src/uiux.ts`、`apps/core/src/p1/operations/types.ts`、`apps/core/src/p1/operations/foundation-module.ts`、`apps/core/src/p1/operations/application-service.ts`。
- 真实样本读取：`apps/core/src/p1/foundation/ports.ts`、`apps/core/src/p1/foundation/memory-repository.ts`、`apps/core/src/p1/foundation/postgres-repository.ts`。
- catalog 与后端校验：`apps/core/src/p1/model-supply/foundation-module.ts`、`apps/core/src/p1/operations/model-supply-creation-adapter.ts`。
- 正式前端：`mkfast-template-main/src/p1/settings-view-model.ts`、`mkfast-template-main/src/product/unified-creation-workbench.tsx`。
- 随行为更新既有验证：`apps/core/src/p1/foundation/postgres-repository.test.ts`、`apps/core/src/p1/model-supply/foundation-module.test.ts`、`apps/core/src/p1/operations/model-supply-creation-adapter.test.ts`、`mkfast-template-main/src/p1/settings-view-model.test.ts`。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家在正式工作台选择文案、图片或视频后，看到的是当前具体模型对应的“通常 X–Y 分钟/秒”区间与样本依据，不再看到固定 12/45/90 秒。
- 商家选择视频时，界面不再承诺“约 90 秒”；若真实完成记录集中在十几分钟，展示的区间能如实落在分钟级，而不是用 provider 的 18 分钟超时冒充估时。
- 商家切换 operation 或具体模型时，估时随选择更新；加载期间不会闪回上一模型的数字，也不会发生跨品牌 Auto、静默换供应商或模型名与估时不匹配。
- 当有效样本不足、读取失败或数据过旧时，商家看到“暂无可靠估时，实际耗时受模型与队列影响”；页面不展示 0 秒、默认秒数、`undefined` 或报错 JSON，仍可按原有价格与可用性规则提交。
- 文案仍保持 3 选 1 单选语义；工作台仍是对话式外壳、结构化内核，界面没有新增 chat clone、贴链接抓取承诺、假百分比或候选多选采用。
- 截图/录屏对照：同一视频模型与同一桌面视口并排保留“改造前当前产品固定约 90 秒、升级后当前产品真实区间/无样本降级、KickArt 或 CreatOK 对标产品的提交后预期管理”三组证据；另附升级后模型切换前后两帧，证明估时确随具体模型变化。若对标产品不展示时长，只对照其诚实的异步/阶段反馈，不虚构对标数字。

## Blocked-by / Blocks

- Blocked-by：无。实现可独立进入 Phase 1；不得等待票 09/10 才移除假估时，也不得抢做两票的自动轮询、阶段叙事或全局浮标。
- 全局关票闸：Phase 0 是 Phase 1 frontier 的硬前置；且票 02 完成前任何票不得关票。即使本票行为已实现，也必须等体验合同 required 条目与截图证据验绿后才能关闭。
- Blocks：MAP 未声明本票的直接下游阻塞；票 09/10/16 可复用本票的估时合同，但不据此新增硬依赖链。

## 风险与回退

- **样本稀疏或污染**：新模型、低频模型、fixture 与 recorded 结果会扭曲区间。控制：环境隔离、成功终态过滤、最小样本门槛与来源标识；回退为“暂无可靠估时”，绝不回退到 12/45/90。
- **长尾与队列波动**：均值容易被极端任务拖偏，短窗口又可能失真。控制：展示 P50–P90 区间、样本数与观察时间；若分布异常或陈旧，降级为无可靠估时，不宣称 SLA。
- **完成时间口径失真**：人工核验可能让 `updated_at` 晚于 provider 实际完成。控制：优先服务端可观测终态，结合票 09 自动回收后的数据校准；不得用 timeout、客户端停留时长或手填常量补洞。
- **旧合同兼容**：历史 Job JSON 仍含 `estimatedSeconds`。控制：读路径兼容旧字段，新提交不再生成；若迁移出现历史页退化，回退合同读取适配，不恢复新提交的硬编码校验。
- **估时切换抖动**：查询延迟可能短暂显示旧模型区间。控制：estimate 与 model id/operation 同键，选择变化即清空旧值；回退为局部 skeleton 或无可靠估时文案。
- **范围滑坡**：把本票扩成进度条、通知中心、历史实际用时、视频工作流改造或 D4 重开会踩票 09/10/16/18。控制：只交付提交前真实估时；回退越界 UI，不回退 D3、D4、L-1 de-scope 或禁止跨品牌 Auto。
