# D-086 交付能力与发布包合同

- 日期：2026-07-20
- 状态：`accepted`
- 对应主决策：D-086
- 范围：文案/图文、图片、视频三个 Result Workspace 的复制、下载、系统分享、assisted 交接与自动发布

## 1. 产品结构

“交付”是能力感知面板，不是固定按钮集合。能力解析必须同时读取成品类型、目标载体、账号绑定、操作者权限、权利事实、ApprovalReceipt、adapter 能力、部署探针和设备能力，再投影真实可用动作。

| 分组 | 动作 | 成立条件 | 成功语义 | 必须保留的替代路径 |
| --- | --- | --- | --- | --- |
| 拿到文件 | 复制 | 存在可复制文本 | 已复制到当前设备剪贴板 | 下载文本文件 |
| 拿到文件 | 单项下载 | 对应 AssetRevision 或文本载体可导出 | 文件已保存或浏览器已接管下载 | 完整发布包 |
| 拿到文件 | 完整发布包 | 当前 canonical/adopted revision 可生成 manifest | 包已生成并开始下载 | 单项下载 |
| 交接到平台 | 系统分享 | 设备和浏览器支持当前 payload，且外部发送已取得 ApprovalReceipt | 已交给系统分享流程，不证明外部平台已发布 | 复制交接链接或下载 |
| 交接到平台 | assisted | 有明确目标载体和责任人/目标账号，且外部发送已取得 ApprovalReceipt | 已记录交接 receipt，等待人工发布或确认 | 完整发布包 |
| 直接发布 | automatic_verified | 平台、账号、adapter、部署、权限和批准全部通过 | 外部平台返回可核验发布 receipt | assisted 与完整发布包 |

禁止把复制成功、下载开始、系统分享完成或 assisted 交接完成投影为“发布成功”。

## 2. 首批发布包

### 2.1 小红书图文包

```text
manifest.json
caption.txt
cover.jpg | cover.png
images/01.jpg
images/02.jpg
...
platform-checklist.md
evidence/rights-and-facts.json
```

`caption.txt` 包含标题、正文、话题和 CTA。图片文件名固定使用发布顺序，不能依赖压缩包内的文件系统排序。`rights-and-facts.json` 只保存发布所需摘要和稳定引用，不泄露隐藏 prompt、Provider、Credential 或无关顾客数据。

### 2.2 抖音与微信视频号包

```text
manifest.json
video.mp4
cover.jpg
caption.txt
subtitles.srt | subtitles.vtt
platform-checklist.md
evidence/rights-and-facts.json
```

字幕文件只在当前成片存在可交付字幕轨时出现。封面、成片和字幕必须引用同一 approved ContentPackage revision，禁止混用不同版本的产物。

### 2.3 朋友圈交接包

```text
manifest.json
caption.txt
media/...
platform-checklist.md
evidence/rights-and-facts.json
```

朋友圈是 distribution/export target。系统分享、复制和下载是首发主要动作；没有独立且已验证的平台 adapter 前，不显示自动发布。

## 3. `manifest.json` 最小语义

首轮至少包含：

- package id、ContentPackage revision 和生成时间；
- 目标载体与交付物类型；
- 文件清单、顺序、MIME、内容 hash 和角色；
- 文案、封面、字幕与媒体之间的 revision 一致性引用；
- 权利、AIGC 标识和事实核对摘要引用；
- 生成发布包时采用的 capability revision；
- 不含 Provider、Deployment、Credential、隐藏 prompt、fallback 顺序或 secret。

机器可读 schema 和 zip 命名规则另开票据细化，但不得改变上述语义。

## 4. 自动发布安全门

`automatic_verified` 按精确组合判定，不按平台品牌整体判定，也不复用模型生成供应的 Deployment 证据：

```text
platform + platform account authorization revision + publishing adapter revision + publishing deployment/probe
```

显示“直接发布”前必须同时满足：

1. 目标平台账号已绑定，授权版本明确且未过期；
2. publishing adapter revision 和当前 publishing deployment 已通过真实账号探针与恢复验收；
3. 操作者拥有该账号和当前 ContentPackage 的发布权限；
4. 当前 revision 已有未过期 ApprovalReceipt；
5. 发布参数、平台、账号、用途、费用和有效期与批准内容完全一致；
6. 可以创建带幂等键的 delivery attempt 并保存结果 receipt。

任一条件不满足，解析结果降级为 assisted 和文件交付。后台配置不得强行越过这些门。

当前生产装配下，首发 `automatic_verified` 平台数为 0。小红书、抖音、微信视频号和朋友圈均不得显示“直接发布”；后续必须按平台、真实账号和 publishing adapter 独立完成上线票据后逐项开放。D-069 的双渠道 `live_verified` 只验证文本、图片和视频的生成供应，不证明任何平台发布能力。

