# Resolution: 我方 P0 数据模型与 API 合同规格

日期：2026-07-07

## 结论

已完成 P0 Core API/Postgres 数据模型与 API 合同规格。

核心决策：
- 产品事实归 Core API/Postgres：门店、素材 metadata、内容、合规、发布、线索、用量、Agent run、Tool call、Durable job、Audit event。
- App Shell 只做 UI、session、settings、billing entry 和上传/proxy 机械能力。
- Agent Service 只通过 Core API tools 读写业务事实，不直接改业务表。
- Worker Pool 只执行渲染/导出/对象处理 job，不判断权限、不扣费、不做合规结论。
- R2 只存二进制，object key 不代表权限、授权、发布或合规事实。
- 所有高成本任务必须支持 `reserve -> commit -> refund`，所有外部/高风险动作必须可审计。

## 产物

- `../../references/product/reports/p0-data-model-api-contract.md`

## 后续

建议下一步把本合同转成 Drizzle schema / OpenAPI 草案或实施 backlog，先落 Slice 1 Core facts，再接创作工作流。

