# Issue #246 E3：Skills / Harness `getX` / `putX` 失败语义盘点

日期：2026-07-29  
性质：只读盘点，不含整改  
代码快照：`issue/246` 工作树（基准提交 `fb20cf20b5eeb47c3a11233f12e9c520de5dd002`；盘点时同票实现仍在并行修改）

## 1. 口径

D-166 的目标不是把所有缺失都改成抛错，而是让调用合同不再混态：

- **必需依赖**：缺失即抛出可判别错误，不得静默返回 `null` / `undefined` 后继续。
- **可选依赖**：在类型或 API 名称上显式 optional，调用方必须分支处理。
- **必需写入**：返回已持久化值；幂等事实冲突、OCC 冲突和存储错误均向上抛出。
- 本文只记录现状、目标语义和缺口；不更名、不拆接口、不改实现。

权威依据：

- D-166 决定⑤要求“同名族 API 统一失败语义（必需依赖抛错 / 可选依赖显式 optional）”：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md:3300-3303`。
- Issue #246 E3 明确本项只交盘点，整改另立票。

扫描范围为 `apps/core/src/p1/skills/**/*.ts` 与 `apps/core/src/p1/harness/**/*.ts` 的生产文件；排除 `*.test.ts`、`*.fixture.ts`。使用：

```bash
rg -n --glob '!**/*.test.ts' --glob '!**/*.fixture.ts' \
  '\b(?:get|put)[A-Z][A-Za-z0-9_]*\b' \
  apps/core/src/p1/skills apps/core/src/p1/harness
