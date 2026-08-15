# V31-88 — 素材库已授权资产无法挂入 composer 配方槽：只有「上传新图」没有「从素材库挑选」

**Parent**: V31-84 收口走查新发现
**批次**: 清红队列（P1，素材复用/配方链）
**Blocked by**: 无
**Related**: V31-73/V31-85（slot readiness 镜像只看 `lensState.draft.sources`）、V31-87、
C16 素材复用能力

**Status**: implementation-complete（2026-08-13）— 挑选器落地并活体走查证毕（全链首次跑通到 202）

**Implementation state**: implemented
**Verification state**: live-verified（新号活体：素材页授权 customer_case→composer「添加素材」出现「从素材库选择」且只列 eligible→选用后缺案例图告警消失、报价出现→提交 202。变异双证：类别过滤失效红、未授权资产可选红）
**Evidence SHA**: 97f534d0c76a4c2b6f92222f70e831e21fb4dbfb
Evidence 注：asset-0a411f19（customer_case/authorized/权利人=盘点美发工作室）在 Core state 在案；composer 添加素材面板只有拍照/选择图片两个上传入口
**Workflow Run**:
**Artifact Digest**:

## 定性

- slot readiness（V31-73 镜像）按 `draft.sources` 判定，语义正确；缺的是**把既有已授权
  资产放进 draft.sources 的 UI 通路**——「添加素材」面板只提供新上传（camera/gallery
  input），没有工作区资产挑选器。
- 后果：素材页与 composer 双面各自为政；商家被迫重传同图（撞 V31-87 的 409 砖）；
  grok 的 v31-84 spec 只能靠 `seedComposerInlineAuthorize` 静态种子绕过（掩码了缺口）。

## Acceptance criteria

- [x] composer「添加素材」提供已授权资产挑选（案例槽只列 customer_case/before_after＋authorized）
- [x] 挑选后 slot readiness 立即满足、报价卡照常；e2e spec 落盘（活体已证 202）
- [x] V31-84 spec 的 seed 挂源替换为真实挑选路径（V31-84 residual 关闭）
