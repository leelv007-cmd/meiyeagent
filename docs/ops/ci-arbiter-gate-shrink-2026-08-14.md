# CI 裁决权与门收缩（2026-08-14，用户拍板）

> 权威决策文档。本文改变的是「谁有权阻塞合并」，不是任何红的可见性。
> CURRENT（docs/ops/current-project-status.md）§1/§3a 已按本文回写。

## 0. 背景：死循环的高维归因

近 14 天 1210 个提交中，能力盘点（2026-08-13 五路深审）仅 1/17 available；主要
时间消耗在「修仪器」而非「修产品」：

1. **仪器债**：42-spec 全浏览器门本身是个分布式系统（Core/workerd/Vite/
   Playwright/PG/DBOS/locale:compile/端口/fixture），故障模式比被测产品多。
   08-12 定性：42 红中仅 7 真，误报率约 83%。每次修仪器作废之前的整轮测量。
2. **信任层级倒置**：「本地全门绿 → 才开 PR → 才跑 required CI」把最可靠的
   裁判（CI 干净环境）锁在最不可靠的仪器（宿主退化的本机）后面。结果：
   Integration SHA 上 required CI 从未运行，每个红都要人工法证「真红还是假红」
   ——这就是死循环每天真正消耗时间的内容。
3. **验证金字塔沙漏化**：单测大片绿但对「能力可用」零信息量；浏览器门信息量
   全但成本/可靠性不可用；中间层（不开浏览器断言旅程可走的合同测试）缺失。

用户于 2026-08-14 晚认可以上归因并拍板下述决策。

## 1. 决策

- **D1（裁决权）**：CI 在真实 push SHA 上的 `Core quality / required` 是唯一
  ground truth。本地 42-spec 全浏览器门降级为**调试工具**：不再作为 release、
  关票、解冻或任何结论的依据；本地绿证不得再拼接、代替或预支 CI 判定。
- **D2（硬门收缩）**：`required` 聚合收缩为——非浏览器质量 job（redline-evals /
  core / session-quick-checks / root-quality / core-persistence /
  production-dependency-audit）＋两个浏览器判定：`production-main-journey`
  （assembly＋M-04 硬门＋三模态主线 smoke）与 `v31-day0-gate`（零素材首访
  release gate，retro R1/V31-77 的落地形态）。
- **D3（遥测不阻塞）**：`p2-browser-acceptance` 与 `v31-browser-report`
  （原 v31-browser-acceptance 的 remaining 部分，逐文件 `--retries=0`、逐文件
  verdict）每个 PR 照跑，红在 PR checks 与 `v31-file-verdicts.log` 中可见，但
  不阻塞 `required`。任一旅程要回到阻塞集，须显式决策并记录，不是默认。
- **D4（发布线）**：发布线回到 `meiyeagent`（leelv009 仓）。一号线
  （legacy-origin-a）仍受限：其仓 Actions 全史 0 次运行、PR 事件不创建
  check-suite，今日在其上开的 PR（legacy-web-repo #436）**废弃不再使用**。
- **D5（身份与冻结度量）**：本仓 git 身份改为 leelv009（新提交不再携带旧账号
  署名；历史提交不重写——远端已有同类署名，重写只会作废全部 SHA 锚点）。
  功能冻结以**提交数**度量而非票数：冻结期产品面提交应趋近于零，例外须在
  决策文档留痕。

## 2. 实施（本提交）

| 文件 | 改动 |
|---|---|
| `scripts/ci/run-v31-browser-acceptance.sh` | 新增 `V31_GATE_SCOPE`（full/day0/remaining）；同一 catalog 服务两个 CI job；缺文件 fail-closed 与 boundary gate 在所有 scope 生效 |
| `.github/workflows/core-quality.yml` | `v31-browser-acceptance` 拆为 `v31-day0-gate`（required，60m）与 `v31-browser-report`（遥测，240m）；`required` needs 收缩（p2 移出）；p2 注释改遥测口径 |
| `scripts/ci/assert-required-jobs.mjs`(+test) | 聚合清单同步收缩 |
| `scripts/ci/quality-gates.test.mjs` | 组成断言更新＋新增 day0/remaining/未知 scope 三条契约；遥测 job 不得出现在 required needs 的反向断言 |
| `scripts/ops/apply-branch-protection.test.mjs` | 必查 job 清单同步 |
| `scripts/ci/suite-owner-manifest.json` | v31-browser suite 属主改 `v31-day0-gate` |
| `mkfast-template-main/tests/e2e/TEST-CATALOG.md` | 门语义描述改两 job 形态 |

契约验证：`node --test scripts/ci/quality-gates.test.mjs
scripts/ci/assert-required-jobs.test.mjs scripts/ci/suite-owner-manifest.test.mjs`
38/38 pass；`scripts/ops/apply-branch-protection.test.mjs` 5/5 pass。

## 3. 诚实边界

门收缩**不把任何红改绿**：remaining/p2 的每个红仍逐文件可见、有日志、有
artifact。改变的只是：一个与「商家能否走通首访」无关的旅程红，不再有权阻塞
「首访已可走通」的合并。V31-76（remix 重定向）属 day-0 旅程产品红，仍然直接
让 `v31-day0-gate` 红、阻塞 required——该阻塞是正确的。

## 4. 后续方向（未在本提交实施）

- **中间层仪器投资**：把「旅程走得通」下沉为不开浏览器的 journey 合同测试，
  让 90% 回归在秒级信号被抓住；浏览器门只留最终少数末端验证。
- 遥测红的消化按 capability ledger 排队，从 `v31-file-verdicts.log` 的稳定
  真红开始，不追瞬时仪器红。
