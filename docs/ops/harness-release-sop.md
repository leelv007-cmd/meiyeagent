# Harness 发布 SOP（D-038⑤）

本 SOP 约束 DBOS Harness 的版本切换，不代表 `apps/core` 已经有生产部署工作流。当前根 workflow `deploy.yml` 只部署 Web Worker；Core/DBOS 宿主部署登记为 E 门：`E-H06-D038-CORE-DEPLOY`（未实施、不得以本 SOP 或 Web 部署结果代称完成）。

## 发布前：排空 in-flight

1. 先停止新任务进入旧版本（入口限流、维护开关或等价的受控 admission 操作），保留旧 API/worker 处理已接受任务。
2. 在 DBOS system DB 的只读运维视图或等价监控中确认旧版本的 in-flight workflow、等待中的审批/问题和媒体子任务；记录数量、最晚任务 ID 和观测时间。只记录脱敏 ID、SHA 和状态，不复制数据库 URL、token 或其他 secret。
3. 数量归零后再停止旧进程；若超过发布窗口仍不归零，停止发布并恢复 admission，不强杀旧进程。排空证据必须附在发布记录中。

## application version 粘滞与切换

- 每次 Core/DBOS 进程启动都必须显式设置 `HARNESS_DBOS_APPLICATION_VERSION`，值为不可变发布标识（推荐 `harness-<release-sha>`）。同一发布的 API、worker、重启和恢复使用完全相同的值；禁止使用 `latest`、时间变化值或随机值。
- `runtime-config.ts` 中显式变量优先于兼容旧环境的 `DBOS__APPVERSION` fallback。新发布不得只依赖旧变量；质量门使用 `quality-${{ github.sha }}`，只证明当前质量运行的版本身份。
- 切换版本的顺序固定为：停止新 admission → 排空旧 in-flight → 记录旧版本与证据 → 启动新版本并设置新值 → 通过 readiness/最小恢复检查 → 恢复 admission。不得在同一进程或未排空的混合流量中热改 application version。

## 回滚边界

回滚只允许切回上一份已验证、仍兼容现有 DBOS system DB 和业务 schema 的不可变版本，并重新执行排空/启动/恢复检查。保留 system DB、workflow ID、效果键和已写业务事实；不回滚数据库 schema 或删除 in-flight 记录。若新版本已经写入旧版本无法解释的 workflow 状态、快照或 schema，立即停止 admission，进入人工恢复/前向修复；不得盲目切旧二进制或伪造“已回滚”。

## CI 证据

`scripts/ci/assert-harness-release-version.mjs` 必须在 Core quality 和 Web deployment workflow 中执行。它校验质量门设置的 immutable SHA、runtime 的显式变量优先级，以及 Web-only 部署边界；任何缺失或漂移都 fail closed，检查输出不包含 secrets。

## V31-25 runner 收敛发布挂点（D-038⑤ 延续）

三 runner 收敛为单 `CompiledExecutionPlan → DBOS executor` 后，**in-flight durable 实例禁止热切**：

1. **排空挂点**：切换默认执行路径（compiled_plan_executor）前，必须先走上文「发布前：排空 in-flight」——旧 application version 的 workflow / 等待中的审批与媒体子任务归零后再停旧进程。
2. **版本粘滞挂点**：`HARNESS_DBOS_APPLICATION_VERSION` 在 API / worker / 重启 / 恢复必须同值；不得在同一进程内热改路径或热改 application version。
3. **回退挂点**：`force_legacy_five_stage` kill switch（ops-console / admin-config）在收敛后的一个完整 hold 窗口内保持可翻转；翻转后新 admission 走 legacy 标签路径，已 in-flight 的 frozen pins / effect keys 仍由原 application version 粘滞执行到终态。
4. **禁止假热切**：不得用「同一进程内 if (flag) 即时切换 carrier program」冒充发布；路径标签（`executorPath`）仅用于 trace taxonomy / 新 admission 选择，不重写已开始 durable 实例的 effect 拓扑。
5. **shadow 监督**：收敛窗口内 V31-13 shadow 确定性字段对账保持开启（抽样）；mismatch 只记 evidence，不改生产结果。连续 2–4 周 mismatch=0 后再评估关闭 shadow（D8）。
