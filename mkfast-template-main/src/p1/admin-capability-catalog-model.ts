/**
 * Capability catalog two-level IA (J3 / D-051 · D-054 · D-048).
 *
 * L1 = operator-facing capability domains (no workspaceId / infra keys).
 * L2 = technical dependency + evidence drilldowns (existing seven admin routes).
 *
 * Pure projection only — shared wiring (routes/sidebar/locales/routeTree)
 * stays for Z2-WIRING batch B.
 */
import {
  CAPABILITY_INVENTORY,
  type CapabilityDomainGroup,
  type CapabilityInventoryDocument,
  type CapabilityInventoryItem,
} from '@meiye/contracts';

import {
  capabilityGroupLabel,
  groupInventoryByDomain,
} from '@/p1/admin-capability-registry-model';

/** L1 domain order fixed by D-054. */
export const CAPABILITY_CATALOG_L1_ORDER = [
  'account_and_commerce',
  'ai_supply_and_generation',
  'task_orchestration',
  'content_and_assets',
  'external_integrations',
  'runtime_and_governance',
] as const satisfies readonly CapabilityDomainGroup[];

export type CapabilityCatalogL1Id = (typeof CAPABILITY_CATALOG_L1_ORDER)[number];

/** Stable ids for the seven existing admin drilldown routes. */
export const ADMIN_DRILLDOWN_PAGE_IDS = [
  'users',
  'plans',
  'redemptions',
  'models',
  'templates',
  'integrations',
  'audit',
] as const;

export type AdminDrilldownPageId = (typeof ADMIN_DRILLDOWN_PAGE_IDS)[number];

/**
 * Operator-language L1 copy: capability / function / user impact.
 * Intentionally omits workspaceId and infra jargon.
 */
export interface CapabilityDomainOperatorCopy {
  domain: CapabilityCatalogL1Id;
  /** Short capability-domain title (operator language). */
  title: string;
  /** What this domain does for the product. */
  functionSummary: string;
  /** How failures affect end users / merchants. */
  userImpact: string;
}

export const DOMAIN_OPERATOR_COPY: Record<
  CapabilityCatalogL1Id,
  CapabilityDomainOperatorCopy
> = {
  account_and_commerce: {
    domain: 'account_and_commerce',
    title: '账号与商业化',
    functionSummary: '登录身份、套餐权益、支付与兑换发放',
    userImpact: '影响注册登录、可用额度、套餐升级与兑换码核销',
  },
  ai_supply_and_generation: {
    domain: 'ai_supply_and_generation',
    title: 'AI 供应与生成',
    functionSummary: '模型供应、路由质量与文案/图片/视频/音频生成',
    userImpact: '影响创作任务能否提交、生成质量与失败重试体验',
  },
  task_orchestration: {
    domain: 'task_orchestration',
    title: '任务编排',
    functionSummary: '任务提交、并发门、恢复与运行指标',
    userImpact: '影响任务排队时长、卡死恢复与进度可见性',
  },
  content_and_assets: {
    domain: 'content_and_assets',
    title: '内容与资产',
    functionSummary: '内容包、模板与画布素材资产',
    userImpact: '影响模板可选性、素材复用与内容包交付',
  },
  external_integrations: {
    domain: 'external_integrations',
    title: '外部集成',
    functionSummary: '飞书/抖音等外部连接与发布移交',
    userImpact: '影响渠道连通、凭据就绪与对外发布移交',
  },
  runtime_and_governance: {
    domain: 'runtime_and_governance',
    title: '运行与治理',
    functionSummary: '数据存储、配置密钥、观测告警与审计证据',
    userImpact: '影响平台稳定性、配置生效、问题追溯与技术移交',
  },
};

/**
 * Seven-page regroup: existing admin routes as L2 evidence drilldowns
 * under capability domains (D-048 / D-051). Health = audit page block.
 */
export interface AdminDrilldownPage {
  pageId: AdminDrilldownPageId;
  /** Absolute admin path (hardcoded until Z2-WIRING batch B). */
  path: string;
  /** Parent L1 domain. */
  domain: CapabilityCatalogL1Id;
  /** Operator-facing page title. */
  title: string;
  /** Operator-facing function of this drilldown. */
  functionSummary: string;
  /** User-facing impact if this surface is degraded. */
  userImpact: string;
  /** Inventory capability ids this page evidences. */
  capabilityIds: string[];
  /** When true, page hosts AdminOperationsHealth (runtime governance). */
  hostsOperationsHealth: boolean;
}