## 5. 生命周期和重试

| 状态 | 用户看到的主语义 | 允许动作 |
| --- | --- | --- |
| `delivering` | 正在交付，可离开后台继续 | 查看进度、在安全条件下取消未开始目标 |
| `partial_delivery` | 当前平台内部分交付对象完成 | 查看逐对象结果、仅重试已确认失败对象；unknown 只核验 |
| `delivery_failed` | 本次未完成 | 查看原因、重试或改用交接/下载 |
| `delivery_unknown` | 暂时无法判断平台是否已接受 | 核验状态；禁止重新发布 |
| `delivered` | 所有目标均有成功 receipt | 查看回执、基于此再创作 |

`delivery_ready` 是 Result Shell 尚未创建 attempt 的阶段，不属于 attempt 生命周期。首版一个 attempt 只面向一个平台/账号，不提供跨平台批量调度。重试必须创建新 attempt，并引用原 attempt 和同一 adopted revision。已成功对象默认不重试，unknown 对象只 query/reconcile；目标、账号、revision、发布参数、用途或费用变化时视为新交付并重新批准。每次重试前重新校验平台账号授权版本、ApprovalReceipt、publishing probe 和能力快照。

## 6. 移动端与无障碍

- Result Shell 仍只有一个 primary 和“更多”；交付面板内部再分组。
- 系统分享前检查当前 payload 是否可分享，不能只检查 API 是否存在。
- 分享失败后保留原 revision、面板位置和焦点，并提供复制链接或下载。
- 本地复制、单项下载和生成发布包不需要发布 ApprovalReceipt；真正把内容通过系统分享或 assisted 发送到外部责任人/目标端前，必须完成一次性批准。
- 成功播报必须分别使用“已复制”“下载已开始”“已交给系统分享”“已交接”“已发布”，不得共用含糊的“完成”。
- 状态和能力不能只靠颜色区分；错误、替代路径和账号目标必须有文本。
- `partial_delivery` 的读屏顺序先给总体结果，再逐目标报告成功、失败和未知。

## 7. 首轮验收

1. 文案、图片、视频均能完成复制或适用的单项下载，并生成对应完整发布包。
2. 不支持 Web Share、payload 不兼容和用户取消分享三种情况均能恢复并显示正确替代动作。
3. assisted 交接产生绑定精确 revision 和目标的 receipt，但 UI 不显示“已发布”。
4. 未绑定、授权过期、无权限、ApprovalReceipt 过期和 publishing deployment probe 失败时均不存在可执行的自动发布动作。
5. `automatic_verified` 发布成功返回外部可核验 receipt；网络中断或接受态未知时用同一幂等键 query/reconcile，不重复发布。
6. 多目标部分成功只重试失败目标；所有目标有成功 receipt 后才进入 `delivered`。
7. 生成发布包和浏览交付能力不改变原成品 revision，不创建第二套内容或发布真相。

## 8. 当前实现基线与缺口

- image_text 已有确定性 ZIP、合规处理和 ExportReceipt，但缺少面向人工发布的 `caption.txt`、manifest 与 checklist。
- video 当前只有单 MP4 导出；在封面、文案、字幕与 manifest 进入同一 receipt-backed ZIP 前，前台只能称“下载成片”，不能称“完整视频发布包”。
- canonical Result/ContentPackage 尚未提供统一复制、媒体直接下载和系统分享；旧 Handoff 与 PWA proof 只能作为复用参考，不是完成证据。
- assisted 已有绑定平台、revision 和 export receipt 的领域事件，但 canonical handoff token/page、打开/分享/确认与失败重试仍需开发。
- ApprovalReceipt、幂等 delivery attempt 和 publisher port 已存在；当前生产 publisher 对现有平台全部不可用，因此首发自动发布数量为 0。当前 operations 权限映射仍会回落到 `content.create`，首轮必须改为独立的 `publication.handoff` 服务端校验。
- 现有导出失败“重试”会读取当前 variant；实现时应明确命名为“重新导出当前版本”，或增加 failedReceiptId 与 variantVersionId 来保证精确重试。

## 9. 对标证据边界

- 小云雀本轮仅能证明创作工具、素材回流和旧结果调整方向，未实测复制、下载、系统分享或真实平台发布闭环。
- CreatOK 当前可见资产、历史和 TikTok 发布结构，不能外推为小红书、抖音或微信平台自动发布能力。
- 讯飞绘文可见平台入口、账号绑定、Word 导出和 PDF 预览方向；入口存在以及 Cookie/CDP 混合链路均不能证明稳定发布成功。
- 因此 D-086 借鉴的是能力分层和未绑定时仍有下一步，不借用未经验证的“已支持自动发布”结论。
