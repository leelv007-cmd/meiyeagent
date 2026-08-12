# V31-71 — admin 旅程潜在竞态：「未挂载组件 setState」React 告警在 CI 负载下打破 console 纯净合同

**Parent**: 浏览器门可靠性收口（V31-64/V31-70 同族的门信号质量线）
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-65（同 spec 的 select 合同修复，已本地绿）、V31-68（同 spec 的 403 console 错误，已修）、V31-70（CI 负载来源）

**Status**: open（2026-08-12）— 现象已定性为负载敏感的潜在竞态（非近批回归）；组件级归因被 React 19 栈机制挡住，待复现路径

**Implementation state**: not-started
**Verification state**: not-started
**Evidence SHA**:
**Workflow Run**:
**Artifact Digest**:

## 为什么开票

CI run 31581702243（main=2aa75e55）p2 门 `admin-sensitive-words.spec.ts:73` 的
`expect(browserErrors).toEqual([])` 收到 React 告警（出现 2 次）：

> Can't perform a React state update on a component that hasn't mounted yet.
> This indicates that you have a side-effect in your render function that
> asynchronously tries to update the component. Move this work to useEffect instead.

即：某组件在 render 期发起了异步副作用，其 setState 赶在 commit（mount 完成）之前落地。

## 定性

- **非本批回归**：告警首现的批次（2aa75e55）零客户端代码变更；V31-65 验收时同 spec 本地整案绿（44.8s，零 console 错误），主控亲跑。
- **负载敏感**：本地快机 commit 先于副作用 promise resolve，窗口关闭；CI 高负载下 commit 延迟，窗口打开。与 V31-70 记录的 CI 负载形态同源，但这是**产品侧真缺陷**（render 期副作用确实存在），不是仪器假红。
- **组件归因受阻**：React 19 的组件栈经 `console.createTask`（原生 async stack）挂载，不再拼进 console.error 文本；Playwright `message.text()` 拿不到栈，CI 文本证据只有告警正文。`admin-sensitive-words-control.tsx`（467 行）本体已排查干净——无 render 期异步 setState；嫌疑范围=同页共同渲染树（AdminRoutePage／admin 布局／运维健康挂件／共享 provider）。

## 修复方向

1. **复现**：本地经 CDP `Emulation.setCPUThrottlingRate` 压低主线程重走 admin-sensitive-words 旅程，配 React DevTools 或 patch console 捕获 createTask 栈，定位始作俑者组件。
2. **修复**：把该组件 render 期的异步副作用移入 `useEffect`（告警给出的处方即是修法）。
3. **验收**：节流复现先红→修后同条件绿；spec:73 console 纯净合同在 CI 连续两轮无此告警。

## 验收清单

- [ ] 节流条件下本地复现告警（先红）
- [ ] 定位到具体组件并把副作用移入 effect（后绿）
- [ ] admin-sensitive-words 整案本地绿＋零 console 错误
- [ ] CI p2 门连续两轮无此告警
