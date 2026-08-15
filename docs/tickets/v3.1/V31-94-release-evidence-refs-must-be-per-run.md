# V31-94 — 发布证据引用被接成仓库级静态变量，fail-closed 因此形同虚设

**Parent**: T40/E-01 发布 manifest（`scripts/ci/build-release-manifest.mjs`）
**批次**: 发布线（挡 RC／发布，**不挡日常合并**）
**Blocked by**: 无
**Related**: 供给清单 §C-R（R-1～R-6）、`docs/ops/current-project-status.md` §3

**Status**: open（2026-08-15）— 接线缺陷已定位（读源码得出）；两个修法方向待拍板，实施前须在票下定稿

**Implementation state**: open
**Verification state**: unverified
**Evidence SHA**:
**Workflow Run**: 31892646103、31892656795（`release-manifest` 均红在 `Mint the staging release manifest`）

## 现象

`release-manifest` job 恒红。直接原因是 `leelv009/meiyeagent` 的 Actions variables
`total_count = 0`，六个必填 `RELEASE_*` 一个都没配，生成器按设计 fail closed。

**但「把变量补上」不是正确修法**——补上之后暴露的是下面这个更深的问题。

## 真问题：常量装不下「这一次发布的证据」

`core-quality.yml:629-638` 把五个证据引用接成 `${{ vars.* }}`，即**仓库级常量**：

```yaml
RELEASE_READINESS_EVIDENCE_REF:    ${{ vars.RELEASE_READINESS_EVIDENCE_REF }}
RELEASE_RECOVERY_EVIDENCE_REF:     ${{ vars.RELEASE_RECOVERY_EVIDENCE_REF }}
RELEASE_JOURNEY_EVIDENCE_REF_COPY: ${{ vars.RELEASE_JOURNEY_EVIDENCE_REF_COPY }}
RELEASE_JOURNEY_EVIDENCE_REF_IMAGE:${{ vars.RELEASE_JOURNEY_EVIDENCE_REF_IMAGE }}
RELEASE_JOURNEY_EVIDENCE_REF_VIDEO:${{ vars.RELEASE_JOURNEY_EVIDENCE_REF_VIDEO }}
```

常量跨每一次发布都一样，于是：

1. **fail-closed 只在第一次有效**——填一次任意非空串，它永远不会再红；
2. 此后**每一份 manifest 都会引用一份与本次发布无关的证据**，而且看起来是审过的。
   这比留空更糟：留空至少诚实地红。

而下游**只校验非空**，三处都是（读源码，非推测）：

| 消费方 | 校验强度 |
|---|---|
| `build-release-manifest.mjs:210-215` | `requireEnv`（仅非空） |
| `assert-release-candidate-evidence.mjs:427-438` | `nonEmpty(...)` |
| `apps/core/src/runtime-truth/release-identity.ts:158-164` | `nonEmpty(...)` |

**没有任何地方解析、解引用或校验它指向的东西存在**，类型就是 `string`。
所以这些字段的全部价值是人工审计指针——正因如此，它「指得准不准」是唯一重要的属性，
而常量保证了它一定指不准。

**同一个 job 里已有正确样板**：`RELEASE_WORKFLOW_RUN` 由 `github.run_id` 按轮注入
（`core-quality.yml:638`）。证据引用应当照此办理。

## What to build（两个方向，择一，实施前在票下定稿）

**方向 A — 按轮派生（推荐评估）**：证据本来就产自同一次 run 的各个 job，
所以引用可以派生而非配置。需要先定「哪个 job 产出哪份证据」的映射
（readiness／recovery／copy／image／video 各对应谁），然后从 `github.run_id`
＋ job／artifact 名铸出引用。好处是**永远描述正在铸的这次发布**，且无人工维护。

**方向 B — 改成 dispatch 输入**：若证据本就来自 CI 之外（例如人工验收），
则应改成 `workflow_dispatch.inputs`，由发布操作者**每次发布时**填写，
而不是 `vars.*`。同样解决常量问题，代价是每次要人填。

**两者都不要保留 `vars.*` 作为这五项的载体。**

### 人工填写部分的口径（沿用房内既有约定）

凡需人工提供的引用，一律用**仓库相对路径 + commit 锚点**，与生产代码里已有的写法一致
（`apps/core/src/p1/admin-config/bounded-execution-limits.ts:153`）：

```
docs/ops/merge-ledger.md#561ab568
```

**不要用 run URL**：Actions 日志与 artifact 会过期，静态引用指向会消失的东西是最差组合。
**不要抄测试 fixture** 的 `staging:readiness:1` 形态——那是不透明计数器，审计时等于没有。

## 落地纪律：证据没产出之前不许填

`docs/ops/current-project-status.md` §3 第 2、3 条明载：21 个 fixture consumer tests
未在最终 SHA 串行跑完，XHS 的 gap-close／replay-head 两个 fault 也未证明形成严格
terminal receipt 与 recovery。即 **R-3（recovery）与 R-4/5/6（journey）当前没有证据可指**。

此时填任何字符串＝**给一次没发生过的验证造审计痕迹**，正是该 fail-closed 要挡的东西。
先产证据，再由证据决定引用，顺序不得颠倒。

## Acceptance criteria

- [ ] 方向 A／B 已拍板并写入本票（含 readiness／recovery／三模态的证据归属映射）
- [ ] 五个证据引用不再由 `vars.*` 承载
- [ ] 先红后绿证：同一份 manifest 在**证据缺席**时必须仍然红——
      改造不得把 fail-closed 改松（这是本票的核心资产）
- [ ] 两次不同 run 铸出的 manifest，其证据引用**不相同**（钉住「per-release」语义）
- [ ] `release-manifest` job 绿，且 `docs/ops/provisioning-manifest.md` §C-R 状态同步

## 影响

`release-manifest` 只在 `workflow_dispatch` 或带 `release-candidate` 标签的 PR 上跑，
且不在 `required` 依赖里，**不阻塞日常合并**；但它挡 RC 与发布——所以
「release-ready」在本票收口前无从谈起。
