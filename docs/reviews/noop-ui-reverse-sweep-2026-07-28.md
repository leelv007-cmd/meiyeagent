# 空操作 UI 反向扫描报告

> 扫描日期：2026-07-28
> 基线：`main@82af2d1a`
> 性质：只读审计，未修改产品代码。
> 形态：4 个面并行 find → 逐面对抗 refute（复核方立场为**反驳 finder**，默认判 finder 错）。8 agent，全 Opus。
> 与 `product-plan-implementation-gap-review-2026-07-27.md` 的关系：**互为镜像**，见 §1。

## 1. 为什么要反向扫

07-27 那份差距审计的视角是「**产品承诺 → 用户实际可得**」，它抓到的主导失效模式是「**后端建满、前台不接**」。

本次扫的是它的**镜像**：**前台建了、下游没有**——商家点了一个按钮，界面收下操作、给出反馈，但这个动作没有任何下游（不发命令／发了没人处理／处理了没产出）。连报错都不会有。

**从承诺侧往下读的审计天然看不见这一类**：界面在那儿、点得动、有反馈，读起来就是「已落地」。本次 15 条发现，07-27 审计**一条都没记录**。

触发样本＝视频「选封面帧」：`selectCoverFrame`（`video-worksurface-model.ts:637-644`）只写本地 state，`frameTimeSeconds` 在 `apps/core` 与 `packages/contracts` 零命中，商家的选择从未离开浏览器；且全仓无抽帧实现。测试是诚实的、代码是诚实的，只是这条链没有下游。该样本已由 D-133 修订裁定退役，不计入下表。

**新增假绿类目**：既有假绿清单记的是「测试为未完成功能背书」；本类是「**UI 为不存在的能力背书**」。后者更隐蔽——它不需要任何人被骗，代码与测试都可以是诚实的。

## 2. 判据与防误报

三问，每问要证据：①有没有发出 core 命令 ②core 有没有处理分支 ③有没有写入或产出。任一环断掉即为发现。

复核方被要求穷尽五种「看着断了其实没断」的路径：命令与前台标识符不同名／攒进 draft 批量延迟提交／通用信封泛化命令／经 BFF 路由中转／SSE 轮询回流生效。**只有认真找过确实找不到才判 CONFIRMED。**

## 3. 结果总表

**15 条发现：12 CONFIRMED ／ 3 DOWNGRADED ／ 0 REFUTED。** 复核方一条都没驳倒。

| # | 动作 | 入口 | 判 |
|---|---|---|---|
| 1 | 五步录入「确认，全部记下」（部分确认时） | `store-intake-wizard.tsx:803-816` | DOWNGRADED |
| 2 | 五步录入第 3 步「用一句话说说这次要录什么」 | `store-intake-wizard.tsx:533-549` | **CONFIRMED** |
| 3 | 人设「用在哪些平台／场景」多选 | `marketing-identity-page.tsx:982-1041` | DOWNGRADED |
| 4 | 素材「重新同步撤权」 | `canonical-asset-actions.tsx:517-528` | **CONFIRMED** |
| 5 | 辅助交接卡「标记待人工发布」／「记录发布结果」 | `results/delivery-panel.tsx:363` | **CONFIRMED** |
| 6 | 改写冲突「比较版本」／「重新应用」 | `results/copy-image-text-worksurface.tsx:444` | **CONFIRMED** |
| 7 | 视频「显示字幕／隐藏字幕」 | `results/video/video-worksurface.tsx:329` | **CONFIRMED** |
| 8 | 视频「到 Pro Studio 精修」 | `routes/dashboard/results_/$workId.tsx:1466` | **CONFIRMED** |
| 9 | 结果漂移「恢复」／「对比」 | `results/result-center-page.tsx:576` | **CONFIRMED** |
| 10 | Cmd+K「添加到创作」 | `global-command-palette.tsx:254` | **CONFIRMED** |
| 11 | 结果信号「已验证」层 | `results/outcome-chips-panel.tsx:238` | **CONFIRMED** |
| 12 | 通知「关闭」 | `async-task-center.tsx:272` | **CONFIRMED** |
| 13 | 生成中的「停止」键 | `composer/composer-conversation.tsx:520,558` | **CONFIRMED** |
| 14 | 图片任务三选一 | `composer/image-operation-picker.tsx:63-76` | DOWNGRADED |
| 15 | 「先确认素材来源」按下后 | `composer/composer-home.tsx:305-327,2548` | **CONFIRMED** |

## 4. 三条 DOWNGRADED——复核方推翻了 finder 的什么

**这三条不是误报，是范围被 finder 说大了。** 记录在此以免后续按 finder 的口径动手。

