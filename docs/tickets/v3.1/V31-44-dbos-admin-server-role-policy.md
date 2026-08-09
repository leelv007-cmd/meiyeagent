# V31-44 —— DBOS admin server 的角色策略（API 角色未关 3001）

- Status: open
- Owner: 未指派
- Labels: **browser-wave blocker candidate**
- Blocked-by: 无
- 发现者: L-REL（2026-08-09，起点是 L-T3 报的 fixture 单点，扫面后发现生产侧同洞）
- 相关: 测试／fixture 侧 21 处已在 L-REL 分支 `ab24466c9` 统一补齐；本票只管**生产侧**

## 一句话

`runAdminServer` 的缺省值是 `true`、缺省端口 3001。生产代码只在 **job worker** 那条路径显式关掉它，**API 角色那条路径没关**，所以 API 角色的 Core 启动会绑 3001 —— 多 lane／多实例并发起 Core 会互撞。

## 注入不对称（生产侧，本票主体）

```
readJobWorkerHarnessRuntimeConfig (runtime-config.ts:37)
  └─ 包 readHarnessRuntimeConfig，再 :48-54 覆写 dbos.runAdminServer = false   ← 关了
initializeJobWorkerHarnessRuntime (runtime-config.ts:57)
  └─ dbos.setConfig(config.dbos)                                              ← 用的是关掉的那份

core-assembly.ts:294   readHarnessRuntimeConfig(env)                          ← 没包，没有 flag
api-runtime.ts:1279    DBOS.setConfig(harnessRuntimeConfig.dbos)              ← 缺省 true → 绑 3001
```

`readHarnessRuntimeConfig`（`runtime-config.ts:69`）返回的 `dbos` 对象里没有 `runAdminServer` 键。

**这个不对称更像缺省值漏进来、而不是刻意的角色差异**：job worker 那处显式写了 `false`，说明作者知道要关，只是没覆盖 API 角色这条路径。但"更像"不是证据，所以本票保留 documented-true 的裁决位。

## SDK 定值（`@dbos-inc/dbos-sdk@4.23.6`，读的是 dist 源码不是文档）

- `dist/src/config.js:173` —— `runAdminServer: config.runAdminServer ?? true` → **缺省 true**
- `dist/src/config.js:174` —— `admin_port: config.admin_port ?? config.adminPort ?? 3001` → **缺省 3001**
- `dist/src/config.js:227-228` —— 另一条路径把两者硬写成 `admin_port: 3001` / `runAdminServer: true`
- `dist/src/dbos.js:235` —— `if (runtimeConfig.runAdminServer) { … }` 起服务

## 判定任务（本票的核心，一半已答）

**已答（源码级，可采信）：** 缺省 true + 缺省 3001 + API 角色不关 ⇒ **API 角色 Core 启动会绑 3001**。

**已答（经验级，同类现象）：** 把 flag 摘掉后并发跑两个 DBOS 测试套件，日志里稳定出现

```
Unable to start DBOS admin server on port 3001
```

—— 与 L-T3 在它树上观察到的错误文本逐字相同。**但要如实记一条：在我这次两两配对的复现里，两个进程最终都 exit 0**，也就是这条冲突被记了日志、没把套件打死。所以"撞 3001"确定会发生，"是否致命"取决于时序与配对，不要按"必然 crash"写进编排假设。

**未答（留给本票实施者）：** 我**没有实测 Core boot**。我的 lane 约束禁止起服务（no dev server），所以只走了源码＋测试面复现两条腿。缺的那条腿是：

```bash
# 需要有起服务授权的人跑一次，确认 API 角色确实占住 3001
cd apps/core
DATABASE_URL=… HARNESS_DBOS_SYSTEM_DATABASE_URL=… pnpm start   # 或本仓的 API 角色启动命令
# 另一个终端：
lsof -nP -iTCP:3001 -sTCP:LISTEN
```

看到 Core 进程 LISTEN 在 3001 即闭环。

## 为什么标 browser-wave blocker candidate

浏览器波要多 lane 并发起 Core。若 API 角色确实绑 3001，则**第二个起的 Core 拿不到 admin 端口**。给编排的即时结论：

- 短期：**同一宿主上不要有两个 lane 同时起 Core**，或给每 lane 派不同 `admin_port`；
- 长期：按下面的裁决落定。

## 两条出路（择一，需产品／运维裁决）

1. **explicit-false**：让 API 角色也显式 `runAdminServer: false`。最小改法是把 flag 注入从 `readJobWorkerHarnessRuntimeConfig` 下移到 `readHarnessRuntimeConfig`（两个角色都拿到），job worker 那层的覆写随之变成冗余可删。代价：失去 DBOS admin HTTP 面（若有运维依赖它做 workflow 管理，要先确认无消费者）。
2. **documented-true**：若 API 角色**有意**提供 admin server（运维用它 list/cancel/resume workflow），那就写明依据，并把端口做成按角色／按实例可配（env 注入 `admin_port`），同时在派发协议里写清"多实例必须派不同 admin_port"。

裁决前置问题：**有没有任何东西在消费 DBOS admin server？** 有 → 倾向 (2)；没有 → (1) 更省事且直接解掉并发冲突。

## Acceptance criteria

- [ ] 补齐未答的那条腿：实测 API 角色 Core boot 是否 LISTEN 3001，贴 `lsof` 输出
- [ ] 回答"有无 admin server 消费者"，有则列出
- [ ] 按裁决落 explicit-false 或 documented-true（后者须同时给出 per-role/per-instance 端口方案）
- [ ] 若落 explicit-false：给出并发起两个 Core 都成功的证据（不是只有单实例绿）
- [ ] 浏览器波编排文档同步：要么"洞已修可并发"，要么"必须串行/派不同端口"
