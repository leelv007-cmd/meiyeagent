# 轻量生成主干：上下文记忆、隐私与评测边界研究

- 日期：2026-07-24
- 对应票据：`lpgs-06-research-context-memory-privacy-and-evaluation`
- 研究范围：稳定身份事实、品牌/门店知识、已授权素材、会话上下文、长期偏好、任务反馈的分类、来源、版本、置信度、删除、撤权与评测
- 非目标：不选型向量数据库、知识图谱或“自主记忆”框架；不在本研究票中修改产品代码

## 结论先行

首发主干不需要一个“会记住一切”的 Agent，而需要六条边界不同的数据通道和一个按任务编译的最小 `ContextBundle`：

1. **稳定身份事实**：谁、以什么真实角色和专业边界表达。
2. **品牌/门店知识**：项目、价格、活动、资质、履约与经营事实。
3. **已授权素材**：素材本体与独立的用途、主体、平台、期限、投放范围授权。
4. **会话上下文**：只服务当前任务和必要恢复，不默认晋升为长期记忆。
5. **长期偏好**：只接收用户明确长期意图，或多次独立修改形成且再次确认的候选。
6. **任务反馈**：采用、编辑、重做、拒绝等事件；它是评测证据，不自动等于用户偏好，更不自动改写事实。

推荐的核心约束是：

- **每一条可长期使用的记录都有来源、作用域、版本、生效/失效时间和状态。**
- **置信度只描述提取或候选的可靠程度，不能替代事实确认、所有权、授权或法律依据。**
- **推断先进入隔离候选区；没有用户确认或权威来源，不进入长期上下文。**
- **每次生成只解析当前任务需要的、仍有效且已授权的最小记录；不把完整历史对话塞入 prompt。**
- **撤权先立即阻断后续使用，再异步清理副本和索引；删除必须覆盖源、派生物、缓存和检索索引，并留下不含原文的最小删除回执。**
- **离线用固定样例守住事实、作用域、时间、撤权和删除；在线只用采用/编辑/重做等低负担信号发现问题，不能把结果信号当作新的事实真值。**

