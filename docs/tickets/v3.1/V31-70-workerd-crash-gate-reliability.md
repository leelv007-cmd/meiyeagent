# V31-70 — 浏览器门 workerd 猝死：三门同根的 Broken pipe 崩溃与仪器子进程盲区

**Parent**: V31-64（门仪器）之后的门可靠性收口
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-64（服务退出仪器）、V31-63（前一轮门死亡定性）

**Status**: open（2026-08-12）— 根因已定性（CI run 31573910031 三门证据），缓解与检测两路待实施

**Implementation state**: not-started
**Verification state**: not-started
**Evidence SHA**:
**Workflow Run**:
**Artifact Digest**:

## 为什么开票

CI run 31573910031（main=f79eb489）三个浏览器门在**互不相同的时刻**死于**同一个进程**：wrangler dev 里的 workerd 子进程。三门 35 条红里 28 条是它的级联，只有 7 条真红。这是当前门可靠性的头号杀手——workerd 一崩，该门此后所有 spec 全部沦为 auth 500 / vite 错误页假红或「did not run」。

## 证据（run 31573910031）

| 门 | 崩溃时刻 | 形态 | 证据 |
|---|---|---|---|
| production | 07:47:57 | production-candidate（wrangler dev 一等托管服务）exit 1，仪器**命中**，11 specs 记 NOT evaluated | `service-exits/production-candidate-7665.json` tail：`kj::getCaughtExceptionAsKj() = kj/async-io-unix.c++:186: disconnected: ::write(...): Broken pipe`，栈=workerd-linux-64@1.20260424.1 |
| v31 | 07:38:09 | web dev server 内 workerd **子进程**消失，仪器**盲**（只记 core/p1-worker/web 三个父进程）；`terminated`＋`fetch failed` 同秒出现，74 秒风暴 22 条级联红 | playwright log :311/:331，栈经 miniflare dispatchFetch → @cloudflare/vite-plugin |
| p2 | 08:02:08 | 同 v31 形态；:449 retry2 起全部级联，10 specs did not run | playwright log :675 |

关键更正：此前把 v31/p2 的风暴误判为「Core 挂起」——两门的 Core 直到 teardown SIGTERM 都健康（v31 的 Core tail 还有 `Waiting for pending workflows to finish.` 优雅收尾行）。死的是 vite cloudflare 插件里的 workerd。

判别注记：本地 54329 多 lane 并跑时另有一种假红形态——`PostgresError: sorry, too many clients already`（53300，max_connections=100），表现为旅程中段任意 P1 命令 5xx（如 `APPROVAL_CONTEXT_UNAVAILABLE`）；与 workerd 猝死无关，先查 `pg_stat_activity` 再定性（2026-08-12 F5 验证二轮实证）。

## 触发器模式（run 31581702243 第二数据点后收敛）

两轮 run（31573910031 / 31581702243）v31 门 workerd 都死在**同一位置**：12 分钟跑的最后 74 秒，恰=fence:174（3×120s 超时重试）收尾时刻；p2 门死在 card-family :449 retry2（3×240s 等 ask-merchant 卡）；production 门死在 m04 image_text 重试（3×240s 等 stage line）。**三门死亡全部尾随「长超时红 spec 的重试拆场」**：这类 spec 每轮重试都留下大量在途 SSE/轮询请求，重试拆场把浏览器连带全部 socket 猛关，workerd 对已关 socket 的写命中 `kj Broken pipe` 且按 FATAL 处理。推论：(1) 修净长超时真红（m04 已修、fence 编舞重排在途、card-family lane 在途）会顺带摘掉当前全部已知触发器；(2) 根修仍需 workerd/miniflare 侧容忍 EPIPE（版本调查），因为任何未来红 spec 都可能再造同型触发。

## 两路工作

1. **缓解（治本）**：workerd Broken pipe 崩溃调查——@cloudflare/workerd-linux-64@1.20260424.1 / miniflare@4.20260212.0 / @cloudflare/vite-plugin@1.25.0 版本组合的已知问题排查与升级评估；不可升级则评估 dev server 崩溃自愈（重启 web 服务并让 playwright 重试当前 spec）或把三门 web 侧换成 production 门同款一等托管 wrangler dev（至少让死亡可见可判）。
2. **检测（V31-64 补口）**：仪器把「vite `Internal server error: fetch failed/terminated` 首帧」识别为 GATE INSTRUMENT FAILURE 信号，与 production 门的进程退出同权——workerd 子进程死亡从此不再伪装成成片 spec 假红。落在 `mkfast-template-main/scripts/e2e/` 仪器族。

## 验收

- 复现或定位 Broken pipe 触发条件（或版本升级后连续 N 轮 CI 无 workerd 死亡）；
- 仪器在 workerd 子进程死亡时给出 GATE INSTRUMENT FAILURE 判决与「NOT evaluated」清单，级联红归零；
- 三浏览器门连续两轮 CI 无「风暴级联」形态红。
