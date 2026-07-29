#!/usr/bin/env bash
# Issue #261 preconditions gate.
#
# #261 (Dashboard single-route three sections) sits in batch D of the frontend
# lane and cannot start until its upstream tickets land on main. This script
# checks each precondition against the *main* branch (read via `git show`, so it
# works from any worktree and never touches the working tree) and prints a
# GO / NO-GO verdict.
#
#   ./docs/tickets/261/gate.sh            # one-shot check, exit 0 = GO
#   ./docs/tickets/261/gate.sh --watch    # re-check every 10 min until GO
#   ./docs/tickets/261/gate.sh --quiet    # exit code only
#
# Authority: docs/ops/agent-dispatch-runbook-2026-07-29.md
#            docs/specs/agent-substrate-dev-spec-2026-07-29.md (排期与并发 v4.1)

set -uo pipefail

REPO="$(git rev-parse --show-toplevel)"
REF="${GATE_REF:-main}"
WATCH_INTERVAL="${GATE_WATCH_INTERVAL:-600}"
QUIET=0
WATCH=0

for arg in "$@"; do
  case "$arg" in
    --watch) WATCH=1 ;;
    --quiet) QUIET=1 ;;
    --help|-h) sed -n '2,20p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
[ -t 1 ] || { BOLD=""; RED=""; GREEN=""; YELLOW=""; OFF=""; }

# Read a file's content from the target ref. Empty output = file absent.
at_ref() { git -C "$REPO" show "$REF:$1" 2>/dev/null; }

# Does a path exist on the target ref?
exists_at_ref() { git -C "$REPO" cat-file -e "$REF:$1" 2>/dev/null; }

PASS=0
FAIL=0
declare -a BLOCKERS=()

report() { # name, status(ok|no), detail, owner
  local name="$1" status="$2" detail="$3" owner="$4"
  if [ "$status" = "ok" ]; then
    PASS=$((PASS + 1))
    [ "$QUIET" = 1 ] || printf '  %s✔%s %-34s %s\n' "$GREEN" "$OFF" "$name" "$detail"
  else
    FAIL=$((FAIL + 1))
    BLOCKERS+=("$name — $detail (等 $owner)")
    [ "$QUIET" = 1 ] || printf '  %s✘%s %-34s %s %s(等 %s)%s\n' "$RED" "$OFF" "$name" "$detail" "$YELLOW" "$owner" "$OFF"
  fi
}

