# 主控交接 Handoff — XHS P0 收口 + P1/P2 派发（2026-08-01）

| Field | Value |
| --- | --- |
| 交接原因 | 原主控（Claude Fable 会话）订阅额度将尽，主控职责移交 Grok |
| 状态快照时刻 | 2026-08-01 下午，PR #296 第二轮 CI 进行中 |
| 本文件入库纪律 | **暂不 git add**——ff 收口前 main 不得再动；收官后由新主控随台账提交或删除 |
| 权威链 | 规格 `docs/specs/xhs-vertical-integration-spec-2026-08-01.md`（§11=开发纪律）＞ wayfinder 票 Resolution ＞ 票面文字；通用纪律 `docs/ops/agent-dispatch-runbook-2026-07-29.md` |

---

## 1. 你接手时的悬空状态（最优先）

### 1.1 正在跑的事

- **PR #296（draft，分支 integration/p0-xhs-workbench）第二轮 CI**，头 = `2126218e`。查状态：`gh pr checks 296`。上一轮（rebase 前旧头 59377321）七作业全绿（root-quality 21m13s），本轮是 rebase 到含 ReUI 提交的 main 后的重验，预期绿。
- 原主控挂的后台盯梢任务随会话失效，**自行重查**。

### 1.2 CI 绿后的收官序列（严格照做）

```bash
cd /Users/bin/Desktop/开发/内容无人区/美业内容2   # 主 checkout，当前在 main
# ① 先查 main 有没有又被并发会话推走（见 §4 风险）：
git log --oneline ea868ed4..main    # 空 = 没动，直接 ②；非空 = 先走 §3.2 rebase 流程
# ② ff 合入：
git merge --ff-only integration/p0-xhs-workbench   # main -> 2126218e
# ③ merge-ledger 三行（§2 有整行草稿）→ commit（docs(ledger): ...）
# ④ push：git push origin main    （origin/main 落后 26+ 提交，一次推清）
# ⑤ 三票交验评论 + 关票（§2.3 有草稿）：gh issue close 286 287 288 --comment ...
# ⑥ 查 PR #296 是否被 GitHub 自动标 merged；否则评论说明 ff 合入 + sha 后手动 close
```

### 1.3 若 CI 红

- **root-quality**：两个历史红点都已修（biome 全仓本地 0 错 @1089 文件；评据门 28 锚已换到 rebase 后 style 提交 `16505010`，本地 guard OK）。若仍红，先本地复现：
  - biome：`cd mkfast-template-main && pnpm exec biome check .`
  - 评据门：`node scripts/uiux/opt-in-test-evidence-guard.mjs`
- 其余作业上一轮全绿且本轮产品面 delta 仅 ReUI 提交（非 lane 面）。红了先怀疑 ReUI 提交（`b03bd5c7`）与 lane 无关面，按单文件隔离重跑判别（memory：locale:compile 高负载假红判别法）。

---

## 2. 收官材料（直接可用的草稿）

### 2.1 事实底账

- integration = main(`ea868ed4`) + 15 提交：lane-286 ×3（`2e71d183`/`c679cf61`/`c5b8f9e3`）+ lane-287 ×2（`59d02b19`/`223089d7`）+ lane-288 ×7（`89c22d31`→`ff8ddd62`）+ biome style `16505010` + 评据换锚 `2126218e`。
- 三 lane parity（lane tip vs integration，限 lane 触及文件）已三次验证 diff=0。
- 本地重放全绿：lane-286 interaction **291/291**（47 文件）；lane-287 unit **1553/1550 pass/0 fail**（3 skip）；lane-288 workflow-core+export-adapter **80/80**、contracts kind **5/5**、contracts+core tsc 双 0。
- 评据批：28 个 env-gated 套件全部真跑绿（27 普通 + safe-provision 3/3），锚=`16505010`（rebase 后）。
- 首轮 CI（旧头 59377321）七作业全绿是同产品树的强佐证（rebase 只叠了 docs+ReUI）。

### 2.2 merge-ledger 三行草稿（sha 栏按最终 ff 头与提交数核对后填）

> 行格式照 `docs/ops/merge-ledger.md` 既有表：`| sha（N commits ff）| 票 | 交付 | 主控亲验 | 备注 |`