```

该正则还命中两个 JavaScript 日期方法 `getTime` / `getUTCDay`，不属于仓储 API。私有实现助手 `getOne` / `putOnce` 不构成对外合同，但因它们决定整族 PostgreSQL 未命中和幂等冲突语义，分别纳入 §2 开头和 §2 末尾的证据。

## 2. Skills：成对仓储 API

`SkillRepository` 的公开合同集中在 `apps/core/src/p1/skills/repository.ts:15-46`。内存实现和 PostgreSQL 实现的单条读取都以“未命中返回 `null`”为默认；PostgreSQL 共用读取器见 `apps/core/src/p1/skills/postgres-repository.ts:460-470`。

下表中的 `skills/...` 是 `apps/core/src/p1/skills/...` 的缩写；每个引用均为当前工作树的 1-based 行号。

| 族 | 当前 API / 实现证据 | 当前未命中或失败语义 | 当前调用语义 | 目标失败语义 | 判定 |
|---|---|---|---|---|---|
| Catalog | `putCatalog` / `getCatalog`：`skills/repository.ts:16-17`；内存：`:79-87`；PG upsert / nullable get：`skills/postgres-repository.ts:126-145` | `getCatalog` 未命中返回 `null`；`putCatalog` 是无 CAS 的 upsert，数据库错误上抛 | 可选探测：`defineCatalogEntry` 用缺失表示首次创建（`skills/service.ts:42-60`）；必需依赖：草稿、冻结、绑定路径把缺失转 `NOT_FOUND`（`:63-74,102-127,131-142`） | 将“可选查找”和“必需目录”显式分开；必需路径缺失抛 `NOT_FOUND`。写入仍须返回持久化值并传播存储错误；是否允许覆盖是写入语义，不应靠 `put` 名字隐含 | **混态，待整改票拆分** |
| Revision | `putRevision` / `getRevision` / `getRevisionHead`：`skills/repository.ts:18-24`；内存 CAS / nullable reads：`:89-110,130-135`；PG CAS：`skills/postgres-repository.ts:147-200`，nullable reads：`:226-245` | `putRevision` 的 head/版本不符抛 `IDEMPOTENCY_CONFLICT`；两个 get 未命中均返回 `null` | `getRevision` 在 `requireRevision` 中为必需依赖并转 `NOT_FOUND`（`skills/service.ts:596-602`），但 `resolveStage` 会把缺失/未冻结版本静默跳过（`:277-309`）；`getRevisionHead` 以“尚无修订”为合法空值 | `getRevisionHead` 保持显式 optional；`getRevision` 拆出必需读取与“枚举时允许跳过”的显式 optional 读取。必需冻结引用缺失不得被吞掉 | **混态；`putRevision` 已符合必需写入失败语义** |
| Binding | `putBinding` / `getBinding`：`skills/repository.ts:25-35`；内存：`:137-213`；PG：`skills/postgres-repository.ts:247-365` | `putBinding` 同 id 不同事实或活跃槽冲突时失败；`getBinding` 未命中返回 `null` | 回滚源绑定是必需依赖，service 将空值转 `NOT_FOUND`（`skills/service.ts:168-183`） | 必需源绑定读取直接具有“缺失抛 `NOT_FOUND`”合同；若未来出现探测场景，另设显式 optional API | **读取合同名义混态；当前 service 边界已 fail-closed** |
| Deployment | `putDeployment` / `getDeployment`：`skills/repository.ts:36-37`；内存：`:231-243`；PG：`skills/postgres-repository.ts:368-386` | `putDeployment` 是 put-once，冲突抛 `IDEMPOTENCY_CONFLICT`；`getDeployment` 未命中返回 `null` | 当前 skills/harness 生产代码只写不读：注册路径在 `skills/service.ts:222-275`；`getDeployment` 无生产调用点 | `putDeployment` 保持必需写入；`getDeployment` 在出现调用者前**无法判定**必需或可选，不应预先把 `null` 写成已认可目标合同 | **写入已明确；读取目标待真实调用者定形** |
| Child effect | `putChildEffect` / `getChildEffect`：`skills/repository.ts:38-40`；内存：`:245-264`；PG：`skills/postgres-repository.ts:388-434` | put-once 冲突抛 `IDEMPOTENCY_CONFLICT`；get 未命中返回 `null` | 幂等执行前查询是可选探测（`skills/service.ts:501-533`）；回执列出的 effect 在 `resolveExecutedSelection` 已按必需依赖校验并 fail-closed（`:316-336`），但已存在回执的 invoke replay 循环仍对缺失 effect 直接跳过（`:442-460`） | 分开“effect 是否已经执行”的 optional lookup 与“回执引用的 effect 必须存在”的 required lookup；后者缺失须抛可判别完整性错误，不能跳过 | **混态；一个引用读取点已 fail-closed，invoke replay 仍静默缺失** |
| Invocation receipt | `putInvocationReceipt` / `getInvocationReceipt`：`skills/repository.ts:41-46`；内存：`:266-278`；PG：`skills/postgres-repository.ts:436-458` | put-once 冲突抛 `IDEMPOTENCY_CONFLICT`；get 未命中返回 `null` | 物化和 invoke 都把 get 用作幂等探测（`skills/service.ts:353-414,417-460`）；`resolveExecutedSelection` 把“无回执”解释为没有执行后选择（`:316-323`） | 保持显式 optional；API 名称或返回类型应清楚表达“未发生调用是正常分支”。一旦上层已持有 receipt ref，则读取必须改走 required 语义 | **当前主要用途为可选探测；需防止未来误作必需读取** |

### Skills 写入族的共同现状

内存 `putOnce` 在相同事实重放时返回既有值、不同事实时抛 `IDEMPOTENCY_CONFLICT`（`apps/core/src/p1/skills/repository.ts:53-69`）；PostgreSQL `putOnce` 同样先 `INSERT ... DO NOTHING`，再比较既有 payload，冲突时抛错（`apps/core/src/p1/skills/postgres-repository.ts:472-500`）。因此：

- `putRevision`、`putBinding`、`putDeployment`、`putChildEffect`、`putInvocationReceipt` 的“必需写入失败必须上抛”已成立。
- `putCatalog` 是例外：它是可覆盖 upsert，不是 put-once。本文不判定它应否改成 CAS，只要求未来 API 不以统一的 `putX` 命名掩盖不同写入语义。

## 3. Harness：`getX` API

Harness 生产文件没有 `putX` 声明或调用；其同名族全部是读取/恢复端口。

| API | 证据 | 当前语义 | 目标失败语义 | 判定 |
|---|---|---|---|---|
| `HarnessDbosEventTransport.getResult` | 合同与 DBOS 适配：`apps/core/src/p1/harness/dbos-workflow-events.ts:27-38`；消费：`:77-119` | 结果是必需依赖；DBOS 抛错后，仅当 PG 已有 terminal failure 时转换为失败投影，否则原错继续上抛 | 保持 required；不得把 DBOS 失败解释成“暂无结果”或成功空值 | **已符合** |
| `HarnessRecipeFactRequirementPort.getRecipeByRevisionId` | 合同：`apps/core/src/p1/harness/production-stage-ports.ts:134-140`；冻结配方校验：`:348-364` | 返回 `null`；当 execution snapshot 已钉扎 recipe 时，缺失/错版本抛错 | 冻结引用路径必须 required 并抛可判别 snapshot/recipe 错误 | **调用边界 fail-closed，端口仍是 nullable** |
| `DurableSkillInstructionResolver` 所用 `getRecipeByRevisionId` | `apps/core/src/p1/skills/runtime.ts:23-37` | 先按 revisionId 查，再按 `recipeId@revisionId` 查；两次缺失后静默回落到 `workflow.copy@N` | 若 recipe ref 是请求中已声明/钉扎的必需依赖，缺失必须抛错；只有明确无 recipe 输入时才允许默认 workflow ref | **混态，存在静默回落** |
| billing `getQuote` | Harness wrapper：`apps/core/src/p1/harness/product-billing-settlement.ts:93-103` | 底层返回空值时，wrapper 抛 `P1DomainError('NOT_FOUND')` | 保持 required；缺失不得进入 settle | **已符合** |
| billing `getUsage` | Harness wrapper：`apps/core/src/p1/harness/product-billing-settlement.ts:105-116` | 底层返回空值时，wrapper 抛 `P1DomainError('NOT_FOUND')` | 保持 required；缺失不得完成 commit/refund | **已符合** |
| `getDurableMediaJob?` | 可选能力声明：`apps/core/src/p1/harness/unified-media-stage-ports.ts:829-847`；调用：`:969-1017` | **方法本身可选**；缺失时走 submit 路径。方法存在后，其返回值是非 nullable，错误向上抛 | 保持“能力 optional、调用结果 required”的两层合同；禁止方法存在但未命中时静默 `undefined` | **已显式 optional，符合** |

## 4. 整改票应采用的逐项目标清单

这不是本票实现项，仅把可验收目标固定下来：

1. `getCatalog`：optional create probe 与 required catalog read 分离。
2. `getRevision`：optional inventory/filter 与 required frozen revision read 分离。
3. `getRevisionHead`：保留 explicit optional。
4. `getBinding`：回滚源读取为 required。
5. `getDeployment`：等待首个真实读取方决定；不得凭空定为 required 或 optional。
6. `getChildEffect`：idempotency probe 为 optional；receipt integrity read 为 required。
7. `getInvocationReceipt`：幂等探测为 optional；未来引用式读取另走 required。
8. `getResult`：required，错误传播或转换为已持久化 terminal failure。
9. `getRecipeByRevisionId`：无 recipe 输入可 optional；一旦有冻结/声明 ref 就 required。
10. `getQuote` / `getUsage`：required，缺失抛 `NOT_FOUND`。
11. `getDurableMediaJob?`：端口能力 optional；端口存在时读取 required。
12. 所有 `putX`：存储错误不得吞；put-once/OCC 冲突必须可判别；`putCatalog` 的覆盖语义需单独命名或文档化。

## 5. 未证实边界

- 本盘点没有运行测试，也没有连接 PostgreSQL；“PG 错误上抛”来自生产实现控制流，不是故障注入证据。
- `getDeployment` 当前无 skills/harness 生产消费方，目标语义必须等真实调用者出现后确定。
- 本文不主张具体的新 API 名称（例如 `findX` / `requireX`）；命名属于后续整改票设计。
- 盘点期间 Issue #246 的实现文件在并行修改，最终合并前应重跑上面的 `rg`，校正新增 API 与行号。
