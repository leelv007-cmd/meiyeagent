# V31-53 — goal-proactive 旅程用浏览器注入 gate config，服务端 `.strict()` 拒绝

**Parent**: V31-24（Goal + Proactive，票已关）；旅程面 §37.4 附加项 Goal+Proactive
**批次**: 收尾
**Blocked by**: None
**Related**: V31-29 / V31-30（测试是否真在证明产品）——本票的裁决直接落在这条纪律上：**修法不是让服务端接受这个键**
**Status**: open

## 缺口（一句话）

`v31-goal-proactive-idle` 旅程向 `goal-proactive` / `get_idle_projection` 传了一个 `config` 对象来摆布 proactive 闸门，服务端 zod 以 `unrecognized_keys` 拒绝，两条用例红。

> **锚署树**：`2da11d5ab`（W4-D round3 证据树）。

## 证据

| # | 证据 | 落点 |
|---|---|---|
| 1 | 服务端报错原文 | `round3-per-spec/v31-goal-proactive-idle.log:129-137`：`page.evaluate: Error: [{ "code": "unrecognized_keys", "keys": ["config"], "path": [], "message": "Unrecognized key: \"config\"" }]` |
| 2 | 两条失败用例 | 同日志 `:127`（`spec.ts:103` — `propose→confirm goal, Idle projection, accept has zero paid side effect`）、`:152`（`spec.ts:243` — `kill switch closes proactive suggestions on Idle projection`）；第三条用例通过（`SUMMARY.txt`：`pass=[1 passed] fail=[2 failed]`） |
| 3 | 客户端注入的内容 | `mkfast-template-main/tests/e2e/specs/v31-goal-proactive-idle.spec.ts:147-154`：`p1Query(page, 'goal-proactive', 'get_idle_projection', { config: { disableProactiveAgent: false, proactiveFeatureOn: true, workspaceAllowlisted: false, coverageThreshold: null } })`；另两处同形在 `:171`、`:255` |
| 4 | 请求体形状（`config` 确实在 payload 内，不是顶层） | 同 spec `:28-39` 的 `p1Query` 只发 `{action, module, payload}`；故 `path: []` 是**相对 payload schema 的根**，即 `config` 是 payload 的键 |
| 5 | 服务端受理点与 schema | `apps/core/src/p1/goal-proactive/foundation-module.ts:334` `case 'get_idle_projection':` → `:335` `const input = parse(listSuggestionsSchema, value);`，其后只用 `input.now`（`:345`）与 `input.maxCandidates`（`:346`）——**schema 里没有 `config`，也从来没有过** |

## 裁决方向：**服务端是对的，不要为了让旅程变绿去接受这个键**

`config` 的四个字段是 `disableProactiveAgent` / `proactiveFeatureOn` / `workspaceAllowlisted` / `coverageThreshold`——**这些是功能闸门与试点白名单**。让浏览器在查询里自带它们，等于**让客户端自己决定要不要对自己开启 proactive、要不要把自己加进白名单、覆盖率门槛是多少**。

所以这条 `unrecognized_keys` 拒绝**不是缺陷，是守卫在正常工作**。真正的缺口在旅程侧：它用了一条**本不该存在的捷径**来构造闸门状态。若为了让测试变绿而给 schema 加上 `config`（或改成 `.passthrough()`），会同时做成两件坏事：

1. 开一个**客户端自提权**面（自己把自己加进 pilot 白名单）；
2. 让这条旅程从此测的是「我传什么闸门它就用什么闸门」——**在闸门逻辑整层坏掉时也照样通过**，即 V31-29 那条判据要挡的形状。

## What to build

把闸门状态**从合法的 seam 驱动**，再让旅程按那个 seam 设置状态：

1. 查明 proactive 闸门（`disableProactiveAgent` / feature on / 白名单 / 覆盖率门槛）在生产上**由谁写、写在哪**——admin config 面、workspace 状态、还是环境级开关。
2. 旅程改为经该 seam 设置状态（fixture 走真实写入路径），再查询 `get_idle_projection` 断言投影结果。
3. 三处调用（`:147-154`、`:171`、`:255`）一并改，**不留一处旧形态**。

**若第 1 步查出闸门当前根本没有可编程的写入 seam**——那就是真缺口，此时**停手报主控**：是补 seam 还是改旅程的验收方式，属决策不属实施。不要自己造一个测试专用后门（那是把同一个自提权问题换个门牌）。

## Acceptance criteria

- [ ] `listSuggestionsSchema` **未被放宽**（不加 `config`、不改 `.passthrough()`）——这一条是硬门，改了即不通过
- [ ] 旅程三处调用改为经合法 seam 设置闸门状态，`v31-goal-proactive-idle.spec.ts:103` 与 `:243` 转绿（第三条用例保持绿）
- [ ] **鉴别力反证**：把闸门逻辑打坏（例如让 `workspaceAllowlisted` 恒真）⇒ `kill switch closes proactive suggestions` 那条必须转红。改后立即还原，终态 `git status --porcelain` 空
- [ ] 票下写明闸门的生产写入 seam 是什么；若走了「停手报主控」分支，写明主控裁决

## 边界

- 不动 `get_idle_projection` 的返回投影语义，只改闸门状态的**设置方式**。
- 不为测试新增任何后门端点／测试专用参数。

## 留痕

- 开票：W4-D 三轮浏览器验收判为独立缺陷，主控 2026-08-10 派 review-memory 落票。
- Wave 4（2026-08-10，review-memory 在 `codex/v31-w4-tickets`）：逐条只读核证客户端注入内容（三处，`:147-154`/`:171`/`:255`）与服务端受理点（`foundation-module.ts:334-346`，`listSuggestionsSchema` 只认 `now`/`maxCandidates`）；核清 `path: []` 是相对 payload schema 的根而非请求体顶层。**据此把票面从「契约漂移」改判为「服务端守卫正确、旅程用了不该存在的捷径」**，并写明为什么不能加 `config`（客户端自提权 ＋ 闸门整层坏掉也能过），把「schema 不得放宽」立为硬验收门。本 commit 零代码改动。
