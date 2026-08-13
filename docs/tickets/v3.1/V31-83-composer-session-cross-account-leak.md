# V31-83 — P0：composer 会话状态跨账号泄漏（sessionStorage 键无作用域、登出不清）

**Parent**: 能力基线盘点第二轮（`docs/reviews/capability-baseline-audit-r2-2026-08-13.md` §0.1）
**批次**: 清红队列（P0，隐私/租户隔离）
**Blocked by**: 无
**Related**: V31-02（session 持久化）、V31-04（reducer/workstream）、V31-82（被泄漏渲染的正是悬死 work）

**Status**: open（2026-08-13）— 盘点取证，未派工

**Implementation state**: not-started
**Verification state**: reproduced（同 tab 换号登录，刷新不清；删键即愈=根因闭环）
**Evidence SHA**: 1baf207461e57fd4fafbdce250a4582ddef03bcb
Evidence 注：取证组合=四号（悬死 work 属主）→二号（登入后看到四号时间线/运行态/草稿）
**Workflow Run**:
**Artifact Digest**:

## 症状与根因

`sessionStorage['composer-session::composer-session/v1']` 存 composer 会话绑定，
键名**不含 userId/workspaceId**，登出不清、登录不校验属主 ⇒ 同一浏览器 tab 换号后，
新账号 dashboard 原样渲染上一账号的 thread 时间线、运行中 work（含 UUID）、输入草稿，
并以「正在恢复连接」尝试重连其流。店主/店员共机是真实场景，属内容级隐私泄漏。

## What to build

1. 键加作用域（userId 或 workspaceId 入键）＋读取时校验属主（不匹配即弃）。
2. 登出流程清空本产品全部会话级客户端状态（sessionStorage 白名单清单化）。
3. **服务端边界定性（修前必答）**：以正确 query/stream schema 验证跨号请求他人
   work/session 是否 4xx——若服务端也放行，本票升级并另拆服务端票。
4. 回归测试：同 context 换号登录的 e2e（A 创作→登出→B 登录→断言无 A 内容）。

## Acceptance criteria

- [ ] 服务端边界定性结论落票
- [ ] 换号后零他人内容（e2e 先红后绿）
- [ ] 登出清态白名单＋单测
- [ ] 悬死/正常 run 两种场景均验证
