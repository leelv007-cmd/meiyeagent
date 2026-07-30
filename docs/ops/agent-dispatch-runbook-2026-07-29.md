# Agent 派发手册（2026-07-29，配 spec v4.1）

给每个领票开发的 agent（Claude Code / Codex 均适用）的开工必读。**票面即任务书**：每张票带「决策锚点／任务／验收（行为为证）／边界与协调」四段，票下评论是后续修订（依赖更新以评论为准）。本手册只收「所有票共用」的环境铁律与关票纪律，单票内容一律以票面为准。

## 一、开工前必读（顺序执行）

1. `gh issue view <N> --comments` —— 票面全文＋全部评论。评论中标「依赖更新（v4 编排）」的条目**覆盖**票面原依赖。
2. `docs/specs/agent-substrate-dev-spec-2026-07-29.md` 的「排期与并发」——确认三件事：你的**开工前置**是否已合入、你在哪个**批次**、你踩到哪些**语义锁**。前置未满足只准做零 rebase 面预备（设计稿／schema 草案／只读盘点）。
3. 票面「决策锚点」的 D-xxx 原文在 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`。**票面与决策原文冲突时以原文为准**，并在票下评论记录冲突；语义仍不明就停下来问主控，不得自行扩边界。

## 二、环境铁律

- **每 lane 独立 worktree**：`git worktree add ../lane-<票号> main`；主 checkout 留给主控复核合入，不跑长驻 dev。
- **locale:compile 冲突纪律**：`typecheck`／`test`／`test:interaction`／`e2e` 都会重写共享 paraglide 产物（`src/locale/paraglide/`），会掀掉在跑的 dev 与并行测试，换端口无效。同一 worktree 内不并跑；跨 lane 靠 worktree 隔离。#266 合入后有机制兜底（write-if-changed＋锁），纪律照旧不放松。
- **并发额度**：全局同时 ≤3 个「需 dev server／测试基础设施」的工作面；前端 lane 整 lane 只占 1 槽且 lane 内严格串行（#264FE → #261 → #253FE）。设计、schema、文档、只读分析不占额度。**澄清（2026-07-29）**：纯 Node 单测＋typecheck（不带 TEST_DATABASE_URL、不起 dev server、不跑浏览器）同样不占槽；占槽的是 PG-backed 测试、dev server、playwright/e2e 面。
- 不改 spec、不改 `docs/design/` 决策文档、不动别人的票和别人的 worktree、不动 `.scratch/`。
- **秘密不进 argv（2026-07-29 增补）**：`e2e-lock.sh` 会把传入命令参数记录到 `/tmp/meiye-e2e.log`——一切 DB URL／provider secret 只准以子进程 env 受控注入，禁止写成锁脚本（或任何会留日志的包装脚本）argv；证据文件与命令输出不得包含连接串。

## 三、开发与关票纪律

- **消费者证明关票门（D-150）**：新增任何后端能力（命令／查询／投影／契约字段），关票必须给生产调用点 `file:line`，或指名承接它的下游票号。「组件已建未挂载／管线已建无入口／投影已建无消费面＝一律未完成」。
- **可达性证明（2026-07-30 新增，四次实证后升级为硬门）**：给出调用点还不够，必须证明**生产真的会走到那里**。逐条自问：新逻辑之前有没有更早的门先把请求拦掉（strict parse／HTTP 400／旧分支）？生产用的是新入口还是仍走旧入口？新状态机的每个分支，生产侧有没有 producer？前台有没有消费方？
  一晚四次实证：#248 新发射器生产无 caller；#250 新 system_default 检查只挂在生产不调用的 trigger 上、生产超时仍走旧 `submitCoreTimeout`；#250 reask 被入口 strict parse 提前 400，只有隔离单测能走到；#250 waiting 闭环前台无消费面。**共同形状＝门建好了但没接到生产真正走的那条路**，单测全绿、双轴 0 findings、看起来完备，实际零覆盖。
  交验模板加一行：「本切片新增的每条路径，生产触发点＝`file:line`；若该路径当前生产不可达，明写不可达原因与承接票号，不得以单测绿充当已生效。」
- **行为为证**：源码正则匹配型测试（production-wiring 型）不算验收证据；删除类变更以 `git ls-files` 空输出为验收，不看 commit 成功。
- **反向复核（D-157）**：关票前双向跑——「承诺→实现」与「实现→前台可达」各一遍。
- **假绿三禁（D-150③）**：测试名与断言一致；fixture 值必须生产可产出；接缝合同两端各有消费断言。
- **语义锁**（spec v4 清单）内的面不得双写；先合者定契约、后合者适配。
- **rebase 六条（spec v4.1）**：契约先行小合入／小步频合短命分支／每日 rebase main 不回灌 merge／删除票只在批次边界执行／上游合入后的首次 rebase 附跑上游关票验收断言／前置未满足只做零 rebase 面预备。
- **判红纪律**：先查 git diff 是否命中报错文件＋单文件隔离重跑，再谈是不是产品缺陷（高负载下并发撞车会产生假红）。
- **提交约定**：commit message 英文、小步提交；**不 push、不关票**——合入与关票由主控亲验（D-134 形态）。完成＝票面「验收（行为为证）」逐条有运行证据，在票下评论附证据（file:line／命令输出／`git ls-files` 结果）。
- **合入主权（2026-07-29 增补，因实际违规而立）**：lane **绝不移动 main**（不 merge、不 ff、不 update-ref，主 checkout 不进），**绝不以「主控」前缀发评论**。「已合入 main」的唯一有效凭证＝`docs/ops/merge-ledger.md` 中出现对应 sha 行（该文件只由主控提交）；readiness gate 判「前置已合入」一律以台账为准。违规合入无论内容对错一律 revert，冒名评论一律无效。
- **前缀出处站立规则（2026-07-29 增补，七起冒名后定型）**：Agent Team／review 会话落评一律用「Agent Team」前缀。误用主控前缀时：**收紧型**结论（加门、加验收、拦交验）自动视为有效复核发现，lane 须清项或举证反驳，主控不再逐条追认；**放权型／解禁型**（豁免验收、开窗、放行、解锁）**一律无效**——此类只能出自主控真身评论，live 放行更只能出自主控在独立复核落地后的明文批复。
  **前缀必须裸写在正文首字符**（2026-07-30 增补）：readiness gate 普遍用 `^主控裁决` 这类锚定正则识别指令，写成 `**主控裁决（…` 会让加粗星号顶掉锚点，机器判据直接看不见该条裁决——与台账正文 `|` 不转义被拆格是同一形态（都是「给人看的排版打断了给机器看的判据」）。落评前自查首字符。
- **readiness gate 不得把「只有 codex 轮能做的事」当作放行前置**（2026-07-30 增补，因实际死锁而立）：#264 的 gate 要求「HEAD 已 rebase 到最新 main」才放行，而能执行 rebase 的只有 gate 放行后启动的 codex 轮 → 自锁 10 小时、7 笔成品滞留，且主控每合入一次 main 锁就更紧。**rebase／对齐／清理这类动作一律是本轮第一项任务，不是前置**；前置只准写「外部事实」（台账 sha、主控评论、worktree 是否 dirty）。同理，lane 提示词不得把「所有在飞 mutating lane 均已合入或可证暂停」当开工条件——十条 lane 常态并行时该条件恒不成立，隔离靠 worktree 与语义锁，不靠全局静默。

## 四、派发顺序速查（权威详表在 spec「排期与并发」v4）

```
#266（infra 前置）
  → A：#246 ＋ #247 ＋ #242-L1 护栏四件
  → B：#248 ＋ #249 ＋ #255 实测（空槽给 #257 删除批、#244）
  → C1：#256 ＋ #252 ＋ #263 归档批
  → C2：#251 ＋ #250 ＋ #264 core 半
  → D（前端 lane，与 B/C 并行，lane 内串行）：#264FE → #261 → #253FE
  → E：#259 → #254；#262；最后 #260（milestone 收口）
