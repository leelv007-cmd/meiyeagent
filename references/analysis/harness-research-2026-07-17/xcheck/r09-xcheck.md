哥，## 判定汇总表

核验时点：2026-07-17。共提取 20 条可证伪断言：✅ 6 条、❌ 5 条、⚠️ 9 条、❓ 0 条。

| # | 报告断言 | 判定 | 核验结论 |
|---:|---|:---:|---|
| 1 | Flowise 为 Apache 2.0 + 专有企业代码，镜像 v3.1.3 且活跃 | ✅ | LICENSE、版本与提交均吻合 |
| 2 | Langflow 为 MIT，当前高度活跃 | ✅ | LICENSE、1.10.2 版本与近期提交吻合 |
| 3 | CVE-2025-59528 是影响 `<3.0.6` 的未授权 RCE，已被大规模利用，暴露 12k–15k | ⚠️ | CVSS 10/RCE/活跃攻击成立；实际仅明确影响 3.0.5；认证条件自相矛盾；12k+ 是公网实例，不是受害数；不在 CISA KEV |
| 4 | CVE-2026-40933 是导入 chatflow 即触发的 9.9 RCE | ⚠️ | 9.9、认证后 RCE、3.1.0 修复成立；官方描述是认证用户添加恶意 stdio MCP，不是“一键导入” |
| 5 | CVE-2026-56271 是 9.8 硬编码 JWT 认证绕过 | ⚠️ | 漏洞与修复版本成立，但须环境变量未设置；NVD 9.8、Flowise GHSA 自评 5.6；无在野利用证据 |
| 6 | CVE-2025-8943、CVE-2025-26319 均有在野利用 | ⚠️ | 有 VulnCheck/媒体观测，二者均不在 CISA KEV且规模不明；26319 本身是任意文件上传，不是直接 RCE |
| 7 | Langflow CVE-2025-3248 为 9.8 未授权 RCE，入 KEV、361 个恶意 IP、涉及 botnet/勒索 | ✅ | 事实成立；361 是攻击 IP/尝试，不是 361 次成功入侵 |
| 8 | CVE-2026-5027 是 Langflow RCE，并被 CISA 追踪，涉及跨租户访问 | ❌ | 正确值为 CVSS 8.8、认证后路径穿越/任意文件写入；不在 CISA KEV；跨租户问题属于 CVE-2026-55255 |
| 9 | Flowise 与 Langflow 各有“一串被大规模在野利用、CVSS 9.8–10”的 CVE | ❌ | Langflow 有 4 项 KEV；Flowise KEV 为 0。Flowise 有活跃攻击报告，但“大规模”未获公开证据支持 |
| 10 | n8n SUL、`.ee` 与 EE 许可文本边界 | ✅ | 与 LICENSE 逐字一致；但 n8n 是 source-available/fair-code，不是 OSI 开源 |
| 11 | “客户可见功能都需 Embed；内部运营免费”是清晰二分法 | ❌ | 官方明确允许部分客户可见后台功能；边界至少是四类，而非二类 |
| 12 | n8n v2.31.0、Postgres/队列、AI 包与 EE workflow builder | ⚠️ | 本地 monorepo 是 2.31.0、AI 包存在；npm 最新发布版当时是 2.30.7，报告混淆仓库开发版本与已发布版本 |
| 13 | Windmill 为 AGPLv3 + Apache 组件 + 专有企业/CE 代码；CE 禁 managed service/wrap | ✅ | 与根 LICENSE 原文完全一致 |
| 14 | AGPL 会“网络传染”整个 SaaS，源码版和 CE 版都必须签商业协议 | ❌ | CE 镜像确有限制；纯源码版可选择遵守 AGPL，无须必然购买商业许可，独立 aggregate 也不自动被覆盖 |
| 15 | Windmill 应仅作范式参考 | ⚠️ | README 范式与 OpenFlow 许可属实；“只能参考”是闭源产品策略，不是许可法律上的唯一选项 |
| 16 | React Flow 12.11.2、MIT、三个直接依赖、官方 examples 与安全政策 | ✅ | 本地源码吻合；“三个”仅指直接依赖，不代表完整传递依赖图 |
| 17 | React Flow 约 37.3K stars、797 dependents、Stripe/LinkedIn 生产采用 | ⚠️ | 实时为约 37.7K stars、796 个 npm 依赖包、周下载约 808 万；Stripe 有明确案例，LinkedIn 只有厂商营销表述 |
| 18 | 只读 DAG 是“零运行时、零安全面、零许可风险” | ❌ | 只是不执行工作流；仍有浏览器运行时、供应链、XSS、越权、数据泄露与 MIT 通知义务 |
| 19 | 自建含 viewer 总工作量约 2–3 人周 | ⚠️ | 报告自己的分项相加为 14–20 人日，即 2.8–4 人周，且 eval 集成另计 |
| 20 | `harness_config` 表、Zod、发布/回滚骨架已覆盖主要生产风险 | ⚠️ | 方向正确但不完整；配置漂移、环境、审计只被“点到”，并漏掉并发、不可变工件、prompt pinning、迁移、租户与缓存一致性等关键约束 |