- **#286 行**：`2126218e（15 commits ff，rebase ×3 后 SHA；lane-286=2e71d183＋c679cf61＋c5b8f9e3）` | #286 | P0-A 工作台四态起步（grok 交付→opus/主控复核→用户直派 claude 重开发补强）：Active 折叠（相位表驱动）＋双滚动修复（去 70svh 内层轴）＋交付去重改 per-run 判定（重开发修真缺陷：旧版按会话相位折叠，第二次 run 直播流会被上一交付连坐收壳；改按 taskId 逐 run）＋CandidateSummaryCapsule＋excerpt 合同整体删除＋recommendation-handoff 去 selectLens('copy') 硬编码（outputHint 类型化）；TEST-CATALOG 记验收旅程 | 主控亲验：lane 重放 interaction 291/291＋integration parity 0；PR #296 CI 七作业全绿（首轮@59377321 与本轮@2126218e） | **#286 关票**；P0-1/2/3/4 由单元+interaction 覆盖，完整 e2e DOM 旅程随 P1 壳票（#313）补，已记档
- **#287 行**：同 sha | #287 | P0-B 记忆诚实（grok 交付→重开发补强）：去 JSON（MemoryValueView 结构化渲染，root-only testid 防嵌套重名）＋sortMemoryEntries 待确认优先＋冷启动诚实 disclaimer 成套 zh/en locale＋辅助函数收私有 | 主控亲验：unit 1553/1550/0 fail 重放＋CI 全绿 | **#287 关票**；P0-5 达成；三层页=#316
- **#288 行**：同 sha | #288 | P0-C kind 合同+付费门（grok v1→修净 v2→opus 假绿修复→claude 重开发架构升级，四段接力）：**分层映射**取代扩枚举（wire kind 二值不动＋contentPackageCarrierOf 派生 media/copy/note；扩枚举两硬伤=下游二分派静默误路由+video→media 有损）；triggersPaidMediaExecution 改 type predicate＋**fail-closed**（无明细过卡；生产 units 恒非空，lens 猜测只会 fail-open）＋PAID_MEDIA_USAGE_RESOURCES 按预留资源联合类型约束＋无消费者的 carrierSchema 删除；copy 免确认 D-043 明文保持；note 调用点=P1 激活钉住；**生产行为变化=0** | 主控亲验：80/80＋5/5＋双 tsc 0＋出口证明三件（拒绝/取消/未授权）＋评据批 28 套件真跑换锚＋CI 全绿 | **#288 关票**；交底=docs/ops/issue-288-p0c-kind-carrier-and-paid-media-gate-handover-2026-08-01.md；遗留已开票：legacy 二分派消费点=#314、note 过卡激活=#317、note schema 写方=#319

### 2.3 三票关票评论要点（主控前缀，逐条对应票面验收）

- **#286**：P0-1 折叠（workbench-mode 相位表单元）/P0-2 单滚动轴/P0-3 per-run 去重（含新回归）/P0-4 outputHint handoff；证据=interaction 291/291、CI production-main-journey 过；合入 sha+ledger 行指针。
- **#287**：P0-5 非 string 不再 JSON.stringify 糊商家；待确认优先排序；冷启动 disclaimer locale 键成套；证据=unit 重放+CI。
- **#288**：P0-6 三口径（分层映射）tsc 绿+门行为（copy 无 hold/含付费媒体有 hold/note 钉 P1）；P0-7 typecheck+套件；出口证明三件、假绿修复（units 生产真实值+变异验证）写明；指向交底文档。

---

## 3. 你会用到的操作手册（本会话踩过的坑，全部实证）

### 3.1 评据门（opt-in test evidence）完整供给

- 环境变量：`TEST_DATABASE_URL` / `TEST_DBOS_SYSTEM_DATABASE_URL`；**DBOS 系套件要求 URL 显式带用户名**：`postgres://bin@localhost:5432/meiye_optin_biz|meiye_optin_dbos`（省用户名→`missing required field(s): username` 红，非产品回归）。
- provision：`bash scripts/ci/provision-test-db.sh`（读上述两 env）。
- 清单：guard 输出的 STALE 即待跑清单；**注意后缀不全是 .postgres.test.ts**（`dbos-registration.smoke.test.ts` 曾被正则漏掉）。
- **safe-provision 套件四层供给**（3 tests，会真删库）：①专用库对 `meiye_issue255`/`meiye_issue255_dbos`（provisioner 白名单只认这两个名，共享 optin 库必拒）；②完整 provision：持锁下无参跑 `node scripts/ci/issue-255-safe-provision.mjs`；③共享 e2e 锁：`echo "pid $$ in <说明>" > /tmp/meiye-e2e.lock`（pid 须为 provisioner 祖先，用完删）；④env：`RUN_ISSUE_255_SAFE_PROVISION_POSTGRES_TEST=1` + `ISSUE_255_SAFE_PROVISIONER_PATH=<仓内 scripts/ci/issue-255-safe-provision.mjs 绝对路径>`（默认路径指向已删除的 lane-255，必须显式指）。
- **rebase 会打断评据锚**（锚 sha 脱离新链，CI guard 必炸）：rebase 后取 `git rev-parse HEAD~1`（最后一个触 p1 的提交之后的任意链上提交），把 JSON 里旧锚整批替换、amend 进评据提交、guard 复验。本会话已走三遍的成熟流程。