### #1 五步录入「确认，全部记下」
- finder 说：点了没反应，台账仍空。
- 复核证伪：动作**下游完整接通**——`store-intake-wizard.tsx:294` `commandP1('asset-memory', …)` → `asset-memory-foundation-module.ts:231-243` `case 'finalize_store_intake'` → finalizer 真写 fact + profile；interaction 测试实测发出 1 条 finalize、confirmations 长度 4。
- **真实缺陷**：`部分确认` 这一子状态**缺一道门**，同一份 draft 的姊妹面已经写对了。是缺门不是缺下游。

### #3 人设「用在哪些平台／场景」
- finder 说：全部读取点只有 `production-context-port.ts:698-699` 一处。
- 复核证伪：这两个数组**整包进入生成模型的提示词**——`production-context-port.ts:686-717` 写入 `expression_identity` 维度 → `production-stage-ports.ts:390-395` 传入 `compileExecutionBrief` → `structured-nodes.ts:486-505` `canonicalJson({… bundle …})` 把整个 ContextBundle 序列化进 prompt。
- **真实缺陷**：**有软消费者（模型被告知），无硬门（没有东西拦截）**。商家取消勾选「抖音」后，模型仍会看到这条人设并可能采用。前台承诺「没选中的地方不会用上这个人设」，强于系统实际能保证的。与 D-142 修订「授权字段契约级 merchant-only」同族但不同层：那条管**谁能填**，这条缺的是**填了谁来执行**。

### #14 图片任务三选一
- finder 说：core 只拿它做一次一致性断言，等于没选。
- 复核证伪：该字段是 T08 **签名字段**，进入报价身份摘要——`composer-home.tsx:823-826` → `composer-live.ts:138-149` `billablePayload` → `:167-173` `quoteId = […stableJsonHash(billablePayload)]`，即改选项＝换 quoteId＝重新报价；core 侧 `server-quote-authority.ts:182-184` 对其指纹化并作为准入闸门。
- **真实缺陷**：finder 的核心论断成立（**选择不改变最终 operation**——`image-intent-compiler.ts:64-95` 返回值恒等于按附件张数推断的 `inferred`，且 `reference_transform` 与 `edit` 映射到同一个上游操作），但**不能按「删掉这个字段」处理**，那会打断真实的报价与冻结绑定链。

## 5. 按处置方式分组

### A. 撤回承诺（比补齐能力便宜且更诚实，建议打一个包一次清掉）

| # | 现在承诺了什么 | 实际 |
|---|---|---|
| 13 | 方块图标＝停止生成（组件 prop 文档原文「the send button becomes a stop affordance」） | **产品面无停止能力**，`onStop` 全仓产品代码零传入，点击落回发送 |
| 15 | 「点发送会先带你确认，不会开始生成」 | 不滚动、不聚焦、不弹面板、不给链接。同段代码 store／资质两个兄弟分支都给了可点链接，唯独素材没有；为它写好的 `sourcePickerRef` 从未被 `.focus()` 调用 |
| 7 | 「独立字幕资产 · 免费修改」＋「显示字幕」 | 只翻按钮标签，播放器从不出现字幕。**已由 D-133 修订裁定退役** |
| 9 | 「请选择恢复、对比或丢弃」 | 「恢复」不填回草稿也不消提示；「对比」无对比视图 |
| 6 | 「请比较后再决定是否重新应用」 | 「比较版本」无对比；「丢弃选区」正常 |
| 12 | 通知「关闭」 | 仅当次页面隐藏，刷新原样回来（旁边的「已读」倒是真写了 localStorage） |
| 10 | 「把模板、工具和素材加进这次创作」 | 面板关闭、跳 `/dashboard`，工作台什么都没多 |
| 4 | 「重新同步撤权」 | core 在赋值前早退（`product-service.ts:2402` `if (authorizationStatus === 'withdrawn') return`），点多少次都一样 |

### B. 真产品缺口（需产品判断，非接线）

- **#11 `verified` 信号层结构性恒空**——不是「暂时还没有」，按现行代码无论商家做什么都不会有。三级信号对其中一级是纯装饰。属承接闭环范围。
- **#3 人设授权范围有软消费者无硬门**——见 §4。
- **#1 部分确认缺门**——见 §4，姊妹面已有正确写法可直接对齐。
- **#8 Pro Studio 精修跳转丢失全部上下文**且无返回路径（D-127 冻结面，形态待 Pro Studio 解锁时一并定）。

### C. 与 D-155 的关系

**无一条落在冻结面内。** #5「记录发布结果」属**商家自报发布结果的记账**，D-155 已显式划在冻结面之外（它是承接闭环的组成部分，不是平台代发能力），应修。

## 6. 后续

本报告不直接开票。建议：A 组打一个「撤回未兑现承诺」包一次清掉；B 组并入新功能梳理盘子——它与承接闭环是同一类问题（**契约建好了，没人消费**）。

原始逐条追踪（含每一环的 file:line 与零命中的 grep 表达式）见 workflow `wf_b2de57b0-97b` 的 journal。
