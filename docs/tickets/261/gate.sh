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

  # ---- G3 · #248 「本次消耗从执行返回值直取」供给 -----------------------
  # #261 的成本即时反馈（含被拒）依赖这条供给，属主是 #248 而非本票。
  if git -C "$REPO" grep -qiE 'rejected.*(consum|debit|units)|planningUnits|plannedUnits' "$REF" -- 'packages/contracts/src/*.ts' 'apps/core/src/p1/product-billing/*.ts' 2>/dev/null; then
    report "G3 #248 被拒消耗供给" ok "契约/账本已暴露被拒消耗字段" "-"
  else
    report "G3 #248 被拒消耗供给" no "无被拒/规划消耗字段，成本反馈无数据源" "#248"
  fi

  # ---- G4 · #264 FE 半合入（D lane 串行前序） ---------------------------
  # 合入判据：视频编辑四动作真退役。videoRegenScopes 应为空或模块不存在。
  local regen
  regen="$(at_ref apps/core/src/p1/model-supply/video-regeneration.ts)"
  if [ -z "$regen" ] || ! printf '%s' "$regen" | grep -q "'shot'"; then
    if ! git -C "$REPO" grep -q -E 'subtitle_text_edit|cover_select' "$REF" -- 'mkfast-template-main/src' 2>/dev/null; then
      report "G4 #264FE 视频编辑面退役" ok "四动作已退役，前台入口已摘" "-"
    else
      report "G4 #264FE 视频编辑面退役" no "core 已退役但前台仍有 subtitle_text_edit/cover_select 入口" "#264FE"
    fi
  else
    report "G4 #264FE 视频编辑面退役" no "videoRegenScopes = ['shot'] 仍在" "#264FE"
  fi

  # ---- G5 · 前端 lane 槽位空闲（lane 内严格串行） -----------------------
  # D lane 只占 1 个额度槽：#264FE → #261 → #253FE。前序 lane 分支若还有
  # 未合入 main 的提交，说明它还在飞，#261 不得同时占槽。
  local busy=""
  for br in issue-264 issue/253; do
    if git -C "$REPO" rev-parse --verify --quiet "$br" >/dev/null 2>&1; then
      local ahead
      ahead="$(git -C "$REPO" rev-list --count "$REF..$br" 2>/dev/null || echo 0)"
      [ "$ahead" -gt 0 ] && busy="$busy $br(+$ahead)"
    fi
  done
  if [ -z "$busy" ]; then
    report "G5 前端 lane 槽位" ok "无前序 lane 在飞" "-"
  else
    report "G5 前端 lane 槽位" no "前序 lane 仍在飞:$busy" "主控"
  fi

  # ---- G6 · 三项形态未定项的用户拍板（票面「形态争议交用户拍板」）-------
  # 判据：本票目录下出现 DECISIONS.md 且不含 PENDING 标记。
  if exists_at_ref docs/tickets/261/DECISIONS.md && ! at_ref docs/tickets/261/DECISIONS.md | grep -q 'PENDING'; then
    report "G6 形态未定项已拍板" ok "DECISIONS.md 无 PENDING" "-"
  else
    report "G6 形态未定项已拍板" no "金额/条数口径等未拍板（见 00-blockers.md）" "用户"
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
  while true; do
    if run_once; then
      command -v osascript >/dev/null 2>&1 && \
        osascript -e 'display notification "#261 前置全部满足，可开工" with title "开工门 GO"' >/dev/null 2>&1
      exit 0
    fi
    sleep "$WATCH_INTERVAL"
  done
else
  run_once
fi