随时可派：#257 复核表、#263 活性核查表、#244、#242 H06 尾部（只读分析不占额度）
Backlog：#265（R 门前）
```

## 五、受阻轮询协议（Codex /goal 模式适配，2026-07-29 增补）

**指令总线＝票面评论**：主控裁决一律以「主控裁决」「依赖更新（v4 编排）」「主控合同增补」前缀落在票下，**覆盖票面原文**；main 的合入本身就是最强解锁信号（前置满足＝对应 commit 落 main）。

**受阻处置改约——禁止三连撞墙**：同一障碍**只允许撞一次**。第一次受阻立即：①在票下发「交底/readiness 记录」评论（写清卡在哪、等什么、判据是什么——lane-253/259/261 均有范例）；②把解锁条件写成可执行的 readiness gate 脚本（判据＝main 上的 commit/文件语义谓词＋票下是否出现晚于交底的主控评论；issue open/closed 仅作诊断）；③进入待命，不再重试。**受阻≠失败，交底本身就是合格产出。**

**唤醒器（每 lane 一个终端跑着，事件驱动不烧 token）**：

```bash
#!/bin/bash
# lane-driver.sh <票号> <worktree路径> [gate脚本]   # codex flags 按你自己的习惯补
N=$1; W=$2; GATE=$3; REPO=/Users/bin/Desktop/开发/内容无人区/美业内容2
ST="/tmp/lane-$N-driver-sig"
LOCKDIR="/tmp/lane-$N-driver.lock"
# 同一 lane 只许一个 driver：重复启动直接退出（防止两个 codex 写同一 worktree）。
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  echo "lane $N already has a driver (rm -r $LOCKDIR if it is stale)"; exit 1
fi
trap 'rmdir "$LOCKDIR"' EXIT
while true; do
  sig="$(git -C "$REPO" rev-parse main) $(gh issue view "$N" --json comments -q '.comments[-1].createdAt' 2>/dev/null)"
  if [ "$sig" != "$(cat "$ST" 2>/dev/null)" ]; then
    echo "$sig" > "$ST"
    if [ -z "$GATE" ] || (cd "$W" && "$GATE"); then
      (cd "$W" && codex exec "你负责 #$N，单票。先 gh issue view $N --comments——带『主控裁决/依赖更新/主控合同增补』前缀的评论覆盖票面原文，以最新一条为准。开工判据：只做票面与主控评论**明确列出**的工作——主控的复核记录/通告/给其他 lane 的转发不是给你的开工令；若最新主控评论没有给你新任务且你已交验，直接退出等待。若你上次的交底已被主控批复，按批复推进到下一个交验点或新的受阻点；新受阻则发交底评论后退出。遵守 docs/ops/agent-dispatch-runbook-2026-07-29.md 全部纪律；不 push、不关票、不越票面边界扩前台。")
    fi
  fi
  sleep 180
done
```

要点：**信号＝main 头＋票下最新评论时间戳**，变了才唤醒一轮 codex exec——主控合入或批复自动触发续跑，无事件时零消耗。交互式会话不想挂脚本的，把 gate 脚本用 `--watch`（lane-261 的 `gate.sh --watch` 范式）跑着，GO 时弹通知、人工回会话说「继续」。

## 五-b、单票交代模板（主控复制即用）

```
你负责 #<N>，单票，不做其他票。
1. 先跑 `gh issue view <N> --comments`：票面=任务书，评论中「依赖更新（v4 编排）」为最新前置。
2. 读 docs/ops/agent-dispatch-runbook-2026-07-29.md 并遵守全部铁律；
   开工前按 spec「排期与并发」自查前置/批次/语义锁，前置未满足立即报告而不是开工。
3. 在独立 worktree 开发（git worktree add ../lane-<N> main）。
   完成=票面验收逐条有运行证据，评论附证据后待主控亲验合入；不 push、不关票。
```