check_all() {
  PASS=0; FAIL=0; BLOCKERS=()

  # ---- G1 · #266 locale:compile 并发冲突机制修复 -------------------------
  # 合入判据：compile-locale.ts 不再是 11 行裸编译，出现暂存目录回写 + 互斥锁。
  local compile
  compile="$(at_ref mkfast-template-main/scripts/compile-locale.ts)"
  if printf '%s' "$compile" | grep -qi 'lock' && printf '%s' "$compile" | grep -qiE 'stage|write-if-changed|writeIfChanged'; then
    report "G1 #266 locale 并发机制" ok "compile-locale.ts 已含锁与 write-if-changed" "-"
  else
    report "G1 #266 locale 并发机制" no "compile-locale.ts 仍是裸全量编译" "#266"
  fi

  # ---- G2 · #248 三轴扁平键事件合同 ------------------------------------
  # 合入判据：packages/contracts 里出现三个扁平顶层键同现于同一处。
  # #248 票面定义的键名为 skillRevision / promptVersion / catalogRevision。
  local contracts_hits axes
  contracts_hits="$(git -C "$REPO" grep -l -E 'skillRevision|skillVersion' "$REF" -- 'packages/contracts/src/*.ts' 2>/dev/null || true)"
  axes=0
  for key in skillRevision promptVersion catalogRevision; do
    git -C "$REPO" grep -q "$key" "$REF" -- 'packages/contracts/src/*.ts' 2>/dev/null && axes=$((axes + 1))
  done
  if [ "$axes" -eq 3 ] && [ -n "$contracts_hits" ]; then
    report "G2 #248 三轴事件合同" ok "三轴键已在 packages/contracts 定义" "-"
  else
    report "G2 #248 三轴事件合同" no "三轴仅 $axes/3 存在于 contracts（skillVersion/skillRevision 缺失）" "#248"
  fi

  # ---- G3 · 成功分支的实际结算值供给 ------------------------------------
  # 用户裁定（2026-07-29，DECISIONS D5）：拒绝＝真实消耗 0，就地明示「本次未
  # 消耗额度」，零后端依赖 —— 故**拒绝分支不再受本门约束**。本门收窄为只管
  # 成功分支的「本次实际结算」取数。前端已有 debitUnitsFor 的镜像
  # (composer/quota-blocking.ts:226)，够不够权威由实装时对账决定。
  # 判据必须落在**前端够得着的合同面**（packages/contracts）。只查 apps/core
  # 会把账本内部的 `payload->'settledUnits'` JSON 列表达式当成已交付 —— 那是
  # 存储细节，前端读不到。这是本门第三次踩同一类假绿，故判据写死到合同面。
  if git -C "$REPO" grep -qiE 'settledUnits|settlementUnits' "$REF" -- 'packages/contracts/src/*.ts' 2>/dev/null; then
    report "G3 成功分支实际结算取数" ok "结算单位已上合同面，前端可读" "-"
  else
    report "G3 成功分支实际结算取数" no "结算单位只在 core 账本内部，未上合同面" "#248（拒绝分支已解锁）"
  fi

  # ---- G3b · #262 三轴钉扎进 Task 快照 ----------------------------------
  # #261 的评价事件要带三轴值，但值本身由 #262 钉扎进 Task 快照才取得到。
  # 票面未列这条依赖 —— 只定了键名（#248）不等于运行时读得到值。
  # 判据必须避开既有的 `skillRevisionRefs`（creation-experience 的数组字段，
  # 与三轴钉扎无关）—— 只认 #262 票面点名的钉扎载体与降级留痕字段同现。
  local pin_axes=0
  for key in assemblyRef pinnedAxes fallbackReason; do
    git -C "$REPO" grep -q "$key" "$REF" -- 'apps/core/src/p1/harness' 'apps/core/src/p1/model-supply' 2>/dev/null && pin_axes=$((pin_axes + 1))
  done
  if [ "$pin_axes" -ge 2 ]; then
    report "G3b #262 三轴钉扎 Task 快照" ok "快照钉扎载体 + 降级留痕已在" "-"
  else
    report "G3b #262 三轴钉扎 Task 快照" no "三轴无运行时取数点，事件发不出真值" "#262"
  fi

  # ---- G4 · #264 FE 半合入（D lane 串行前序） ---------------------------
  # 判据修正（2026-07-29）：原探针验 apps/core 的 videoRegenScopes 是否清空 —— 那是
  # #264 的 **core 半**，台账 43238d5f 行明写 core 半仍等 C2 明文开工。#261 的串行前序
  # 只是 **FE 半**（spec :601 语义锁锁的是「前台创作面」）。拿 core 半当判据 = 永远为
  # 假，把已经开的门判成关的。改验 FE 半真正交付的面：商家侧视频编辑入口摘除。
  if ! git -C "$REPO" grep -q -E 'subtitle_text_edit|cover_select' "$REF" -- 'mkfast-template-main/src' 2>/dev/null; then
    report "G4 #264FE 视频编辑面退役" ok "商家侧编辑入口已摘（core 半另计，等 C2）" "-"
  else
    report "G4 #264FE 视频编辑面退役" no "前台仍有 subtitle_text_edit/cover_select 入口" "#264FE"
  fi

  # ---- G5 · 前端 lane 槽位空闲（lane 内严格串行） -----------------------
  # D lane 只占 1 个额度槽：#264FE → #261 → #253FE。前序 lane 分支若还有
  # 未合入 main 的提交，说明它还在飞，#261 不得同时占槽。
  # 只数**碰源码**的提交：runbook :15 明确「设计、schema、文档、只读分析不占额度」，
  # 所以另一条 lane 的门脚本/设计稿提交不构成占槽。
  local busy=""
  for br in issue-264 issue/253; do
    if git -C "$REPO" rev-parse --verify --quiet "$br" >/dev/null 2>&1; then
      local src_commits
      # 只数碰**前台**的提交：D lane 的串行锁是「前台创作面」（spec :601）。
      # 同一票的后端半（apps/core）走的是别的批次，不占前端 lane 的槽。
      src_commits="$(git -C "$REPO" rev-list --count "$REF..$br" \
        -- 'mkfast-template-main/src' 2>/dev/null || echo 0)"
      [ "$src_commits" -gt 0 ] && busy="$busy $br(+$src_commits src)"
    fi
  done
  if [ -z "$busy" ]; then
    report "G5 前端 lane 槽位" ok "无前序 lane 在飞" "-"
  else
    report "G5 前端 lane 槽位" no "前序 lane 仍在飞:$busy" "主控"
  fi

  # ---- G6 · 三项形态未定项的用户拍板（票面「形态争议交用户拍板」）-------
  # 判据：本票目录下出现 DECISIONS.md 且不含 PENDING 标记。
  # 判据只认条目的状态行，不认散文里提到的 PENDING 三个字母 —— 否则文件
  # 自己解释判据的那句话会把门永远钉死。工作区版本优先（裁决可能尚未 commit）。
  local decisions
  decisions="$(cat "$REPO/docs/tickets/261/DECISIONS.md" 2>/dev/null || at_ref docs/tickets/261/DECISIONS.md)"
  local open_items
  open_items="$(printf '%s' "$decisions" | grep -c '状态：\*\*PENDING\*\*' || true)"
  if [ -n "$decisions" ] && [ "$open_items" -eq 0 ]; then
    report "G6 形态未定项已拍板" ok "五项全部 DECIDED" "-"
  else
    report "G6 形态未定项已拍板" no "$open_items 项未拍板（见 DECISIONS.md）" "用户"
  fi
}