### 3.2 rebase 收口标准流程（main 又被推走时）

```
cd integration-p0 worktree → git rebase main
→ 评据锚重写（§3.1 末条）→ amend → guard OK
→ parity 三 lane diff=0 复验 → biome 全仓 → git push --force-with-lease
→ 等 CI → 回 §1.2
```

### 3.3 环境杂项

- **worktrees**：`../integration-p0`（收口用）、`../lane-286|287|288`（合入后可 `git worktree remove` 清理）。
- worktree 缺 `mkfast-template-main/.content-collections/` 会让 web typecheck 报 `Cannot find module 'content-collections'`——从主 checkout 拷贝该目录即可，**非回归**。
- `mkfast-template-main/src/locale/.paraglide-dev.json` = gitignored 运行时心跳文件，本地 biome 会报它，CI 无感，**别修**。
- locale:compile 四命令（typecheck/test/test:interaction/e2e）同 worktree 严格串行（会重写共享 paraglide 产物）。
- 沙箱 `/tmp` 跨命令不共享，中间产物放会话 scratchpad 或仓内。
- gh 连发 issue/评论会触发二级限流：每次间隔 5 秒以上，带重试。
- 仓库 git config 身份是占位符「你的名字/你的邮箱」——全 repo 惯例如此，**不要动历史**；用户想改自会设 config。
- `.wayfinder/`、`references/` 是 gitignore 本地资产，**永不入库**。

### 3.4 多路并发开发：资源占用与排障手册（P1 第一波即四 lane 并行，必读）

**共享资源清单与占用规则**：

| 资源 | 规则 | 出错形态 |
| --- | --- | --- |
| paraglide 产物（每 worktree 一份） | `typecheck`/`test`/`test:interaction`/`e2e` 四命令都以 locale:compile 开头，**重写本 worktree 共享产物**：同 worktree 内四命令彼此串行、且绝不与本 worktree 的 dev server 并跑（dev 换端口也救不了，只能 worktree 隔离）。跨 worktree 天然安全 | dev server 被掀翻、`matchCache` 报错（残留物，非产品缺陷，重跑即消） |
| 并发额度 | 全局同时 **≤3 个**「需基础设施」工作面（PG-backed 测试、dev server、playwright/e2e 各算一面）；纯 Node 单测+typecheck（不带 TEST_DATABASE_URL、不起 dev、无浏览器）**不占槽**；设计/schema/文档/只读分析不占 | 超额=互相拖慢+假红概率陡增 |
| 共享 e2e 锁 `/tmp/meiye-e2e.lock` | e2e 面与 issue-255 provisioner 删库操作共用；跑前查锁（内容=`pid N in ...`，pid 须活且为持锁进程祖先），用完删；pid 已死的孤儿锁可直接清 | 锁被占时 provisioner 硬拒 mutation |
| PostgreSQL（max_connections 300） | 各 lane **各自克隆库**，不共写：黄金模板克隆走 `make-golden.sh`/`clone-cold-db.sh`（0.1s 级）；`meiye_optin_biz/dbos`=评据批共享对；`meiye_issue255*`=safe-provision 专用（会被真删建，别放数据） | 共写一库=竞态假红；连接耗尽 |
| 端口 | dev 默认 3000；e2e 隔离栈=web:3100+core:4110（fixture）；多 lane 同时起 dev 各占端口 | 端口冲突好认，locale:compile 掀翻难认——先想后者 |

