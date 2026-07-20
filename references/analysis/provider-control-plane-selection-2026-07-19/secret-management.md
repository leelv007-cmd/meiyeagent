# 多渠道供应凭据管理组件比选

> 日期：2026-07-19
> 结论：首轮保留现有 SecretStore 抽象与 AWS Secrets Manager；OpenBao 作为未来云中立自托管候选，Infisical 主要参考管理体验，均不在首轮新增部署。

## Question

D-060 已要求 `CredentialAccount` 使用写入式密钥版本、轮换、测试、激活、排空与撤销。首轮文本/图片/视频双渠道接入时，是否应该用开源 Secret Manager 替换当前实现？

## Local baseline

- Core 已依赖 `@aws-sdk/client-secrets-manager`，同时提供本地 AES-256-GCM 文件 Secret Store；证据：`apps/core/package.json`、`apps/core/src/p1/integrations/secret-store.ts`。
- 当前缺口主要是供应商固定凭据槽、Tuzi/TTS 未统一接入以及运行时不能热装配，不是完全没有加密存储。
- D-060 已把业务层 CredentialAccount 生命周期和底层 Secret Store 分开，因此可先补全统一 broker/binding，未来再替换存储实现。

## Research method

- 先按用户要求用 OpenCLI Google 检索 OpenBao/Infisical；该适配器本次连续返回 `NOT_FOUND`，无法覆盖。
- 随后使用 Web Search fallback，只读取项目官方文档和官方 GitHub 仓库；没有使用第三方评测。

## Comparison

| 候选 | 官方事实 | 与本项目匹配 | 结论 |
| --- | --- | --- | --- |
| 现有 AWS Secrets Manager adapter | 当前代码已接 SDK；无需新增服务集群、解封、数据库或 Redis | 最小改动，可沿用 Cloud credential 与现有 SecretStore interface；业务轮换/排空仍由 Product Core 管理 | **首轮采用** |
| [OpenBao](https://github.com/openbao/openbao) | MPL-2.0；2026-07-14 发布 v2.6.0；支持 KV、动态 Secret/lease/revoke、ACL、审计设备、HA 和 API/SDK。官方文档说明请求/响应先经过审计设备，动态 Secret 带 lease；HA 需要长期运行集群、存储后端与 seal/unseal 方案 | 开源边界清楚、能力完整，适合未来云中立或统一基础设施 Secret 平台；但会新增高敏有状态服务和运维面，且供应商 API Key 多数不能由通用动态引擎自动签发 | **未来条件候选，不进首轮** |
| [Infisical](https://github.com/Infisical/infisical) | 非 `ee/` 代码 MIT，企业目录另行许可；2026-07-17 最新 v0.162.9。官方文档有版本化 Secret、SDK/API、双阶段/单阶段 rotation、self-host；但审计日志与审计流文档明确标为付费，自托管使用需商业许可；最小自托管依赖 PostgreSQL、Redis、encryption/auth secret | UI、轮换重叠期和 machine identity 体验值得参考；若需要成品 Secret 控制台可再评估。但关键审计/治理能力存在商业边界，会与我方不可变审计重复，且增加 PostgreSQL/Redis 服务 | **只参考体验，首轮不采用** |
| Cloudflare Worker Secrets | 适合 Worker 自身部署 Secret，由 Wrangler/Cloudflare 控制面管理 | 不能作为 Node Core 的动态多供应商 CredentialAccount registry，也不适合每次渠道发布动态创建并热切换大量业务 Secret | **仅保留 Worker 运行密钥边界** |

## Why the first release should not add a secret platform

1. 当前首要断点是固定槽位和 HTTP/Worker 重启生效。换 Secret 产品不会自动解决 CredentialAccount、Deployment binding、版本冻结和长任务排空。
2. 新增 OpenBao/Infisical 会同时新增高敏服务的 HA、备份、访问控制、审计、升级、seal/KMS 或数据库/Redis 运维，扩大首轮故障域。
3. 供应商 Key 的生成/撤销通常仍需官方控制面或人工操作；Secret Manager 只能安全保存版本，不能替代 Provider-specific rotation adapter。
4. 现有 SecretStore interface 已提供替换缝，先完成业务合同不会锁死未来迁移。

## Recommended boundary

- P0 继续使用 `CredentialAccount → secretRef/version → SecretStore`，生产默认 AWS Secrets Manager，本地开发使用现有 AES store。
- Product Core 管理 `pending → tested → ready → active → draining → retired/revoked`，Secret Store 只保存不可回显的值与底层版本。
- HTTP/Worker 通过统一 Secret Broker 获取冻结版本，短 TTL 缓存；配置 revision/credential switch 通知失效，不把 secret 注入 Catalog 或前端。
- Cloudflare Worker Secrets 只保存 Worker 自身服务凭据；不能替代渠道注册表。
- 若未来出现云中立、自托管或动态基础设施凭据硬需求，再做 OpenBao spike；验收需覆盖 HA、seal/unseal、审计不可用时行为、Node SDK、轮换排空、备份恢复和 AWS SM 双写迁移。
- Infisical 仅在团队明确愿意采购其自托管企业能力、并且成品 Secret UI 的价值高于第二套审计/权限系统时重新评估。

## Official sources

- [OpenBao repository and MPL-2.0 license](https://github.com/openbao/openbao)
- [OpenBao security model](https://openbao.org/docs/internals/security/)
- [OpenBao leases and revocation](https://openbao.org/docs/concepts/lease/)
- [OpenBao Kubernetes/HA deployment](https://openbao.org/docs/platform/k8s/)
- [Infisical repository and license split](https://github.com/Infisical/infisical)
- [Infisical secrets management](https://infisical.com/docs/documentation/platform/secrets-mgmt/overview)
- [Infisical rotation lifecycle](https://infisical.com/docs/documentation/platform/secret-rotation/overview)
- [Infisical audit-log paid boundary](https://infisical.com/docs/documentation/platform/audit-logs)
- [Infisical self-hosting requirements](https://infisical.com/docs/self-hosting/configuration/envars)
