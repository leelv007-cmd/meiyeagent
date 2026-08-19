# V31-67 — issue-255-safe-provision 套件依赖仓外已删路径，默认又静默 skip（仪器缺陷）

**Parent**: opt-in 证据刷新轮（2026-08-12）发现
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-43（issue-255 live collector，另一套件勿混）
**Status**: implementation-complete / local-verification-passed（2026-08-20）— 仓内 provisioner、显式 opt-in、专属双库与机器可验 self-drop receipt 已落地；待合入后同 SHA 96-file 校准复跑

**Implementation state**: implemented
**Verification state**: locally verified（focused full persistence runner 3/3；required 96-file integration rerun pending）
**Evidence SHA**: 9f96d74d02ddaa681d2ecfc0d468fbb563245b46
**Workflow Run**:
**Artifact Digest**: sha256:7deea4b8577e912e38db0e60b9afb292facd9f20bd7171172282300bf9b5f52c

## 症状

`apps/core/src/p1/harness/issue-255-safe-provision.postgres.test.ts`：默认 3 case 全 skip（门控 `RUN_ISSUE_255_SAFE_PROVISION_POSTGRES_TEST==='1'`）；带 opt-in 则 3 case 全红——shell 到 `ISSUE_255_SAFE_PROVISIONER_PATH`（默认 `~/.codex/monitors/issue-255-safe-provision.mjs`），该 shim 读 digest 钉住的 `…/lane-255/scripts/ci/issue-255-safe-provision.mjs`，**路径已不存在**（子进程 ENOENT，非产品断言）。「不带 opt-in 恒静默绿、带 opt-in 恒环境红」，两头都不产真信号。

## 实施与验证（2026-08-20）

1. `scripts/ci/issue-255-safe-provision.mjs` 作为仓内唯一 provisioner；96-file
   persistence runner 仅对本票文件派生固定
   `meiye_issue255` / `meiye_issue255_dbos` 双库，并显式设置 opt-in 与仓内绝对路径。
2. 专属双库操作由 `/tmp/meiye-e2e.lock` 原子互斥；锁冲突或固定库残留均
   fail closed，不清他人锁，不把主 `meiye_instrument_*` pair 传给 destructive provisioner。
3. 本文件的 results 行必须携带 `persistence-file-provision/v1` receipt，绑定
   same-SHA、fresh、实际 pair 指纹、固定库名、`selfDropped=true` 和 `dropVerifiedAt`。
   verifier 已有反例：receipt 指向 issue255 pair 但文件冒用主 pair 必须拒绝。
4. 精确代码提交 `9f96d74d0` 上的完整 focused runner 使用真实本地 PostgreSQL：
   **3 pass / 0 fail / 0 skip**；`pairsEqual=false`；测试后主 pair 仍存在，
   issue255 残留库为 0，最终 evidence 保留专属 receipt。本地一次性主 pair 与共享锁均已清理。
5. 本轮未产生远程 Workflow Run，不冒充 required CI；合入后仍需在最终
   Integration SHA 上复跑完整 96-file persistence instrument。
