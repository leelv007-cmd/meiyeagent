# GitHub 账号解封申诉（2026-08-08）

**提交入口**：https://support.github.com/contact/reinstatement（需登录 @leelv007-cmd；被封账号仍可登录支持门户）
**备用入口**：https://support.github.com/request（分类选 Account Access / Reinstatement）

**通道实测（2026-08-08）**：
- 匿名通道被卡死：未登录访问 reinstatement 会被引导到「账户已被标记」的短信验证墙（support.github.com/verification/sms_verification），而其国家列表**没有中国大陆 +86**（只有 Taiwan +886 等），大陆手机号走不通。
- 唯一可行路径＝**先登录 GitHub 账号**（被封账号仍可登录），OAuth 回调后门户直接放行到 reinstatement 表单。
- 若登录后仍要求 SMS：换 email 验证通道 https://support.github.com/contact/cannot_sign_in（验证码发到账号邮箱）。

---

## 申诉正文（粘贴用）

**Subject**: Account suspension appears to be an automated false positive — routine development activity on my own repository (Pro subscriber)

Hello GitHub Support,

My account **@leelv007-cmd** was suspended today (2026-08-08, around 10:20 UTC). All REST and GraphQL API calls now return HTTP 403 "Sorry. Your account was suspended", and the web UI shows a Terms of Service violation notice.

**What I was doing when the suspension occurred:**

I was doing routine project management on my own repository (`leelv007-cmd/meiyeweb-agent`): publishing a batch of 7 engineering specification issues using the official GitHub CLI (`gh issue create`). The issues were created in quick succession (within roughly 5 minutes) and each has a fairly large body (they are detailed development specs), which I suspect pattern-matched an anti-abuse heuristic.

**Why I believe this is a false positive:**

- All 7 issues (#429–#435) are original, legitimate engineering documentation for my own project — development specs for an upcoming feature set.
- The activity touched **only my own repository**. No mentions of other users, no comments on other people's repos, no external links to commercial content, no outreach or mass interaction of any kind.
- The account is used daily for normal software development: commits, pushes, pull requests, and issue tracking on my own repositories — the contribution history reflects consistent, ordinary development work.
- I am a **paying GitHub Pro subscriber** in good standing, and I have received no prior warnings or flags.

**Going forward:**

I understand rapid batch creation can resemble spam patterns. I will rate-limit any bulk issue creation on my repositories (e.g., spacing them out over time) to avoid tripping automated detection again.

I would greatly appreciate a human review and reinstatement of my account, as the suspension is blocking my daily development work (pushes, PRs, and issue tracking are all interrupted).

Happy to provide any additional verification you may need.

Thank you for your time,
@leelv007-cmd
(account email on file: marilyne_suscipitcj@fireman.net)

---

## 事实备忘（如需回答追问）

- 触发时间线：2026-08-08 18:36–18:42（UTC+8）连续 `gh issue create` 7 张（#429–#435），第 8 张时返回 403 suspended。
- 全部 issue 是 V3.1 开发规格（docs/design/0808规划/ 的实施票面），仓库为自有项目。
- 无任何对外行为：零 @提及他人、零跨仓评论、零外链营销内容。
- 账号状态：Pro 付费订阅；日常提交/推送/PR 记录连续。
- 教训已入库（后续批量开票每张间隔 60s+），见 memory `gh-bulk-issue-creation-suspension`。