**判红三步法**（lane 报「莫名其妙的红」时的第一响应）：
1. 问三件套：是否与 dev/其他测试**同 worktree** 并跑？`git diff` 是否命中被测面？**单文件隔离重跑**红不红？
2. 红形态**每跑不同** ≈ 基建/宿主问题，不是业务红；形态稳定复现才值得进产品面排查。
3. 跨 worktree 或 CI 对照跑一次定性。

**宿主降级假红**（本机 e2e 整批死时）：
- 先 `uptime` + 看 top：fseventsd / appstoreagent 高 CPU 且杀不动 = 宿主维护积压，**无孤儿可清型假红只能重启 Mac**（实证 runbook：`docs/ops/local-e2e-host-degradation-runbook-2026-08-01.md`）。
- 再查孤儿进程：历史实证有 grok 遗留 `yes` 压测吃核、workerd 孤儿引发 22× CONNECTION_REFUSED 连锁；杀孤儿前按 **pid 启动时间 + cwd** 判归属，**别误杀并发会话的进程**（本机常态有多个无关 grok/codex/node 共存）。
- **标准 fallback = draft PR 走 CI 亲验**（实证 PR #283 本机三败、CI 一把绿）；journey 类长 e2e 跑前例行 `uptime`+清孤儿。

**后台任务遗产**：原主控会话的后台盯梢/批跑随会话终止全部失效，接手后不要等通知——`gh pr checks`、`ps aux | grep -E "workerd|codex|grok|node --test"` 自查现场。

---

## 4. 头号风险：并发会话共写本地 main

计费/ReUI 会话（另一个 Claude）持续向**本地 main** 压提交（今日已两轮：credit spec 族 + `b03bd5c7` ReUI/blog-3 产品面）。已实证后果：ff 被堵、CI 绿失效、其 ReUI 提交自带 6 个 biome 错（原主控已在 `ea868ed4` 清理：5 个自动修 + post-card.tsx 一条带理由的 biome-ignore（a11y 误报，render-prop 槽 + aria-label））。

**你的对策**：①每次 ff 前必查 `git log ea868ed4..main`；②撞了就走 §3.2；③收官 push 后 origin/main 追平，窗口变小；④建议向用户提议给并发会话立规矩：合入 main 前 biome 全仓自查。

---

## 5. P0 收口后的下一程：P1/P2 派发

- **票已全部开好**：#313–#328（16 张，编号=开发顺序），票面四段制+「过程留痕与交接纪律」六条已内嵌。规格 §11 为纪律权威（已在 main `219d4e15`）。
- **开闸条件**：P0 收口（三票关+ledger 行）后，第 1 波 = #313（壳+时间线基座，关键路径头）/#314（legacy 消费点小票）/#315（六 prompt 资产）/#316（记忆三层页）四张并行，各自独立 worktree。
- **第 1 波资源脚注（按 §3.4 额度规则）**：#315 是 core/Langfuse 纯 Node 面不占槽；#313/#314/#316 全是 web 面——开发期单测/typecheck 不占槽可全并行，但 interaction/e2e 验证时段要错峰（同刻基础设施面 ≤3，且 #313 大概率要起 dev server 自走 UI）。lane 报红先走 §3.4 判红三步法再升级。
- 关键路径：#313 → #317 → #319 → {#322/#323/#324} → {#326/#327/#328}。
- P2 票（#320–#328）**合入不得先于 P1 验收门（P1-1~P1-8）齐验**（票面已注明）。
- **合入闸补丁（用户 2026-08-01）**：完整 **`production-main-journey` 在单票合入前跑一次即可**（不必每票重跑）；P1-8 本机三文件 e2e 改为可选补证。执行与成品表见 **`docs/ops/p2-merge-batch-handoff-2026-08-01.md`**；P1 验收文已对齐 `docs/ops/p1-acceptance-xhs-2026-08-01.md`。
- 派发模式沿既有：lane agent 领票（认领即评论留痕）、不 push 不关票、主控亲验合入；本轮会话曾定「grok 执行→opus review→主控终核」流水线，新主控格局下如何映射由用户重新拍板。

## 6. 与用户的协作约定（务必延续）

- 每次交互以「哥」开头，中文交流；代码与 commit message 英文。
- 决策项先简报（前后关系+取舍+明确建议）再让拍板，不甩选项卡；拍板即落盘权威文档并在回复里报落点。
- review 双向跑（D-157），复核方取反驳立场；假绿三禁（fixture 值必须生产可产出）；行为为证。
- 深潜中的待决项只记录不打断；长输出分段再合并防截断。
