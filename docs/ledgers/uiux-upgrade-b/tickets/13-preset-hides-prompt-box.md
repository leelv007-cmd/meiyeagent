# 票 13 · 选中命名预设即隐藏提示词框 + 预设卡「该传什么图」引导接线
> 阶段: Phase 2 · 参数形态与 CheckBox ｜ 差距: P1-8 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "13",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-D3-WORKBENCH"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P1-8"
  ],
  "contractIds": [
    "I01",
    "I06"
  ],
  "blockedBy": [
    "03",
    "12"
  ],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- 差距报告 P1-8（`docs/reviews/uiux-productization-gap-report-2026-07-13.md:203-206`）已核实：主路径没有“选中命名预设→隐藏提示词框”状态切换，`AiImageSelector`、`TemplateCatalog` 虽已建但未被 routes/product 消费；目标是预设卡进入主创作路径、卡内前置“该传什么图”，生成 brief 对用户不可见。
- 报告§一根因②（`:24`）与§二 CheckBox 直接回答（`:46-60`）说明本票不能以组件存在或桶导出关票；它承接的是降门槛预设行为，不是内容套组多选（票 14），更不是把 D4 的文案候选改为多选采用。
- 对标研究 `references/benchmark/ui-adaptation-study-2026-07-08/01-合成-生成式平台降门槛与主入口调和.md:13-24,54-84,111-118,132-133` 已锁定：降门槛核心是绕过提示词；选中预设后只保留素材指引与生成路径，专业控制渐进展开。
- 实现解释：这里的“提示词框”指当前建 Work 前的自然语言意图 `Textarea`，不是新增 prompt 编辑器。用户可在“自己描述”与“命名预设”之间选择；预设态不展示或允许编辑内部编译 brief，符合“意图框不是提示词框、不设编辑提示词入口”。
- 票 03 已裁决 `TemplateCatalog` 采用“合并而非双目录”，票 12 已提供 L0 默认态与渐进 Composer 外壳；本票不得整块挂载第二套模板目录、`AiImageSelector` 的提示词/Job 壳或另造 Chat clone。
- 范围边界：D3 仍是对话式外壳、结构化内核；D4 仍为 3 选 1 单选；L-1 贴链接抓取不复活；图片/视频模型继续显式选择，禁止跨品牌 Auto。真实拍照、拖放、粘贴与本机文件入 Asset 归票 22，本票不得把“未上传文件名”伪装成已参与生成的素材。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/routes/dashboard/index.tsx:30-40`：桌面 `/dashboard` 仍由第 39 行唯一渲染 `UnifiedCreationWorkbench`；报告主入口锚点未漂移。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:208-223,338-354`：当前只有自由意图状态；建 Work 时直接提交 `intent/mode/sourceReferences`，尚无命名预设状态或内部 brief 编译。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:531-581`：建 Work 前“一句话开工”始终显示意图 `Textarea`；报告引用的 `:573-581` 仍准确。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:594-609`：本机文件目前只把“未上传，不是 Asset”的文件名放入本地列表；本票只能保留诚实提示，不能据此声称传图已接入生成。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:694-723,752-934`：建 Work 后只回显原始 `currentWork.intent`，随后平铺 Composer；该阶段本来就没有提示词框。只在这里挂预设会制造“无需改代码就已隐藏”的假完成。报告的 Composer 区间未漂移。
- `mkfast-template-main/src/product/creation-shelf.tsx:127-130,192-205`：货架已读取同一 `creation_catalog`，但模板被压成名称/族/版本文字，缩略图、描述和素材指导没有进入 `CatalogEntry`。
- `mkfast-template-main/src/product/creation-shelf.tsx:235-260,324-345,382-443`：快捷位以 chip/文字卡展示；选择模板只带入 `{ kind: 'template', id }` 引用，没有“预设选中态→隐藏意图框→引导素材”的入口状态。
- `mkfast-template-main/src/p1/template-catalog.tsx:268-317,374-426`：独立模板目录已有画廊卡骨架、命名与描述区域，但不在主路径；`mkfast-template-main/src/p1/types.ts:135-150` 的卡片视图也没有 `inputGuide`。
- `mkfast-template-main/src/p1/operations-view-model.ts:48-56,235-295`：原始官方模板只有 `family/name/tags/version`；`templateViews` 未产出 `description`、`thumbnailUrl` 或素材要求，素材指导需按现有官方 family 做唯一、可复用的视图映射。
- `mkfast-template-main/src/p1/ai-image-selector.tsx:198-218`：未挂载组件自带另一只提示词框；`:117-119,220-231` 同时保留显式选模与禁止静默换模口径。本票不整块挂载它，模型富卡归票 15。
- `mkfast-template-main/src/p1/index.ts:1,9`：两组件仍只有桶导出；全 `src` 消费实核仅命中定义/视图类型，没有 routes/product JSX 消费者，报告负证据仍成立。

## 改造方案（步骤级 + 涉及文件清单）

1. 在模板视图层建立唯一的“命名预设素材合同”：仅对当前可用的官方模板 family 映射 `inputGuide` 与确定性的内部意图摘要；文案至少说明素材数量、主体与清晰度，例如门店介绍=1 张正面店照或清晰环境图、Before/After=同项目同角度前后各 1 张。无完整素材合同的模板仍留在普通目录，不得进入免提示词预设态。
2. 复用 `TemplateCatalog` 既有卡片骨架，统一呈现预设名称、现有 family 标签与“该传什么图”；主路径与目录使用同一视图数据，不复制第二份预设常量，不承诺票 15 才负责的真实缩略图/额度富卡。
3. 将命名预设选择接到 `/dashboard` 建 Work 前的真实入口：默认保留“自己描述”自然语言路径；选择任一命名预设后，意图 `Textarea` 从视觉与可访问性树同时消失，卡下立即显示对应素材指导、已有素材选择/诚实的文件入口和继续动作。
4. 明确可逆切换：换预设时素材指导同步更新；切回“自己描述”才恢复自然语言意图框。不得提供“查看/编辑内部提示词”，也不得把 agent/direct 切换改造成第二个聊天产品。
5. 预设态建 Work 时，把所选模板以现有 `{ kind: 'template', id }` 写入 `sourceReferences`，并从预设合同生成确定性的内部 `intent` 以满足现有执行链；内部文本不渲染给商家。刷新后通过 template 引用和同一 catalog 恢复“已选预设 + 素材指导”，不能退回一串编译文本。
6. 调整 Work 头部回显：预设路径显示“已选预设、该传什么图、已带入哪些真实来源”，手写路径仍显示商家的自然语言意图；两条路径继续进入票 12 的同一 Composer、明确模型、报价确认与提交，不新建平行 Job/生成通道。
7. `CreationShelf` 的模板卡同步展示同一 `inputGuide`；从已有 Work 换用模板时沿用现有派生 Work 语义，不能原地偷偷改旧 Work，也不能只变色不改变 template 来源引用。
8. 补主旅程与键盘回归：覆盖“自己描述→有输入框”“选预设→输入框消失且指导变化”“切回→输入框恢复”“建 Work/刷新→预设身份与 template 引用仍在”“本机文件未入 Asset 时不显示已上传/已用于生成”。
9. 取证使用同一账号、同一桌面视口和同一候选构建，记录选择前、选择后与刷新后三态；验收只看真实 `/dashboard`，隐藏路由、独立目录或静态故事不算接线。

涉及文件清单：

- 修改：`mkfast-template-main/src/product/unified-creation-workbench.tsx`（入口状态、隐藏行为、预设 brief/sourceReference、刷新后回显）。
- 修改：`mkfast-template-main/src/product/creation-shelf.tsx`（复用命名预设视图与素材指导，不造第二目录）。
- 修改：`mkfast-template-main/src/p1/types.ts`、`mkfast-template-main/src/p1/operations-view-model.ts`（单一 `inputGuide`/内部摘要视图映射）。
- 修改：`mkfast-template-main/src/p1/template-catalog.tsx`（目录卡与主路径共用“该传什么图”呈现）。
- 修改：`mkfast-template-main/tests/e2e/specs/uiux-creation-loop.spec.ts`、`mkfast-template-main/tests/e2e/specs/uiux-keyboard-governance.spec.ts`（上述可见旅程与键盘切换回归）。
- 复用但不修改：`packages/contracts/src/uiux.ts:12-15,43-55`（现有 template sourceReference 与 CreativeWork 合同足够）；`mkfast-template-main/src/p1/ai-image-selector.tsx` 留待票 15 收窄接线。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家从桌面 `/dashboard` 第一条创作即可看见少量命名预设；每张可进入免提示词路径的卡都直接写明“该传什么图”，无需先点详情或展开专业参数。
- 商家选中命名预设后，自然语言输入框立即完全消失，焦点进入素材/继续路径；页面只展示预设名、素材指导、真实可用的素材入口与后续生成动作，不出现 prompt、内部 brief 或“编辑提示词”。
- 商家在两个素材要求不同的预设间切换时，卡片选中态与“该传什么图”同步变化；例如门店介绍明确要求店照/环境图，Before/After 明确要求同项目同角度前后图，不显示一条泛化指导冒充全部预设。
- 商家切回“自己描述”时，自然语言意图框恢复；该路径仍是 D3 的同一工作台入口，不跳到独立聊天页，也不会出现命名预设编译文本。
- 商家用预设建立 Work、刷新页面后，仍看到同一预设名称、素材指导与已带入的真实来源；不会退回原始内部文本，也不会只因刷新失去预设身份。
- 商家未把本机文件真正上传为 Asset 时，界面不得显示“已上传/已用于生成”；选择已有真实素材时，Work 摘要能看见该来源。后续真实拍照/拖放/粘贴能力不作为本票完成声明。
- 商家继续到 Composer 后仍能看见并确认明确模型；界面没有跨品牌 Auto、静默换供应商、L-1 贴链接抓取或候选多选采用。
- 键盘用户可选择预设、切回“自己描述”并继续；读屏能获知当前选中预设、对应素材要求和输入框的出现/消失，焦点不落入已隐藏控件。
- 截图对照：同一桌面视口并排保存三帧——当前产品 `/dashboard` 的常驻意图框且无卡内素材指导、升级后选中“门店介绍”时无意图框且显示“该传什么图”、可灵登录态 `/app/special-effects/new` 的“无 textarea + 上传要求 + 生成”态；每帧标注产品、路由、视口、构建/取证日期。可灵侧须新取真实登录态截图，不引用不存在的本地图片路径。

## Blocked-by / Blocks

- Blocked-by：票 03（沿用“合并而非双目录、收窄复用”裁决）、票 12（先有 L0 默认态与渐进 Composer 外壳）。
- 全局关票闸：票 02 的体验合同 `I01/I06` 未验绿前，即使代码与截图齐全也不得关闭本票；Phase 0 未完成前不得进入 frontier。
- Blocks：票 14。按 MAP 的 `12 → 13 → 14` 递进链，票 14 必须在本票稳定的预设/手写两态上增加套组多选，不得复用 D4 候选择优来冒充 CheckBox。
- 非阻断边界：票 15 承接模型/模板缩略图与额度富卡，票 22 承接统一输入台真实拍照、上传、拖放与粘贴；两票未完成不允许本票越界宣称对应体验已交付。

## 风险与回退

- **假隐藏**：若预设只出现在建 Work 后，那里本来就无意图框。控制：验收必须从 E0/E1 建 Work 前录制“可见→选卡→消失”状态变化，并验证隐藏控件不在可访问性树。
- **视觉预设不影响生成**：只让卡片变色会重演“组件存在、主路径无效”。控制：预设身份必须写入 template sourceReference，内部意图由同一素材合同确定生成；刷新后可回溯，且提交仍走唯一 CreativeWork/Job 链。
- **模板与生成预设混用**：普通画布模板未必具备素材合同。控制：只有补齐 `inputGuide` 的当前官方 family 才进入免提示词预设态；其余保留普通目录，不用空文案或猜测兜底。
- **内部 brief 泄漏**：当前 Work 头部直接显示 `currentWork.intent`。控制：预设路径改显预设名/素材要求，手写路径才显示自然语言意图；日志与错误提示也不得把内部文本当产品文案。
- **伪传图**：现有本机文件仅存文件名。控制：本票只对真实 Asset/现有来源作“已带入”声明；本机临时项保持诚实标注，等待票 22 接入，不以截图掩盖数据未接线。
- **双目录/双 Composer**：整块挂 `TemplateCatalog` 或 `AiImageSelector` 会复制入口、提示词与 Job 壳。控制：只复用卡片视图和 catalog 数据，保留单一 `/dashboard` 工作台与单一提交链。
- **回退**：撤回命名预设入口与预设态回显，恢复票 12 的“自己描述 + 渐进 Composer”单一路径；保留无副作用的素材指导视图映射。不得回退到跨品牌 Auto、链接抓取、候选多选或第二套目录。