export const ADMIN_DRILLDOWN_PAGES: readonly AdminDrilldownPage[] = [
  {
    pageId: 'users',
    path: '/admin/users',
    domain: 'account_and_commerce',
    title: '用户账号',
    functionSummary: '平台注册账号、角色与账号详情下钻',
    userImpact: '影响登录准入与账号级权益排查',
    capabilityIds: ['account_auth'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'plans',
    path: '/admin/plans',
    domain: 'account_and_commerce',
    title: '套餐权益',
    functionSummary: '套餐定义、额度默认与权益策略',
    userImpact: '影响可用功能包、额度与并发档位',
    capabilityIds: ['entitlements_billing_redemption'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'redemptions',
    path: '/admin/redemptions',
    domain: 'account_and_commerce',
    title: '兑换码',
    functionSummary: '兑换码发放、核销与对账入口',
    userImpact: '影响兑换活动到账与额度补发',
    capabilityIds: ['entitlements_billing_redemption'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'models',
    path: '/admin/models',
    domain: 'ai_supply_and_generation',
    title: '模型供应',
    functionSummary: '模型目录、默认模型与供应执行配置',
    userImpact: '影响生成通道可用性与模型选择',
    capabilityIds: [
      'model_supply_routing_quality',
      'generation_copy',
      'generation_image',
      'generation_video',
      'generation_audio',
    ],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'templates',
    path: '/admin/templates',
    domain: 'content_and_assets',
    title: '模板资产',
    functionSummary: 'ContentPackage 模板目录与发布',
    userImpact: '影响创作可选模板与交付版式',
    capabilityIds: ['content_package_canvas'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'integrations',
    path: '/admin/integrations',
    domain: 'external_integrations',
    title: '渠道集成',
    functionSummary: '外部渠道连通、凭据元数据与工具配置',
    userImpact: '影响飞书/抖音等连接与发布移交',
    capabilityIds: ['channel_tool_integrations'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'audit',
    path: '/admin/audit',
    domain: 'runtime_and_governance',
    title: '审计与运行健康',
    functionSummary: '命令审计、BYOK 证据与运行健康区块',
    userImpact: '影响问题追溯、运行健康可见性与技术移交',
    capabilityIds: [
      'observability_audit',
      'config_secrets',
      'data_storage',
      'job_queue_harness',
    ],
    hostsOperationsHealth: true,
  },
] as const;

/** D-048 banned interaction surface tokens on the daily ops path. */
export const D048_BANNED_OPS_CONTROLS = [
  'code-editor',
  'sql-console',
  'env-editor',
  'raw-json-editor',
  'cli-console',
] as const;

export type D048BannedOpsControl = (typeof D048_BANNED_OPS_CONTROLS)[number];

/** Patterns that must not appear as interactive controls on the ops catalog path. */
export const D048_BANNED_CONTROL_PATTERNS = [
  /data-testid=["']code-editor["']/,
  /data-testid=["']sql-console["']/,
  /data-testid=["']env-editor["']/,
  /data-testid=["']raw-json-editor["']/,
  /data-testid=["']cli-console["']/,
  /data-ops-control=["']code["']/,
  /data-ops-control=["']sql["']/,
  /data-ops-control=["']env["']/,
  /data-ops-control=["']raw-json["']/,
  /data-ops-control=["']cli["']/,
] as const;

export interface CatalogTechnicalDependency {
  id: string;
  /** Technical component label (L2 only — not L1 nav). */
  label: string;
  /** Capability ids that require this dependency. */
  requiredByCapabilityIds: string[];
}

export interface CatalogEvidenceDrilldown {
  pageId: AdminDrilldownPageId;
  path: string;
  title: string;
  functionSummary: string;
  userImpact: string;
  hostsOperationsHealth: boolean;
}

export interface CatalogCapabilityRow {
  id: string;
  name: string;
  purpose: string;
  status: CapabilityInventoryItem['status'];
  owner: string;
  /** Critical technical dependency ids (L2). */
  criticalDependencies: string[];
  drilldownKey: string;
}

export interface CapabilityCatalogL1Section {
  domain: CapabilityCatalogL1Id;
  title: string;
  functionSummary: string;
  userImpact: string;
  capabilities: CatalogCapabilityRow[];
  /** L2 technical dependency projection for this domain. */
  technicalDependencies: CatalogTechnicalDependency[];
  /** L2 evidence drilldowns (existing admin pages under this domain). */
  evidenceDrilldowns: CatalogEvidenceDrilldown[];
}

export interface CapabilityCatalogView {
  revision: string;
  capturedAt: string;
  /** Ordered L1 sections. */
  domains: CapabilityCatalogL1Section[];
  /** Flat seven-page registry for reachability checks. */
  drilldownPages: readonly AdminDrilldownPage[];
  /** Explicit: workspaceId is not an L1 IA key. */
  l1ExcludesWorkspaceId: true;
  /** D-048: daily ops catalog path exposes no banned control surfaces. */
  opsPathBannedControls: readonly D048BannedOpsControl[];
}

/** Known technical dependency labels for L2 projection (static). */
const TECHNICAL_DEPENDENCY_LABELS: Record<string, string> = {
  config_secrets: '配置与密钥引用',
  job_queue_harness: '任务队列 / Harness',
  observability_audit: '观测与审计证据',
  data_storage: '数据与对象存储',
  account_auth: '账号与认证门',
  model_supply_routing_quality: '模型供应路由',
  entitlements_billing_redemption: '权益与额度账本',
  generation_image: '图片生成链路',
};

function dependencyLabel(id: string): string {
  return TECHNICAL_DEPENDENCY_LABELS[id] ?? id;
}

function toCapabilityRow(item: CapabilityInventoryItem): CatalogCapabilityRow {
  return {
    id: item.id,
    name: item.name,
    purpose: item.purpose,
    status: item.status,
    owner: item.owner,
    criticalDependencies: [...item.criticalDependencies],
    drilldownKey: item.drilldownKey,
  };
}

function collectTechnicalDependencies(
  items: CapabilityInventoryItem[]
): CatalogTechnicalDependency[] {
  const map = new Map<string, Set<string>>();
  for (const item of items) {
    for (const depId of item.criticalDependencies) {
      const set = map.get(depId) ?? new Set<string>();
      set.add(item.id);
      map.set(depId, set);
    }
  }
  return [...map.entries()]
    .map(([id, requiredBy]) => ({
      id,
      label: dependencyLabel(id),
      requiredByCapabilityIds: [...requiredBy].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function evidenceDrilldownsForDomain(
  domain: CapabilityCatalogL1Id
): CatalogEvidenceDrilldown[] {
  return ADMIN_DRILLDOWN_PAGES.filter((page) => page.domain === domain).map(
    (page) => ({
      pageId: page.pageId,
      path: page.path,
      title: page.title,
      functionSummary: page.functionSummary,
      userImpact: page.userImpact,
      hostsOperationsHealth: page.hostsOperationsHealth,
    })
  );
}

/**
 * Build the two-level capability catalog projection.
 * L1 = six domains in operator language; L2 = deps + evidence pages.
 */
export function buildCapabilityCatalog(
  inventory: CapabilityInventoryDocument = CAPABILITY_INVENTORY
): CapabilityCatalogView {
  const grouped = groupInventoryByDomain(inventory);
  const byGroup = new Map(
    grouped.map((section) => [section.group, section.items] as const)
  );

  const domains: CapabilityCatalogL1Section[] = CAPABILITY_CATALOG_L1_ORDER.map(
    (domain) => {
      const copy = DOMAIN_OPERATOR_COPY[domain];
      const items = byGroup.get(domain) ?? [];
      return {
        domain,
        title: copy.title,
        functionSummary: copy.functionSummary,
        userImpact: copy.userImpact,
        capabilities: items.map(toCapabilityRow),
        technicalDependencies: collectTechnicalDependencies(items),
        evidenceDrilldowns: evidenceDrilldownsForDomain(domain),
      };
    }
  );

  return {
    revision: inventory.revision,
    capturedAt: inventory.capturedAt,
    domains,
    drilldownPages: ADMIN_DRILLDOWN_PAGES,
    l1ExcludesWorkspaceId: true,
    opsPathBannedControls: D048_BANNED_OPS_CONTROLS,
  };
}

export function getCatalogDomain(
  view: CapabilityCatalogView,
  domain: CapabilityCatalogL1Id
): CapabilityCatalogL1Section | undefined {
  return view.domains.find((section) => section.domain === domain);
}

export function getDrilldownPage(
  pageId: AdminDrilldownPageId
): AdminDrilldownPage | undefined {
  return ADMIN_DRILLDOWN_PAGES.find((page) => page.pageId === pageId);
}

export function getDrilldownPageByPath(
  path: string
): AdminDrilldownPage | undefined {
  return ADMIN_DRILLDOWN_PAGES.find((page) => page.path === path);
}

/** Domain context for a seven-page drilldown route. */
export function getDrilldownDomainContext(pageId: AdminDrilldownPageId): {
  page: AdminDrilldownPage;
  domain: CapabilityDomainOperatorCopy;
} | null {
  const page = getDrilldownPage(pageId);
  if (!page) return null;
  return {
    page,
    domain: DOMAIN_OPERATOR_COPY[page.domain],
  };
}

/**
 * L1 IA keys exposed by the catalog (must not include workspaceId).
 */
export function listL1IaKeys(view: CapabilityCatalogView = buildCapabilityCatalog()): string[] {
  return view.domains.flatMap((section) => [
    section.domain,
    section.title,
    section.functionSummary,
    section.userImpact,
  ]);
}

/** Assert L1 projection never elevates workspaceId into IA. */
export function assertL1ExcludesWorkspaceId(
  view: CapabilityCatalogView = buildCapabilityCatalog()
): string[] {
  const violations: string[] = [];
  if (view.l1ExcludesWorkspaceId !== true) {
    violations.push('l1ExcludesWorkspaceId flag missing');
  }
  for (const key of listL1IaKeys(view)) {
    if (/workspaceId/i.test(key) || /workspace[_-]?id/i.test(key)) {
      violations.push(`L1 IA key contains workspaceId: ${key}`);
    }
  }
  for (const section of view.domains) {
    const blob = [
      section.domain,
      section.title,
      section.functionSummary,
      section.userImpact,
      ...section.capabilities.map((c) => `${c.name} ${c.purpose}`),
      ...section.evidenceDrilldowns.map(
        (d) => `${d.title} ${d.functionSummary} ${d.userImpact}`
      ),
    ].join(' ');
    if (/workspaceId/i.test(blob)) {
      violations.push(`domain ${section.domain} L1 copy mentions workspaceId`);
    }
  }
  return violations;
}

/**
 * Scan rendered ops-path HTML for D-048 banned interactive controls.
 * Returns matching pattern sources (empty = pass).
 */
export function assertOpsPathHasNoD048BannedControls(html: string): string[] {
  const hits: string[] = [];
  for (const pattern of D048_BANNED_CONTROL_PATTERNS) {
    if (pattern.test(html)) {
      hits.push(pattern.source);
    }
  }
  return hits;
}

/**
 * Build redacted technical handoff context for complex fixes (D-048).
 * Never pretends to be a one-click repair.
 */
export function buildRedactedHandoffContext(input: {
  domain: CapabilityCatalogL1Id;
  capabilityId?: string;
  pageId?: AdminDrilldownPageId;
  correlationHints?: string[];
  extra?: Record<string, string>;
}): {
  kind: 'technical_handoff';
  oneClickRepair: false;
  domain: CapabilityCatalogL1Id;
  domainTitle: string;
  capabilityId?: string;
  pageId?: AdminDrilldownPageId;
  pagePath?: string;
  correlationHints: string[];
  redactedContext: Record<string, string>;
} {
  const page = input.pageId ? getDrilldownPage(input.pageId) : undefined;
  const domainCopy = DOMAIN_OPERATOR_COPY[input.domain];
  return {
    kind: 'technical_handoff',
    oneClickRepair: false,
    domain: input.domain,
    domainTitle: domainCopy.title,
    capabilityId: input.capabilityId,
    pageId: input.pageId,
    pagePath: page?.path,
    correlationHints: [
      input.domain,
      ...(input.capabilityId ? [input.capabilityId] : []),
      ...(input.pageId ? [input.pageId] : []),
      ...(input.correlationHints ?? []),
    ],
    redactedContext: {
      domain: input.domain,
      domainTitle: domainCopy.title,
      userImpact: domainCopy.userImpact,
      ...(input.capabilityId ? { capabilityId: input.capabilityId } : {}),
      ...(page
        ? {
            drilldownPage: page.pageId,
            drilldownPath: page.path,
          }
        : {}),
      ...(input.extra ?? {}),
      note: 'Complex fix requires technical handoff; not a one-click repair.',
    },
  };
}

/** Reachability map: every pageId → path under a domain. */
export function listDrilldownReachability(): Array<{
  pageId: AdminDrilldownPageId;
  path: string;
  domain: CapabilityCatalogL1Id;
  hostsOperationsHealth: boolean;
}> {
  return ADMIN_DRILLDOWN_PAGES.map((page) => ({
    pageId: page.pageId,
    path: page.path,
    domain: page.domain,
    hostsOperationsHealth: page.hostsOperationsHealth,
  }));
}

export function domainLabel(domain: CapabilityCatalogL1Id): string {
  return DOMAIN_OPERATOR_COPY[domain]?.title ?? capabilityGroupLabel(domain);
}
