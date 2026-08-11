# V31-44 —— DBOS admin server 的角色策略（API 角色未关 3001）

- Status: open

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**: 
**Workflow Run**: 
**Artifact Digest**: 
- Owner: 未指派
- Labels: **hygiene**（曾标 browser-wave blocker candidate，已按 L-CI 实测降级——见下「致命性判定」）
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

**已答（L-CI 实测 Core boot，补上我做不了的那条腿）：** 我的 lane 约束禁止起服务（no dev server），Core boot 由 L-CI 实测：

- 两轮 Core 启动**都**打出 `[Core] Unable to start DBOS admin server on port 3001`；
- 第二轮（空库 `_r2`）在该消息之后 **`/health` 仍返回 200**（curl 实测 core4220=200）；
- 3001 的实际占用方是**主 checkout 里一个长跑 Core**（pid 35520）。

## 致命性判定（本票标签的依据）

**结论：会尝试绑，但绑失败不阻塞启动。**

这条推论很重要：既然主 checkout 那个长跑 Core 一直占着 3001，那么**所有 lane 的 Core 一直都运行在「admin 端口绑失败、继续正常服务」的现实里**——包括历史上跑绿过的那些轮次。因此：

- **「同一宿主不能两个 lane 同时起 Core」这条运营限制不成立**；浏览器波不需要串行，也不需要 per-lane `admin_port` 过渡方案；
- 标签从 blocker candidate 降为 **hygiene**。

L-REL 侧的独立观察与此一致、并且是这个结论的第二个数据点：在测试面把 flag 摘掉并发跑两个 DBOS 套件，`Unable to start DBOS admin server on port 3001` 稳定出现，**但两个进程最终都 exit 0**。两边独立测量都指向"记日志、不致命"。

**所以本票要问的不再是「会不会打死启动」，而是「是否应当显式关掉」**，理由有三条且都与致命性无关：

1. **一致性**：同一份 runtime config 的两个角色行为不同，且不对称来自缺省值而非声明（见上）；
2. **日志噪音**：每次 Core 启动都打一条 error 级噪音，会淹掉真问题，也让"启动是否正常"这件事需要额外解释；
3. **未来风险**：SDK 现在把 bind 失败当可恢复，这是实现选择而非契约。若某天变致命，或某个角色确实需要 admin 面而拿不到端口，届时才发现代价更高。

## 两条出路（择一，需产品／运维裁决）

1. **explicit-false**：让 API 角色也显式 `runAdminServer: false`。最小改法是把 flag 注入从 `readJobWorkerHarnessRuntimeConfig` 下移到 `readHarnessRuntimeConfig`（两个角色都拿到），job worker 那层的覆写随之变成冗余可删。代价：失去 DBOS admin HTTP 面（若有运维依赖它做 workflow 管理，要先确认无消费者）。
2. **documented-true**：若 API 角色**有意**提供 admin server（运维用它 list/cancel/resume workflow），那就写明依据，并把端口做成按角色／按实例可配（env 注入 `admin_port`），同时在派发协议里写清"多实例必须派不同 admin_port"。

裁决前置问题：**有没有任何东西在消费 DBOS admin server？** 有 → 倾向 (2)；没有 → (1)。

注意 (1) 的代价评估因致命性判定而改变：既然 3001 长期被主 checkout 那个 Core 占着、其余 Core 一直绑不上，**"失去 admin 面"在现实里早已是既成事实**——`explicit-false` 只是把现状写成声明，不是新增功能损失。这反过来加强了 (1)。

## Acceptance criteria

- [x] 实测 API 角色 Core boot 的 3001 行为 —— L-CI 已答：两轮都打 bind 失败消息，第二轮 `/health` 仍 200（curl core4220=200），占用方 pid 35520
- [ ] 回答"有无 admin server 消费者"，有则列出（这是裁决的真正前置，且现状表明即便有消费者也长期拿不到端口）
- [ ] 按裁决落 explicit-false 或 documented-true（后者须同时给出 per-role/per-instance 端口方案）
- [ ] 清理主 checkout 那个长跑 Core（pid 35520）的归属与生命周期——它不在任何 lane 的 worktree 里，属谁、谁该收，L-CI 在查
- [ ] 落地后 Core 启动日志不再出现 `Unable to start DBOS admin server`（本票的可观测验收）
- [ ] 浏览器波编排文档同步：记明**不需要串行、不需要 per-lane admin_port**（致命性判定的结论），避免后人按旧口径加不必要的约束
