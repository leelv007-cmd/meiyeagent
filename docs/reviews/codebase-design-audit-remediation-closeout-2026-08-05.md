# 主模块审计整改收官报告 — 2026-08-05

依据：`docs/reviews/codebase-design-module-audit-2026-08-04.md`（11 项修复路线图）。
执行形态：主控（Claude）编排验收，codex CLI 子 agent 分 lane 实施；每 lane 独立 worktree、语义 zone 互斥、审计论断动手前 grep 复核、不 push、主控亲验后 ff 合入并记 `docs/ops/merge-ledger.md`。

## 路线图完成度：11/11

| # | 路线图项 | Lane | 合入 sha | 关键成果 |
|---|---|---|---|---|
| P0-1 | operations 死表面删除 | A1 | d2e83053 | 39 方法定义清除（+258/−8284），migration dispatch 直连；审计 35→实删 30，5 项反驳有据 |
| P0-2 | ProviderExecutionPort 双定义合并 | A2 | f7691150 | foundation/ports.ts 单一权威，18 import site，无兼容转发 |
| P0-3 | recorded-media 测试+表驱动工厂 | A2 | 同上 | 12 命名壳→合同工厂（导出 25→14），新增全生命周期/四错误相测试 |
| P0-4 | validateSearch 去镜像 | A4 | b228b948 | 路由 import 真解析器，镜像重实现删除 |
| P0-5 | Postgres repo 签合同 | A2 | f7691150 | 39→37 成员收窄后 implements 落位（零漂移），Memory/Postgres 共享契约测试 |
| P0-6 | PostgresHarnessStore 角色拆分 | B1 | 9d46fbe2 | 三分片＋facade，12 角色接口全显式 implements，raw SQL 断言 61→53 |
| P1-7 | CoreAssembly | C1 | c7a370f7 | main.ts 2569→3 行、job-worker 780→3 行，常量重复 73→0，四漂移裁决修复，域规则抽出+5 测试，四假端口删除 |
| P1-8 | server.ts 声明化 | A3 | 3b64bbf2 | toHttpError（catch 38→12）、32 路由表+auth 守卫测试、SSE 合一、计费/租户策略归位 |
| P1-9 | workflow-core 三胞胎收敛 | B1 | 9d46fbe2 | descriptor 表驱动单 runner，穿透委托 10→0，构造器具名化（throw 54→50） |
| P1-10 硬化 | contracts branded/枚举/subpath | B2 | 8448daac | identifiers.ts 统一（拷贝清零），failureCode 修范畴错误，39 错误码枚举，export * 归零，./wire ./vocabulary |
| P1-10 迁移 | contracts 行为迁移+双边校验 | C2 | ad14ea15 | 计费数学/标签/状态契约/harness 投影各归其主；web transport 统一 envelope safeParse+三读路径 payload 校验 |

主控直修（记于台账/commit）：signOut fixture 基线断裂（bfcfaae1）、A4 断线遗留测试 fake 类型（b228b948）、两处静态测试靶漂移（b6e37c8a、1edff6b8——均为抽取后测试盯旧文件，非功能回归）、门禁清尾（6710de9f）。

## 验收数据

- **PG 持久化电池三轮**（fresh 双库，`assert-core-persistence-ran.mjs` 判定）：
  - Wave 1 后：3177 tests / 0 fail / 21 skip
  - Wave 2 后：3184 / 0 / 21
  - Wave 3 后（c7a370f7）：3190 / 0 / 21，DBOS 五阶段冒烟与 production media assembly join 均实跑
- **root typecheck**：每 lane rebase 后 exit 0；终态 PASS
- **`pnpm check`**：终态 **Overall PASS**（opt-in 证据 60 套件全部换锚：56 套件锚电池 c7a370f7，4 套件锚 2026-08-05 单跑 fresh 对）
- **web**：interaction 478/478；单测除 3 个既有基线红外零新增（见「遗留」）
- **contracts**：165/165

## 审计被实施反驳的论断（复核机制产出）

1. A1：35 可删→实为 30（repairMediaCustody/search/listUserTemplates/listTemplateShortcuts/createCreativeWork 各有生产调用）
2. A2：两份 port 合同并不相近（foundation 旧签名系无消费者遗留）；Postgres 签约零漂移（审计预期有）
3. A3：路由 35 条→实为 32
4. B1：runtime throw 49→AST 实测 54；Production ctor 13 optional→实为 12；SemanticDecisionResumptionStore 另有实现者
5. B2：错误码 17→39 直传（另 ~238 域字面量）；4 个"core-only"文件仍被 schema 链消费未搬
6. C2：**鉴权树是真双边 seam**——web 四位点真重跑策略（workspace-authorization 等），依停止条件留 contracts；死导出 178 候选→时点重算 81，删 20 留 61

## 遗留（不在本次范围，建议开票）

1. **3 个 main 基线红**（先于本次整改存在）：pricing Paraglide 键缺失 ×2、Creem 退役残留审计。
2. contracts 中 `capability-permission.ts` 保留（真双边）——若要收窄，需先给 web 四个策略位点设计投影替代。
3. e2e/journey 未在本次跑（按纪律留给票面级验收）；建议下一张功能票顺带跑一次 production-main-journey 以背书装配层重构。

## 台账索引

八条 lane 合入行 + 直修记录见 `docs/ops/merge-ledger.md` 2026-08-04/05 段（d2e83053 → 6710de9f，共 36 commit，未 push）。