run_once() {
  [ "$QUIET" = 1 ] || {
    printf '\n%s#261 开工门检查%s  ref=%s  %s\n' "$BOLD" "$OFF" "$REF" "$(git -C "$REPO" rev-parse --short "$REF")"
    printf '%s\n' "────────────────────────────────────────────────────────────────"
  }
  check_all
  [ "$QUIET" = 1 ] || {
    printf '%s\n' "────────────────────────────────────────────────────────────────"
    if [ "$FAIL" -eq 0 ]; then
      printf '%s%s GO %s  %d/%d 全过 —— #261 可开工\n\n' "$BOLD" "$GREEN" "$OFF" "$PASS" "$((PASS + FAIL))"
    else
      printf '%s%s NO-GO %s  %d/%d 未过：\n' "$BOLD" "$RED" "$OFF" "$FAIL" "$((PASS + FAIL))"
      for b in "${BLOCKERS[@]}"; do printf '    · %s\n' "$b"; done
      printf '\n  现在允许做的只有零 rebase 面预备（设计稿／schema 草案／只读盘点）\n'
      printf '  —— runbook %s\n\n' "docs/ops/agent-dispatch-runbook-2026-07-29.md:8"
    fi
  }
  [ "$FAIL" -eq 0 ]
}

if [ "$WATCH" = 1 ]; then
  # Self-limiting: give up after GATE_WATCH_MAX_HOURS so a forgotten watcher
  # cannot outlive the work it is watching for.
  MAX_HOURS="${GATE_WATCH_MAX_HOURS:-12}"
  MARKER="$REPO/docs/tickets/261/.gate-open"
  deadline=$((SECONDS + MAX_HOURS * 3600))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if run_once; then
      git -C "$REPO" rev-parse --short "$REF" > "$MARKER"
      command -v osascript >/dev/null 2>&1 && \
        osascript -e 'display notification "#261 前置全部满足，可开工" with title "开工门 GO"' >/dev/null 2>&1
      exit 0
    fi
    sleep "$WATCH_INTERVAL"
  done
  [ "$QUIET" = 1 ] || printf '%s watch 到时退出（%s 小时未开门）%s\n' "$YELLOW" "$MAX_HOURS" "$OFF"
  exit 3
else
  run_once
fi