---

## 逐条展开

### 1. Flowise 许可、版本与活跃度：✅

本地 [LICENSE.md](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/Flowise/LICENSE.md:3) 明确：

- `packages/server/src/enterprise/` 和带显式版权声明的文件走 Commercial License；
- 其余代码走 Apache 2.0。

[package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/Flowise/package.json) 为 `3.1.3`；镜像 HEAD 为 `ed9e100`，2026-07-17。npm 当日 latest 也是 3.1.3，前一周下载 2,114 次。[npm registry](https://registry.npmjs.org/flowise/latest)

报告这一部分准确。

### 2. Langflow 许可与活跃度：✅

本地 [LICENSE](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langflow/LICENSE:1) 为 MIT；[pyproject.toml](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/langflow/pyproject.toml:1) 与 PyPI 均为 1.10.2。[PyPI API](https://pypi.org/pypi/langflow/json)

HEAD 时间受时区显示影响为 7 月 14/15 日，但“高度活跃”的判断成立。

### 3. Flowise CVE-2025-59528：⚠️

正确部分：

- CustomMCP 对输入使用 `Function()`，可执行任意 JavaScript/系统命令；
- CVSS 3.1 为 10.0；
- 修复于 3.0.6；
- 2026-04-07 有第三方在野利用观测。[Flowise GHSA](https://github.com/FlowiseAI/Flowise/security/advisories/GHSA-3gcm-f6qx-ff7p)、[NVD](https://nvd.nist.gov/vuln/detail/CVE-2025-59528)

错误或过宽部分：

- 官方 GHSA 的 affected version 是精确的 `3.0.5`，不是报告的全部 `<3.0.6`。
- 官方 CVSS 写 `PR:N`，但官方 PoC 明确带 Bearer API token，并称“only an API token is required”。因此直接断言“无认证”不严谨。
- VulnCheck 观测的活动来自一个 Starlink IP；约 12,000+ 是公网 Flowise 实例攻击面，不是已确认易受攻击或已攻陷实例。[活跃攻击报道](https://thehackernews.com/2026/04/flowise-ai-agent-builder-under-active.html)
- 截至 CISA KEV 2026.07.16，该 CVE 不在 KEV。

应改成“已观察到活跃利用，公网攻击面约 1.2 万实例”，不能写“大规模利用了 1.2–1.5 万实例”。

### 4. Flowise CVE-2026-40933：⚠️

[官方 GHSA](https://github.com/FlowiseAI/Flowise/security/advisories/GHSA-c9gw-hvqq-f33r)确认：

- 影响 `flowise` 与 `flowise-components <=3.0.13`；
- 3.1.0 修复；
- CVSS 9.9；
- 是低权限认证后的 arbitrary command execution。

但官方攻击路径是“认证用户新增带任意命令的 stdio MCP server”。报告所谓“恶意 chatflow 导入即可一键触发”不是一手公告中的结论。

该 CVE 不在 CISA KEV，NVD/CISA SSVC 仅标 `exploitation:poc`。[NVD](https://nvd.nist.gov/vuln/detail/CVE-2026-40933)

### 5. Flowise CVE-2026-56271：⚠️

漏洞事实成立：旧版在 JWT 环境变量未配置时回退到公开默认值，可伪造管理员令牌；`<=3.0.13` 受影响，3.1.0 修复。[Flowise GHSA](https://github.com/FlowiseAI/Flowise/security/advisories/GHSA-cc4f-hjpj-g9p8)

不过评分存在明显分歧：

- NVD/VulnCheck：CVSS 3.1 9.8、CVSS 4.0 9.3；
- Flowise 自己的 GHSA 页面：Moderate 5.6，且其 CVSS 向量与页面正文“不需认证、远程伪造”彼此矛盾。[NVD](https://nvd.nist.gov/vuln/detail/CVE-2026-56271)

报告至少应写明“第三方/NVD 评分 9.8，厂商自评分 5.6”。该漏洞不在 CISA KEV，也没有公开在野利用证据。本地 3.1.3 已采用随机秘密生成逻辑。

### 6. Flowise CVE-2025-8943、CVE-2025-26319：⚠️

- CVE-2025-8943：默认无认证部署可执行未沙箱化 OS 命令，影响 `<3.0.1`，CVSS 9.8。[JFrog 原始公告](https://research.jfrog.com/vulnerabilities/flowise-os-command-remote-code-execution-jfsa-2025-001380578/)、[NVD](https://nvd.nist.gov/vuln/detail/CVE-2025-8943)
- CVE-2025-26319：NVD 描述是 2.2.6 的任意文件上传，CVSS 9.8；可成为进一步 RCE 链条，但 CVE 本身不是直接代码注入。[NVD](https://nvd.nist.gov/vuln/detail/CVE-2025-26319)

VulnCheck/媒体确实报告过攻击活动，但二者都不在 CISA KEV，公开资料没有攻击 IP 数、目标数或成功入侵规模。因此“在野利用”可带来源保留，“大规模利用”不能。

### 7. Langflow CVE-2025-3248：✅

这一项是报告里安全证据最扎实的部分：

- `<1.3.0` 受影响，1.3.0 修复；
- `/api/v1/validate/code` 缺认证，可执行任意 Python；
- CVSS 9.8；
- 2025-05-05 进入 CISA KEV。[Langflow GHSA](https://github.com/langflow-ai/langflow/security/advisories/GHSA-rvqx-wpfh-mfx7)、[NVD](https://nvd.nist.gov/vuln/detail/CVE-2025-3248)

补充核验：

- Recorded Future 转述 GreyNoise 观测到 361 个恶意 IP 的利用尝试、Shodan 约 1,050 个暴露实例；不能解读为 361 次成功入侵。[Recorded Future](https://www.recordedfuture.com/blog/langflow-cve-2025-3248)
- Trend Micro 记录了 Flodrix botnet 利用链。[Trend Micro](https://www.trendmicro.com/en/research/25/f/langflow-vulnerability-flodric-botnet.html)
- Sysdig 记录 JADEPUFFER 勒索活动使用该 CVE。[Sysdig](https://www.sysdig.com/blog/jadepuffer-agentic-ransomware-for-automated-database-extortion)
- CISA 在 2026-07-07 将其 `knownRansomwareCampaignUse` 从 `Unknown` 改为 `Known`。[CISA 数据变更提交](https://github.com/cisagov/kev-data/commit/da74638721468c593fce61dd60a5decc5ef9b0b7)

### 8. Langflow CVE-2026-5027：❌

报告把数个 Langflow 漏洞混在了一起。

[CVE-2026-5027](https://nvd.nist.gov/vuln/detail/CVE-2026-5027)的官方事实是：

- `POST /api/v2/files` 未清理 filename；
- 认证后路径穿越/任意文件写入；
- CVSS 8.8、`PR:L`；
- Tenable 建议升级到 1.9.0+。[Tenable](https://www.tenable.com/security/research/tra-2026-26)

在默认 auto-login 部署中，它可能被利用者降低为无需预先持有凭据，并通过文件写入链成 RCE，但 CVE 描述本身不是“未授权 RCE”。它不在 CISA KEV。

报告引用的内容实际更接近：

- CVE-2026-33017：未授权 RCE、进入 KEV；
- CVE-2026-55255：认证后跨租户执行其他用户 flow、进入 KEV。

尤其附录中的 `GHSA-vwmf-pq79-vjvx` 属于 CVE-2026-33017，不是 CVE-2025-3248。

### 9. “两者均有一串大规模在野利用 CVE”：❌

截至官方 [CISA KEV JSON](https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json)：

- Langflow 有 4 项：CVE-2025-3248、CVE-2026-33017、CVE-2025-34291、CVE-2026-55255；
- Flowise 为 0 项。

因此准确总括应是：

> Flowise 与 Langflow 都有严重代码执行和认证缺陷；Langflow 有多项 CISA KEV，其中 CVE-2025-3248 已关联 botnet 与勒索活动。Flowise 有第三方确认的在野利用，但公开证据不足以称为“大规模利用”。

安全排除方向仍可成立，但原报告的事实表达显著夸张。

### 10. n8n SUL 与 EE 文本：✅

本地 [LICENSE.md](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/n8n/LICENSE.md:3)逐字确认：

- 非 master 分支内容不授予许可；
- 文件名含 `.ee.` 或目录含 `.ee` 的源码不走 SUL；
- SUL 仅允许自身内部业务、非商业或个人使用；
- 对外分发/提供只允许免费且非商业。

[LICENSE_EE.md](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/n8n/LICENSE_EE.md:7)确认生产使用需 Enterprise License，开发/测试可无订阅复制、修改。

报告应避免把 n8n 称为“开源”；其 [README](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/n8n/README.md:49)明确自称 fair-code、Source Available。

### 11. n8n 的“客户可见/内部”二分法：❌

官方 [SUL FAQ](https://docs.n8n.io/sustainable-use-license/)直接给出反例：

- n8n 作为 app 后台“通常允许”，前提是后台不使用终端用户自己的凭据；
- App 内嵌 AI chatbot，使用产品方公司凭据，终端用户只输入问题：明确标为 SUL 允许；
- 收集用户自己的 HubSpot 凭据并通过 n8n 拉取其数据：不允许。

官方 [OEM 文档](https://docs.n8n.io/embed/)又明确区分：

- 向用户暴露 n8n 编辑器、连接和 workflow 管理：OEM/Embed 商业协议；
- 用户看不到 n8n UI、只由产品后台调用：不是 OEM。

更准确的是四类：

1. 自身内部运营：SUL 可免费。
2. 隐藏的客户功能，使用公司凭据，产品价值不主要来自 n8n：通常可按 SUL。
3. 为客户托管其 workflow/credentials、使用客户自己的凭据：需 Enterprise/商业确认。
4. 向客户暴露 n8n UI、编辑器或 workflow builder：需 OEM/Embed。

所以“谁消费 n8n 的价值”不是充分边界。

### 12. n8n 技术版本与 AI 包：⚠️

本地根 [package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/n8n/package.json)确为 `n8n-monorepo 2.31.0`，并存在：

- `nodes-langchain`
- `ai-node-sdk`
- `ai-utilities`
- `computer-use`
- `chat-hub`
- `ai-workflow-builder.ee`

但截至核验时，npm `n8n` latest 为 2.30.7，前一周下载 56,862 次。[npm registry](https://registry.npmjs.org/n8n/latest)

因此 2.31.0 是源码镜像开发版本，不应无说明地当成正式发布版本。

### 13. Windmill 许可分层与 CE 限制：✅

本地 [LICENSE](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/windmill/LICENSE:1)确认：

- 默认 AGPLv3；
- `enterprise` 编译片段及需 license check 的前端代码为专有；
- clients、OpenAPI、OpenFlow spec 为 Apache 2.0；
- 不含 enterprise flag 的源码编译二进制为纯 AGPL；
- 官方 Community Edition 镜像/release 包含非公开专有代码。

CE 原文确实禁止：

> sell, resell, serve as a managed service, modify or wrap

除非取得明确协议。报告对这段原文的转述准确。

### 14. Windmill “AGPL 网络传染 + 两条路都需商业协议”：❌

[LICENSE-AGPL](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/windmill/LICENSE-AGPL:540)要求修改版在网络交互时向用户提供对应源码；但同一许可证也明确，彼此独立、没有组合成更大程序的 aggregate 不会使许可证扩展到其他部分。

Windmill [README](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/windmill/README.md:229)进一步说：

- 官方 CE 镜像：商业封装/managed service 需商业协议；
- 纯源码编译版：遵守 AGPL，或者购买商业许可。

所以“两条路都必须商业授权”是错误的。正确说法是：

> 闭源 SaaS 若不愿承担可能适用的 AGPL 源码义务，可选择商业许可；但纯 AGPL 源码路线并非法律上只能付费。

### 15. Windmill 仅作范式：⚠️

README 的 “simplified Temporal with autogenerated UIs” 原文、类型化入参生成 UI、OpenFlow 为 Apache 2.0 均核实通过。[README](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/windmill/README.md:6)

但“只能作范式参考”不是许可证事实，而是产品决策：

- 若坚持闭源、避免 AGPL 分析与额外运行平台，作为范式参考很合理；
- 若愿意完整遵守 AGPL 或购买商业许可，则并非不能使用。

### 16. React Flow 本地事实：✅

本地证据确认：

- [package.json](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/xyflow/packages/react/package.json:1)：12.11.2、MIT；
- [LICENSE](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/xyflow/LICENSE:1)：MIT；
- 三个直接生产依赖：`@xyflow/system`、`classcat`、`zustand`；
- 指定的 SaveRestore、Layouting、Subflow、NodeToolbar、CustomNode、Validation 等 examples 都存在；
- [SECURITY.md](/Users/bin/Desktop/开发/内容无人区/美业内容2/references/repos/harness-2026-07-17/xyflow/SECURITY.md:14)确有一周确认、四周处置目标。

“三个依赖”只能说直接依赖；`@xyflow/system` 仍有 d3 等传递依赖。

### 17. React Flow 热度与采用：⚠️

截至 2026-07-17：

- GitHub：37,679 stars，约 37.7K，而非 37.3K；
- npm latest：12.11.2；
- 前一周下载：8,078,576；
- npm 索引约 796 个依赖包，不是 797 个“生产项目”。[GitHub](https://github.com/xyflow/xyflow)、[npm 下载 API](https://api.npmjs.org/downloads/point/last-week/%40xyflow%2Freact)

采用出处：

- [官方 showcase](https://reactflow.dev/showcase)明确说 Stripe 将 React Flow 用于文档 flowchart；
- [React Flow Pro 页面](https://reactflow.dev/pro)称 Stripe 和 LinkedIn 等组织使用它，但 LinkedIn 没有单独案例或实现链接。

所以“Stripe 使用”可确认；“LinkedIn 在生产使用”只能标为厂商一方营销声明。

### 18. “只读 DAG 零执行、零安全、零许可风险”：❌

成立的窄口径只有：

> React Flow 不提供服务端节点执行器，不会像 Flowise/Langflow 一样直接把用户图转成子进程或 Python/JS 执行。

仍然存在：

- 浏览器 JavaScript 与供应链运行时；
- 自定义节点、Markdown、prompt 详情中的 XSS/恶意链接；
- prompt、trace、错误信息泄露客户数据、系统提示或密钥片段；
- workspace IDOR、租户越权、缓存串租户；
- 大图/长 trace 的前端 DoS；
- MIT 版权与许可文本保留义务；
- Pro 模板和无 LICENSE 社区模板的独立许可边界。

应改为“显著缩小服务端代码执行面、许可风险较低”，不能使用三个“零”。

若图始终只是固定线性五段，普通 `<ol>`/CSS/SVG + Drawer 甚至比 React Flow 更小；出现分支、子流、缩放和运行路径高亮后，React Flow 的价值才明显。

### 19. 2–3 人周估算：⚠️

报告自己的分项：

- 核心后台：9–13 人日；
- viewer：5–7 人日；
- 合计：14–20 人日；
- eval 集成另计。

按一人周 5 个工作日，这是 2.8–4.0 人周，不是 2–3 人周。

合理口径：

- Happy-path 演示版，且 DTO、鉴权、trace API、现成后台组件都已存在：2–3 日历周可以；
- 复用现有项目配置治理设施的生产 v1：约 3–5 人周；
- 若 Langfuse、eval、trace/redaction API 尚未就位：按 4–6 人周更可靠。

这是工程估算，不是可验证事实；但原报告至少存在明确算术不一致。

### 20. `harness_config` 完整性：⚠️

方向是对的：不可变版本、活跃指针、Zod 校验、eval 门禁、trace 钉版本、promotion 和回滚，都是正确组件。但草图仍不足以生产落地。

#### 已提及但处理不完整的三个坑

1. 配置漂移

“定期导出 Git”不能解决谁是唯一事实源，也没有防止“eval 测 A、发布 B”的 TOCTOU。必须把 eval 绑定到不可变 artifact hash。

2. 环境差异

只有 `env` 与 promotion 概念，没有处理：

- 各环境模型可用性和额度差异；
- secretRef 映射；
- staging `promptRef.label` 提升到 prod 时的转换；
- schema/code 兼容窗口。

3. 审计

`created_by/created_at/note` 不够。至少还需 actor 类型、批准者、before/after digest、correlation ID、变更理由、eval run/testset/evaluator 版本、代码 build 和追加式发布事件。

#### Zod 草图存在的直接缺陷

- 五段式配置只定义 stage 1、3、4；
- `strategyOrder.nonempty()`只保证数组非空，不能保证存在 `redline_gate`、位于首位或不重复；
- `scoringWeights`允许任意 key、负数、缺项与任意总和；
- 缺 `.strict()`，拼错字段可能被静默剥离；
- `promptRef.label` 是可移动别名，不能保证回滚后仍得到同一个 prompt；
- 模型白名单没有绑定已发布的 model catalog revision；
- `nBest` 未与预算、并发、重试和超时联动。

#### 数据库与发布遗漏

- 没有 workspace/tenant/scope；
- pointer FK 不能保证目标版本属于同 env 且已 published；
- 版本号分配和 pointer 更新没有锁或 expected-head CAS；
- “不可变快照”没有数据库约束；
- 缺 `schemaVersion`、迁移器、config hash；
- 缺 worker cache 失效/outbox；
- run 执行中若 pointer 改变，必须保证所有 stage 仍使用 run 开始时钉住的版本；
- rollback 只在元数据上 O(1)，不能逆转已产生的外部副作用、运行中任务、缓存或代码兼容问题；
- “任何历史 run 可精确复现”也过强：模型版本漂移、随机采样和外部工具状态只能支持“重建输入与执行工件”，不能保证相同输出。

#### 项目已有设施被报告漏掉

当前项目已经有比草图更成熟的基础：

- [admin_config_revisions/heads](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/admin-config/postgres-repository.ts:79)：global/workspace scope、追加修订和历史；
- [apply/rollback](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/admin-config/postgres-repository.ts:163)：事务锁、expected revision CAS、回滚追加新版本；
- [AdminConfigRevision](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/admin-config/foundation-module.ts:17)：actor、reason、correlationId；
- [配置校验与 secret 拒绝](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/admin-config/foundation-module.ts:402)；
- [model catalog 发布 CAS](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/model-supply/postgres-repository.ts:248)；
- [SecretStore](/Users/bin/Desktop/开发/内容无人区/美业内容2/apps/core/src/p1/integrations/secret-store.ts:24)：workspace/provider/version 上下文绑定。

因此正确路线不是另建报告中的两张简化表，而是扩展现有 admin-config/revision：

1. 增加强类型 Harness artifact；
2. 在现有 apply 前增加 candidate → eval → approve → publish；
3. 复用 CAS、workspace scope、审计、secret rejection 与回滚；
4. 新增面向运营的结构化表单；
5. 发布时把 Langfuse label 解析并钉住到不可变 prompt version/content hash。

---

## 总裁定

**总体：成立但需实质修正。**

对四项核心结论的复核：

| 核心结论 | 最终裁定 |
|---|---|
| 自建薄后台作为主线 | **成立，而且现有配置治理代码使该路线更有利**；但应扩展现有 admin-config，不应另造简化版本系统 |
| Flowise/Langflow 排除生产 SaaS 执行后端 | **成立但论据需改写**；Langflow 的 KEV/勒索证据很强，Flowise 不能再写成“一串大规模 KEV” |
| n8n 两条线 | **动摇**；内部运营免费成立，但“所有客户可见功能都要 Embed”被官方 FAQ 直接推翻，应改为四类边界 |
| Windmill 仅作范式 | **作为闭源产品策略合理，但不是许可证必然结论**；纯源码 AGPL 路线可通过遵守 AGPL 使用 |

报告最需要立即修正的五处是：

1. 删除 Flowise“被大规模利用/12k–15k 受害实例”的表达。
2. 把 Langflow CVE-2026-5027 与 33017、55255 分开。
3. 重写 n8n 许可裁定，纳入官方允许的客户可见后台反例。
4. 将 Windmill 的“AGPL 网络传染、两路都必须付费”改成条件化表述。
5. 将“零安全/零许可风险”和“含 viewer 2–3 人周”降级，并改为复用现有配置治理基础设施。

未修改或创建任何文件。