这与现有产品设计的方向一致：当前明确指令优先、资产保留来源/作用域/版本/有效期、普通修改只作用于本次、只有明确确认才长期化，并把跨门店串线、无来源事实、未授权素材、过期事实和临时纠偏误沉淀设为零容忍项。[产品设计 L248-L260](../../../docs/design/beauty-marketing-agent-product-design-2026-07-17.md#L248) [产品设计 L317-L328](../../../docs/design/beauty-marketing-agent-product-design-2026-07-17.md#L317)

## 研究方法与证据边界

### 方法

- 法律与标准优先使用全国人大、W3C、NIST 等官方原文。
- 交互原则使用原始论文或研究机构官方页面。
- 记忆与评测能力使用论文原文和官方产品/开发文档；产品文档只作为可借鉴行为，不视为通用标准。
- 仓库判断以 2026-07-24 当前代码和已接受设计文档为准。
- 所有最终外部引用均通过 Open CLI 读取已知官方 URL 或原始论文页面复核。

### 检索透明度

在收到“所有网络检索优先 Open CLI”的补充约束前，曾使用一次通用 Web Search 发现候选来源；该搜索摘要没有进入任何结论或引用。随后所有实际引用均由 Open CLI 原文复核。Open CLI 对 Microsoft HAX “Remember recent interactions”页面返回限流占位内容，因此本报告不引用该页，只使用能成功读取的 HAX 官方研究页和“Update and adapt cautiously”页面。未再用 Web Search 补证。

### 不能由这些来源推出的结论

- 《个人信息保护法》给出合法、正当、必要、最小范围、保存期限、撤回与删除等边界，但本报告不是法律意见；具体保存期限和跨境处理仍需结合业务主体、供应商合同和律师意见确定。
- RAG 论文证明“显式非参数记忆可改善知识更新和来源问题”是一条有效研究路线；它**不证明**本项目必须使用向量库。
- LongMemEval 把长期记忆能力拆成提取、跨会话推理、时间推理、知识更新和拒答，并用索引—检索—阅读分析系统；它**不证明**首发必须建设一个自主记忆框架。
- OpenAI Memory/Temporary Chat 文档展示了“来源可见、可更正、记忆与聊天分开删除、临时会话不创建记忆”等产品行为；这些是对本项目有用的交互参照，不是外部合规认证。

## 一手来源提炼出的硬边界

### 1. 最小必要、透明、限期保存与可撤回

《中华人民共和国个人信息保护法》要求处理个人信息具有明确、合理目的并与目的直接相关，收集限于实现目的的最小范围；基于同意的处理应支持便捷撤回；告知内容包括处理目的、方式、种类和保存期限；保存期限原则上应为实现目的所必要的最短时间。个人还拥有查阅、复制、更正和在法定条件下删除的权利。[中国人大网：个人信息保护法，第 4—19、44—50 条](http://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html)

对本项目的直接含义：

- “以后可能有用”不是保存完整聊天、素材或反馈的充分理由。
- 会话恢复、长期偏好、生成证据、评测样本必须分别说明目的和期限。
- 删除一个“记忆”不能只删展示层摘要；必须能追溯它来自哪些聊天、文件、素材或连接源，并处理相关副本。
- 改变用途、范围或处理方式不能静默沿用旧授权。

### 2. 敏感信息、自动化决策与影响评估

该法把生物识别、宗教信仰、特定身份、医疗健康、金融账户、行踪轨迹以及不满十四周岁未成年人的信息列为敏感个人信息，并要求特定目的、充分必要性和严格保护措施；对敏感信息、自动化决策、委托/对外提供、公开或其他重大影响处理，应事前进行个人信息保护影响评估并记录。[中国人大网：个人信息保护法，第 28—32、55—56 条](http://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html)

因此，系统即使技术上能从照片、聊天、评价或行为中推断，也不应自动长期保存健康状况、年龄、位置、身份类别、消费能力、心理状态等标签。可识别顾客素材、before/after、声音、评价和聊天记录只能在当前用途确有必要且权利完整时参与生成。

### 3. 来源、修订与失效可以用轻量字段表达

W3C PROV-O 把来源描述建立在 `Entity`、`Activity`、`Agent` 及 `wasGeneratedBy`、`wasDerivedFrom`、`wasAttributedTo` 等关系上，并提供 `hadPrimarySource`、`wasRevisionOf`、`invalidatedAtTime`、`wasInvalidatedBy` 等扩展。标准明确说明应用可以只使用所需子集，且 PROV-O 可以作为领域来源模型的参考，而非要求部署完整本体系统。[W3C PROV-O Recommendation](https://www.w3.org/TR/prov-o/)

本项目只需借用语义，不需要 RDF 或图数据库：

- `sourceRef`：主来源或确认事件；
- `recordedBy/confirmedBy`：责任主体；
- `revision/supersedes`：修订关系；
- `effectiveFrom/expiresAt`：有效期；
- `invalidatedAt/invalidatedBy/reason`：失效关系。

### 4. 授权是可执行规则，不是一个布尔标签

W3C ODRL 2.2 将权利表达拆为资产、主体、动作，以及 Permission、Prohibition、Duty 和 Constraint；还定义策略版本替代和冲突处理。它说明“谁可以在什么条件下对哪个资产做什么”需要显式表达，而不是只给素材写一个永久 `authorized=true`。[W3C ODRL Information Model 2.2](https://www.w3.org/TR/odrl-model/)

本项目不需要实现完整 ODRL，但授权最少应绑定：

- `assetId` 与可识别主体；
- 授权方、被授权工作区/门店；
- 动作：生成、编辑、公开发布、付费投放等；
- 平台、场景和地域；
- 生效期、到期时间；
- 是否允许肖像、声音、评价、聊天、before/after 等具体用途；
- 撤权、替代版本与冲突时“禁止优先”的规则。

### 5. 外部记忆应可更新、可溯源，但检索实现不是产品语义

RAG 原始论文指出，仅依赖模型参数保存事实时，精确访问、更新知识和提供来源仍是开放问题；显式外部记忆是一种解决路线。[NeurIPS 2020：Retrieval-Augmented Generation](https://proceedings.neurips.cc/paper/2020/hash/6b493230205f780e1bc26945df7481e5-Abstract.html)

对本项目有价值的是“权威记录在模型之外、生成时检索并保留来源”，而不是论文使用的 dense vector index。本项目的数据量、作用域和字段结构都允许先用现有结构化存储和确定性筛选；如果后续加入全文或向量召回，它只能返回候选 ID，最终是否可用仍由作用域、状态、版本、有效期和权利解析器决定。

### 6. 长期记忆必须评测知识更新与拒答，而不只是召回

LongMemEval 把长期记忆能力分为信息提取、跨会话推理、时间推理、知识更新和拒答，并报告长历史会显著降低现有系统准确率；论文还把记忆系统拆成索引、检索和阅读三个阶段。[LongMemEval, arXiv:2410.10813](https://arxiv.org/abs/2410.10813)

这支持两点：

- 评测不能只问“有没有找到历史”，还要问“旧信息被新版本替代了吗”“过期/撤销后会拒绝使用吗”“没有证据时会不会猜”。
- 完整历史越长不等于上下文越好；先将事件转成有作用域、有时间的原子记录，再按当前任务筛选，通常比整段拼接更可控。

### 7. 记忆更新要谨慎，评测需固定目标、数据、指标和持续闭环

Microsoft 的人机交互研究提出 18 条经过多轮评估的通用指南；HAX 的“Update and adapt cautiously”明确要求控制行为更新的规模和速率，避免破坏以前表现良好的任务，并用用户研究评估干扰。[Microsoft Research：Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) [Microsoft HAX：Update and adapt cautiously](https://www.microsoft.com/en-us/haxtoolkit/guideline/update-and-adapt-cautiously/)

NIST AI RMF Playbook 的 Measure 部分要求按具体目的选择指标、记录测试集和 TEVV 方法、定义可接受边界、比较部署前后表现、持续吸收正负用户反馈，并记录基线和变化。[NIST AI RMF Playbook：Measure](https://airc.nist.gov/airmf-resources/playbook/measure/)

OpenAI 的评测最佳实践同样建议明确目标、收集任务特定数据、定义指标、运行比较和持续评测；避免只看通用指标或“感觉可用”，并以人工判断校准自动评分。[OpenAI：Evaluation best practices](https://platform.openai.com/docs/guides/evaluation-best-practices)

## 建议的六层最小数据分类

下表描述的是逻辑合同，不预设数据库形态。

| 分类 | 典型内容 | 可接受来源 | 默认状态与置信度 | 版本/有效期 | 进入本次上下文的条件 | 删除/撤权 |
| --- | --- | --- | --- | --- | --- | --- |
| A. 稳定身份事实 | 品牌名、经营主体、个人 IP 所有者、真实角色、专业边界、允许平台/场景 | 负责人明确确认、已验证账号/系统、有效合同或登记资料；模型/OCR 只能提候选 | `verified` 或 `confirmed`；候选可有提取置信度，但不能自动生效 | 不可原地覆盖；新 revision 替代旧 revision；人员离开、运营人变化、授权到期触发失效 | 工作区、身份、平台、场景均匹配，精确 revision 仍为 `active` | 撤权立即停止新生成；历史发布物进入单独处置任务；个人信息删除按法定边界处理 |
| B. 品牌/门店知识 | 服务、价格、活动、团购、资质、履约、员工经历、案例事实 | verified API、带来源导入、截图/OCR 后确认、用户确认、明确聚合统计 | 关键事实必须 `verified/confirmed`；`extracted_candidate` 不直接进入成品 | `effectiveFrom/expiresAt/revision`；价格与活动必须有新鲜度 | 门店/服务/身份/平台作用域匹配，未过期，无更高版本冲突 | 失效后阻断新生成并使相关待发布版本失效；删除源和派生候选 |
| C. 已授权素材 | 图片、视频、声音、评价、聊天、before/after、历史内容 | 用户上传、已授权连接源、素材库；授权声明必须独立可验证 | 素材质量分与权利状态分离；再高质量也不能把 `not_authorized` 变为可用 | 素材 revision 与权利 policy revision 分开；权利有用途和期限 | 素材有效，当前用途/平台/主体/期限/投放范围全部获准 | 撤权立即不再检索或生成；清理原件、缩略图、转码、缓存、索引；历史公开内容按真实权限处置 |
| D. 会话上下文 | 当前任务指令、临时纠正、选中的项目/身份/素材、必要的任务恢复状态 | 当前用户输入、当前任务选择、系统本次解析 | `session_only`；不需要长期置信度，歧义时直接询问 | 绑定 `taskId`/draft revision；短 TTL；任务完成或过期后清理 | 只属于当前任务，且未被后续指令覆盖 | 默认随 TTL 删除；用户删除任务时级联；不得因再次打开历史任务而复活为偏好 |
| E. 长期偏好 | 稳定的版式、语气、镜头、CTA、备选数量等非事实性选择 | 用户明确“以后都这样”；或至少三次独立任务中相同修改形成候选，再由用户确认 | `pending` → `confirmed`；重复行为只提高候选证据，不自动激活 | 每次确认/撤销/替代形成 revision；作用域默认最窄 | `confirmed + current`，作用域匹配，且功能已通过评测/发布门 | 用户可查看、更正、撤销；撤销立即排除，随后清理派生索引；旧值不得从聊天重新生成 |
| F. 任务反馈 | 直接采用、小改、大改、重做、拒绝、原因码、输出与修改差异 | 明确交互事件和当前任务版本 | 是观测事件，不是真值；无“用户没点=不喜欢”推断 | 追加事件，绑定输入/输出 revision 和时间；按评测目的设 TTL | 默认不直接进 prompt；只用于聚合评测或生成偏好候选 | 删除任务或撤回评测使用时按策略清理/匿名化；不得保存不必要的完整原文 |

### 派生候选不是第七类真相

OCR、LLM 抽取、相似性召回、从编辑差异中归纳出的内容统一进入 `derived_candidate` 隔离态。候选必须指回一个或多个原始来源，不能被下游当作 `confirmed`：

- 事实候选：用户或权威源确认后才进入 A/B。
- 权利候选：不能靠模型确认；必须有明确授权主体和规则。
- 偏好候选：用户再次确认后才进入 E。
- 评测标签候选：只能在人工抽查或规则验证后进入固定样例。

## 最小统一记录信封

建议在后续领域模型票中复用现有字段，补齐以下逻辑信封；它可以落在现有关系表、JSON 列或事件表中。

```ts
interface ContextMemoryRecord {
  id: string;
  workspaceId: string;
  category:
    | 'identity_fact'
    | 'store_knowledge'
    | 'authorized_asset'
    | 'session_context'
    | 'long_term_preference'
    | 'task_feedback';
  semanticKey: string;
  value?: unknown;
  valueRef?: string;
  scope: {
    storeId?: string;
    personaId?: string;
    scene?: string;
    platform?: string;
    taskId?: string;
  };
  source: {
    kind: string;
    referenceId: string;
    capturedAt: string;
    actorId?: string;
  };
  epistemicStatus:
    | 'verified'
    | 'confirmed'
    | 'extracted_candidate'
    | 'inferred_candidate'
    | 'unknown';
  confidence?: number;
  revision: number;
  supersedes?: string;
  effectiveFrom: string;
  expiresAt?: string;
  recordState: 'current' | 'revoked' | 'superseded' | 'deleted';
  retentionClass: 'task_ttl' | 'purpose_bound' | 'user_managed' | 'audit_minimum';
  rightsPolicyRef?: string;
}
```

### 必须写进解析器的语义

1. `source.referenceId` 对所有可复用记录必填；“模型觉得像”不是来源。
2. `confidence` 仅适用于抽取、匹配或候选排序；`0.99` 也不能把未授权素材变成已授权，把推测价格变成当前价格。
3. `verified/confirmed` 是来源和流程状态，不由模型分数计算。
4. 同一 `semanticKey + scope` 出现冲突时，优先精确作用域、当前有效 revision 和更高权威来源；无法唯一解析就拒答/请求确认。
5. `revoked/superseded/deleted` 必须在召回之后、编译之前再次校验，避免过期索引返回旧值。
6. 生成证据冻结使用过的 record ID/revision/sourceRef/rights policy revision；不冻结完整历史。

## 最小上下文装配流程

```text
current request
  -> resolve exact workspace/store/persona/task scope
  -> load current instruction and explicit selections
  -> resolve active identity/store facts/requested assets
  -> enforce rights and expiry at exact intended use
  -> optionally resolve confirmed preferences in the narrowest scope
  -> rank/deduplicate by authority, scope, recency and key
  -> fit a declared per-dimension budget
  -> compile structured ContextBundle + evidence references
  -> freeze revision/hash for generation and later replay
```

### 不把所有历史塞进 prompt

- 当前会话只抽取本任务所需的明确指令、选择和临时纠偏。
- 历史任务只通过已经确认的事实、资产、偏好或复用结构进入，不注入完整对话。
- 对每个维度设条目/字符预算；先保留权利、身份、价格、活动等硬约束，再保留表达偏好。
- 同一语义键只注入一个已解析值，同时保留其来源引用供证据抽屉展示。
- 没有足够证据时注入 `unknown/needs_confirmation` 控制信号，而不是让模型补全。
- prompt 中不放删除日志、完整授权合同、无关顾客资料、供应商密钥或内部审计细节。

### 检索实现边界

首发推荐：

- 用现有工作区隔离的结构化记录、作用域字段、状态索引和版本头完成确定性筛选。
- 内容较长时可以加入普通全文检索或摘要，但摘要必须指向原始 revision。
- 只有当真实评测证明结构化检索的召回不足且规模/延迟值得时，再试验 embedding。
- 即使使用 embedding，它也只产生候选 ID；权威解析和权利门仍读取主记录。
- 不因“可能会有复杂关系”预建知识图谱。只有当出现三个以上需要多跳关系、且结构化 join 无法满足的已验证场景时再单独立项。

## 不能自动推断或长期保存的内容

### 禁止自动晋升为长期事实

- 顾客或员工的医疗健康、皮肤病诊断、宗教、金融账户、精确位置、未成年人身份、生物识别等敏感信息。
- 从照片、声音、名字、消费或表达风格推断的年龄、性别、民族、收入、性取向、政治倾向、心理状态或人格标签。
- 顾客身份、客户关系、服务记录、before/after 对应关系。
- 员工资历、从业年限、专业资格、疗效能力、代言关系和真实经历。
- 价格、优惠、活动期限、团购权益、预约余量、核销和平台表现。
- 素材所有权、肖像/声音/评价/聊天授权、是否允许公开或付费投放。
- 平台账号权限、支付或扣费权限。

这些内容只能来自明确、可追溯且适合当前目的的来源；模型只能标记“待确认”。

### 默认不长期保存

- 完整聊天记录、完整 prompt、隐藏系统提示和 Provider 路由。
- 一次性纠正、当前任务临时指令、探索性草稿、被拒绝候选和中间推理。
- 原图不必要的 EXIF、位置、通讯录、文件路径、设备信息。
- OAuth token、API key、验证码、支付凭据、cookie 或其他认证秘密。
- 供应商返回的原始调试日志中与任务无关的个人信息。
- 用户没有点击、停留时间、滚动、沉默等弱信号对应的“偏好解释”。

确需为任务恢复、安全或法定义务短期保留时，应进入单独 `retentionClass`，声明用途和 TTL，不得被个性化解析器读取。

### 反馈不能直接成为偏好

- `adopted` 只说明这次选择可用，不说明“以后都这样”。
- `modified` 是候选证据；至少跨三个独立任务稳定一致，才值得向用户提议。
- `rejected/regenerated` 可能由事实错误、素材错误、平台不适配或临时心情造成，不能直接归纳出相反偏好。
- 用户明确说“只改这次”时，后续任何自动归纳都必须排除该信号。

## 删除、撤权与不复活合同

### 两阶段执行

**阶段 1：立即阻断**

- 将记录或权利策略标为 `revoked/deletion_pending`。
- 推进对应 source revision，触发 ContextBundle 失效。
- 生成、重做、导出、发布和付费投放解析器立即排除。
- 暂停仍在队列中的任务；要求重新编译或改用安全素材。

**阶段 2：可验证清理**

- 清理主记录中不再需要的值、原始素材、缩略图、转码、副本和缓存。
- 清理全文/向量等派生索引；不得只删主表。
- 清理从该来源形成的事实/偏好候选和评测样本，或在合法必要时不可逆匿名化。
- 按供应商合同请求删除或等待其已声明保留窗结束。
- 写入 `deletionReceipt`：请求范围、处理的资源类别、完成/例外状态、时间、执行者、下次复核时间；回执不保留原始内容。

《个人信息保护法》第四十七条允许在法定保存期限未届满或技术上难以删除时停止除存储和必要安全保护外的处理。因此，例外状态必须是“冻结且不可用于生成”，不能用“暂时删不了”继续个性化。[中国人大网：个人信息保护法，第 47 条](http://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html)

### 撤权不等于抹去历史

- 撤权后停止所有新使用，并处理尚未公开、待发布或可撤回的版本。
- 已依法公开的历史内容是否删除、匿名化或保留，应按授权条款、平台能力和法定义务进入单独处置任务。
- 生成证据可以保留最小的 revision/hash/动作记录以解释过去行为，但不应因此保留已删除素材本体或敏感文本。
- 删除源后，系统不得从历史聊天、旧 bundle、缓存、备份恢复成新的“记忆”。这需要专门的不复活回归测试。

### 用户可见控制

用户至少应能：

- 查看“系统长期使用的内容”，按事实、素材、偏好分类；
- 查看每项来源、更新时间、作用域、有效期和授权状态；
- 更正、撤销、删除；
- 发起“本次不使用任何长期偏好”的临时模式；
- 知道删除历史任务不一定自动删除独立保存的长期记录，反之亦然，并获得一键联动删除选项。

OpenAI Memory FAQ 公开说明了记忆摘要可查看/更正、完全删除需要清理包含该信息的各来源、关闭记忆不会自动删除历史聊天；Temporary Chat 则不访问或创建个性化记忆。这个行为分层可以借鉴，但本项目应做得更窄：默认不从普通任务自动建长期记忆。[OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq) [OpenAI Temporary Chat FAQ](https://help.openai.com/en/articles/8914046-temporary-chat-faq)

## 最小离线评测闭环

### 固定样例集 v0

建议先建立 **32 个可人工审阅的固定样例**，而不是追求大规模模糊分数：

- 24 个基础样例：六类数据各覆盖正常命中、同键冲突、过期/替代、缺失应拒答四种情形。
- 8 个红线样例：跨工作区/门店串线、未授权主体素材、撤权后重做、删除后不复活、一次性纠偏不长期化、价格过期、身份离职、检索命中但最终权利门拒绝。

每个样例固定：

- 当前任务与精确作用域；
- 可用记录、来源、revision、有效期和权利；
- 预期入选/排除记录 ID；
- 预期 ContextBundle 摘要与证据引用；
- 允许的澄清问题；
- 不允许出现的事实、素材和行为；
- 删除/撤权后的二次运行预期。

### 硬守门指标

以下按样例计数，阈值均为 0：

- `cross_workspace_or_store_leak_count`
- `unsourced_key_fact_use_count`
- `unauthorized_asset_use_count`
- `revoked_or_deleted_record_reuse_count`
- `expired_or_superseded_fact_use_count`
- `temporary_instruction_persisted_count`
- `unconfirmed_inference_promoted_count`
- `wrong_revision_evidence_count`

这与现有产品文档的零容忍守门一致。[产品设计 L317-L328](../../../docs/design/beauty-marketing-agent-product-design-2026-07-17.md#L317)

### 质量指标

- `context_precision`：进入 bundle 的记录中确实与任务相关、有效且获准的比例。
- `context_recall`：固定金标要求的记录被正确选入的比例。
- `conflict_resolution_accuracy`：版本、来源、作用域冲突按预期处理的比例。
- `abstention_accuracy`：证据不足时正确询问/拒绝而不是猜测的比例。
- `evidence_trace_accuracy`：输出声明能追到正确 record/source/revision 的比例。
- `bundle_determinism`：同输入、同 revision 得到相同 hash 的比例，应为 100%。
- `context_size_budget`：各维度条目/字符预算与总体 token 预算。
- `deletion_completion_latency`：从请求到所有声明范围完成清理的时间，并单列供应商例外。

自动评分优先做精确 ID/状态/规则判断；文案质量用成对比较或明确 rubric，并先与领域人工判断校准。不要用单一“LLM 打分”替代事实和权利守门。

### 每次变更的运行顺序

1. 冻结样例与通过阈值，避免看完结果再改标准。
2. 单测解析、作用域、版本、权利、删除和 hash。
3. 跑 32 例固定集，硬守门必须全过。
4. 对受影响能力做少量领域人工盲审。
5. 与上一个已放行版本做回归比较；任何红线退化直接阻断。
6. 记录模型、prompt/compiler、数据 schema 和评测集 revision，保证结果可重放。

## 最小在线质量闭环

### 只采集四个核心事件

```text
adopted
edited
regenerated
rejected
```

每个事件最少绑定：

- `workspaceId/taskId/packageId/versionId`
- `contextBundleId/revision/hash`
- recipe/compiler/model revision
- 事件时间
- 可选的结构化原因码
- 对 `edited` 保存最小语义差异或字段差异；默认不复制完整输入输出文本

### 从反馈到偏好的安全路径

```text
task feedback
  -> aggregate by semantic key and narrow scope
  -> three independent consistent modifications
  -> pending preference candidate
  -> user reviews value, examples, source tasks and scope
  -> confirmed but feature-gated
  -> offline regression + small canary
  -> active
  -> visible correction/revocation
```

关键点：

- 三次只是“值得询问”的最小产品启发式，不是统计真理，也不是自动激活阈值。
- 候选必须展示正例、反例和作用域，避免把门店 A 的风格扩到门店 B。
- 首次上线可以让确认偏好仍保持 `inactive_stage2`，等固定样例和线上回滚能力成熟后再启用。
- 线上比较至少报告直接采用、小改、大改/重做、拒绝；结果信号只描述共现，不声称内容导致转化。
- 在线样本进入离线集前要脱敏、去重、人工确认预期，并尊重删除/撤回。

### 线上告警

- 红线事件实时阻断并进入人工检查，不等日汇总。
- `regenerated` 或大改率按场景/平台/模型/compiler revision 分层，避免总平均掩盖局部退化。
- 发现新失败样例后，先加入固定集再修复；修复必须同时通过旧样例。
- 偏好激活后持续比较“使用/不使用偏好”的可用率和误用率，出现误用可一键回滚 source revision。

## 当前仓库已经具备的基础

### 1. ContextBundle 已有确定性骨架

`context-bundle.ts` 已定义：

- 门店事实种类、来源类型、来源引用和采集时间；
- 门店/服务/身份/平台作用域；
- `effectiveFrom/expiresAt/revision/recordedBy`；
- 固定优先级：本次指令、当前事实、已确认资产、已确认偏好、行业配方、模型知识；
- facts/assets/identity/rights/preferences 等 source revision；
- bundle revision、hash、冻结时间和重编译/失效事件。

证据：[context-bundle.ts L7-L70](../../../packages/contracts/src/context-bundle.ts#L7) [context-bundle.ts L72-L145](../../../packages/contracts/src/context-bundle.ts#L72) [context-bundle.ts L161-L241](../../../packages/contracts/src/context-bundle.ts#L161)

`context-compiler.ts` 已做 canonical JSON、SHA-256、固定优先级、按维度/键唯一选择和来源 revision 变化检测，适合作为“不是完整历史，而是确定性编译产物”的基础。[context-compiler.ts L15-L63](../../../apps/core/src/p1/operations/context-compiler.ts#L15) [context-compiler.ts L78-L140](../../../apps/core/src/p1/operations/context-compiler.ts#L78)

### 2. 当前装配器已从结构化源选择最小上下文

`production-context-port.ts` 当前会读取有效事实、直接请求素材、可复用 revision、有效身份和精确 ContentPackage revision，检查请求素材权利后组成 contributions 并冻结 bundle。[production-context-port.ts L142-L284](../../../apps/core/src/p1/harness/production-context-port.ts#L142)

它还把 raw input、intent、作用域、决策引用和 reuse seed 纳入当前信号指纹，并把身份作为 `confirmed_asset` 注入，保留精确身份 version。[production-context-port.ts L439-L470](../../../apps/core/src/p1/harness/production-context-port.ts#L439) [production-context-port.ts L579-L617](../../../apps/core/src/p1/harness/production-context-port.ts#L579)

### 3. 身份、权利证据和偏好晋升已较接近目标

- 身份资产已有 `active/revoked/departed/operator_changed`、专业边界、允许平台/场景、生效/到期、肖像/声音/历史内容授权和显式 transition。[marketing-package.ts L150-L246](../../../packages/contracts/src/marketing-package.ts#L150)
- 成品证据冻结 ContextBundle ID/revision/hash，并保留 fact/rights/identity refs。[marketing-package.ts L502-L520](../../../packages/contracts/src/marketing-package.ts#L502)
- 复用资产要求来源包/version/bundle revision、权利为 `authorized`，作用域扩大必须明确决定。[reuse-memory.ts L7-L78](../../../packages/contracts/src/reuse-memory.ts#L7) [reuse-memory.ts L195-L270](../../../packages/contracts/src/reuse-memory.ts#L195)
- 偏好信号区分 adopted/modified/rejected；重复修改必须来自三个独立任务才提出候选。[reuse-memory-service.ts L757-L875](../../../apps/core/src/p1/operations/reuse-memory-service.ts#L757)
- 用户确认后偏好仍固定为 `inactive_stage2`，并支持版本化撤销；这是当前值得保留的 fail-closed 行为。[reuse-memory.ts L285-L343](../../../packages/contracts/src/reuse-memory.ts#L285) [reuse-memory-service.ts L878-L1000](../../../apps/core/src/p1/operations/reuse-memory-service.ts#L878)

## 当前缺口与最小优化建议

### P0：进入生成前缺少统一“认识状态”

现有 `ContextContribution` 有 `layer/pool/sourceRef/capabilityStatus/factRevision`，但没有统一区分 `verified/confirmed/extracted_candidate/inferred_candidate/unknown`，也没有表达候选置信度。[context-bundle.ts L131-L145](../../../packages/contracts/src/context-bundle.ts#L131)

最小建议：

- 为来源记录或 contribution 增加 `epistemicStatus`；只有 `verified/confirmed` 可进入事实和授权路径。
- `confidence` 只对 candidate 可选，编译器绝不把分数映射为授权或确认。
- 先为价格、活动、资质、身份和权利覆盖，再扩到一般内容。

### P0：缺少贯穿该领域的保留/删除/不复活合同

当前上下文、事实、复用和偏好合同支持过期、撤销、superseded 和失效事件，但在所审阅的记忆主干合同中没有统一的 `retentionClass`、用户删除命令、级联清理范围或删除回执。仓库其他模块存在素材删除、画布软删/清理和多种 `deleteWorkspaceForTest`，但它们不是上下文记忆的端到端用户删除合同。

最小建议：

- 先定义逻辑 `DeletionRequest/DeletionReceipt` 和必须覆盖的资源类型。
- 复用 source revision + invalidation 做立即阻断。
- 再由小型协调器调用各现有 repository/storage 的删除能力；不为此引入通用数据治理平台。
- 固定加入“旧 bundle、历史聊天、缓存、全文/向量索引不得复活”的回归用例。

### P0：偏好当前只有 revision 头，没有实际装配路径

`ContextBundle` 已预留 `confirmed_preference` 和 preferences source revision，但当前 `production-context-port.ts` 的 contributions 只装入本次指令、来源摘要、请求素材、ContentPackage、复用 revision、身份与事实，没有解析确认偏好；preferences 目前只出现在 revision heads 中。[context-bundle.ts L81-L99](../../../packages/contracts/src/context-bundle.ts#L81) [production-context-port.ts L185-L260](../../../apps/core/src/p1/harness/production-context-port.ts#L185) [production-context-port.ts L439-L470](../../../apps/core/src/p1/harness/production-context-port.ts#L439)

这不是立即要“补齐”的普通缺口，而是一个正确的发布门：

- 在离线样例、线上撤销和误用告警未完成前继续保持 `inactive_stage2`。
- 后续只增加一个窄的 confirmed preference resolver，输出仍走现有 contribution/compile/freeze。
- 不创建自主记忆 Agent。

### P1：会话恢复与长期保存的边界没有成为显式领域合同

当前任务输入被纳入 `currentSignal` 指纹，有利于重编译，但相关合同没有明确 raw input、完整聊天、中间草稿的保留类别和 TTL。[production-context-port.ts L439-L466](../../../apps/core/src/p1/harness/production-context-port.ts#L439)

最小建议：

- 将“任务可恢复状态”和“长期个性化记录”分表或至少分 retention class。
- 恢复状态到期后删除；不能被 preference resolver 直接扫描。
- 只有结构化且确认的记录进入长期路径。

### P1：反馈事件足以做候选，但还需要评测语义

现有 `adopted/modified/rejected` 和三独立任务规则已经避免单次行为直接长期化；还应补充 `regenerated`、结构化原因码、输入/输出 revision 和最小语义 diff，使反馈既能复盘，又不必长期保存完整文案。

### P1：权利应在每次具体用途上重新解析

当前装配器会对直接/选中素材调用 rights resolver，这是良好基础。[production-context-port.ts L174-L181](../../../apps/core/src/p1/harness/production-context-port.ts#L174) 后续应确保解析输入包含动作、平台、场景、主体、期限和是否付费投放，并在重做、导出、发布各边界按当前 policy revision 再校验；不能把摄取时授权永久缓存为素材属性。

## 后续决策票可采用的三个方案

### 方案 A：结构化记录 + 确定性编译 + 显式确认（推荐首发）

- 延续现有 ContextBundle、source revisions、身份/事实/权利/偏好 contracts。
- 增加认识状态、保留类别、删除回执和固定评测集。
- 不引入新的检索基础设施。

优点：改动小、可解释、删除和租户隔离边界清楚，直接利用现有代码。  
缺点：长文本素材和大量历史增长后，召回可能不足，需要真实样本验证。

### 方案 B：在 A 上增加全文/embedding 候选召回（条件采用）

- 检索层仅返回候选 record ID。
- 权威解析器仍基于主记录校验作用域、状态、revision、有效期和权利。
- 索引必须支持按工作区删除和重建。

采用条件：固定集证明确有召回缺口，且加入后 `context_recall` 改善、红线仍为 0、删除不复活、成本和延迟可接受。

### 方案 C：自主记忆框架或知识图谱先行（不建议首发）

它会同时放大推断长期化、权利传播、删除级联、调试和评测复杂度，而当前用户价值可由六类结构化记录和现有编译器覆盖。除非后续出现被验证的多跳关系场景或跨大量非结构化资料的召回瓶颈，否则没有足够证据承担该复杂度。

## 建议交给后续锁定票的决策

1. 锁定六类数据及 `derived_candidate` 隔离态，不让“memory”成为一个无边界表。
2. 锁定 `source/scope/revision/effective/expires/state/retention/rights` 为长期记录最低字段。
3. 锁定置信度不能覆盖来源、确认和授权。
4. 锁定当前任务上下文默认短期，普通修改默认只作用本次。
5. 锁定偏好路径为“明确长期意图，或三独立任务候选 + 用户确认”，首发可继续 inactive。
6. 锁定撤权立即阻断、删除异步清理、全链路不复活和最小删除回执。
7. 锁定 32 例固定集、八项零容忍和四类在线反馈事件。
8. 锁定检索技术可替换：结构化筛选是语义基线，全文/向量只是可选加速器，不预设知识图谱。

## 仍需产品/法律/供应商共同确定的开放项

- 各 `retentionClass` 的具体天数、备份清理窗口和删除 SLA。
- 供应商对输入、输出、日志、训练使用和子处理方的真实保留条款。
- 已公开历史内容在员工离开、主体撤权和平台不可撤回时的处置策略。
- 哪些在线样本允许经脱敏后进入固定评测集，以及用户撤回后的清理方法。
- 长期偏好首发是否保持完全 inactive，还是只开放少数低风险表达字段。

这些开放项不阻碍先锁定数据分类、来源/版本/状态、不自动推断、删除不复活和评测硬守门。

## 参考资料

### 法律与标准

1. [全国人民代表大会常务委员会：《中华人民共和国个人信息保护法》](http://www.npc.gov.cn/npc/c2/c30834/202108/t20210820_313088.html)
2. [W3C Recommendation：PROV-O: The PROV Ontology](https://www.w3.org/TR/prov-o/)
3. [W3C Recommendation：ODRL Information Model 2.2](https://www.w3.org/TR/odrl-model/)
4. [NIST：Privacy Framework 1.0](https://www.nist.gov/privacy-framework/privacy-framework)
5. [NIST AI RMF Playbook：Measure](https://airc.nist.gov/airmf-resources/playbook/measure/)

### 论文与研究

6. [Lewis et al., Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks, NeurIPS 2020](https://proceedings.neurips.cc/paper/2020/hash/6b493230205f780e1bc26945df7481e5-Abstract.html)
7. [Wu et al., LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory, arXiv:2410.10813 v2](https://arxiv.org/abs/2410.10813)
8. [Amershi et al., Guidelines for Human-AI Interaction, CHI 2019](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)
9. [Microsoft HAX：Update and adapt cautiously](https://www.microsoft.com/en-us/haxtoolkit/guideline/update-and-adapt-cautiously/)

### 官方产品与开发文档（仅作行为参照）

10. [OpenAI：Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)
11. [OpenAI：Temporary Chat FAQ](https://help.openai.com/en/articles/8914046-temporary-chat-faq)
12. [OpenAI：Evaluation best practices](https://platform.openai.com/docs/guides/evaluation-best-practices)
