/**
 * Capability catalog two-level IA (J3 / D-051 · D-054 · D-048).
 *
 * L1 = operator-facing capability domains (no workspaceId / infra keys).
 * L2 = technical dependency + evidence drilldowns (admin routes).
 *
 * Pure projection only — shared wiring (routes/sidebar/locales/routeTree)
 * stays for Z2-WIRING batch B.
 */
import type {
  CapabilityDomainGroup,
  CapabilityInventoryDocument,
  CapabilityInventoryItem,
} from '@meiye/contracts';
import { CAPABILITY_INVENTORY } from '@/p1/capability-inventory';

import {
  capabilityGroupLabel,
  groupInventoryByDomain,
} from '@/p1/admin-capability-registry-model';
import {
  admin_capability_account_auth_gate_19ff97e7,
  admin_capability_accounts_commercialization_dbc927f4,
  admin_capability_affects_available_feature_packs_quotas_a_6c38630d,
  admin_capability_affects_campaign_credit_arrival_and_quot_b8583e74,
  admin_capability_affects_channel_connectivity_credential_c4b9940f,
  admin_capability_affects_edge_config_deploy_visibility_an_43c702d3,
  admin_capability_affects_feishu_douyin_connectivity_and_p_d3b3ea7b,
  admin_capability_affects_first_screen_exception_visibilit_18d13d9e,
  admin_capability_affects_generation_channel_availability_cf57d6b6,
  admin_capability_affects_incident_tracing_runtime_health_cf3903c6,
  admin_capability_affects_login_admission_and_account_leve_2cb2b49c,
  admin_capability_affects_ops_locating_capabilities_by_dom_9f5001b3,
  admin_capability_affects_platform_stability_config_effect_b43ab9fc,
  admin_capability_affects_queue_wait_stuck_recovery_and_pr_24ac8db1,
  admin_capability_affects_selectable_creation_templates_an_9e67826c,
  admin_capability_affects_sign_up_login_available_quota_pl_91ffc4e9,
  admin_capability_affects_supply_incident_triage_task_reco_cd52c11d,
  admin_capability_affects_template_choices_material_reuse_6e5f958b,
  admin_capability_affects_whether_creation_tasks_can_submi_5f0b8154,
  admin_capability_affects_whether_ops_can_define_accept_bi_46993d0d,
  admin_capability_ai_supply_generation_2bada48a,
  admin_capability_audit_runtime_health_d6688ca0,
  admin_capability_capability_catalog_a4ed742e,
  admin_capability_catalog_of_scenario_recipes_and_industry_a8c03ed2,
  admin_capability_channel_integrations_29c2f778,
  admin_capability_cloudflare_technical_desk_0deb83a7,
  admin_capability_command_audit_byok_evidence_and_runtime_055e6a3b,
  admin_capability_config_secret_references_b3364653,
  admin_capability_content_assets_5ae72969,
  admin_capability_content_packages_templates_and_canvas_ma_84487289,
  admin_capability_contentpackage_template_catalog_and_publ_4c8babf8,
  admin_capability_data_object_storage_a4ba234c,
  admin_capability_data_storage_config_secrets_observabilit_f027ac08,
  admin_capability_edge_workers_technical_surface_and_ops_d_2c82626f,
  admin_capability_entitlement_quota_ledger_9b3483f0,
  admin_capability_exception_home_73bdde91,
  admin_capability_external_channel_connectivity_credential_bcbcc158,
  admin_capability_external_integrations_3cc02b73,
  admin_capability_feishu_douyin_and_other_external_connect_d5deb074,
  admin_capability_image_generation_path_4e692dcf,
  admin_capability_login_identity_plan_entitlements_payment_7a292c73,
  admin_capability_model_assets_pricing_4648036f,
  admin_capability_model_catalog_defaults_and_supply_execut_99b8f521,
  admin_capability_model_supply_routing_070def57,
  admin_capability_model_supply_routing_quality_and_copy_im_49a57fa6,
  admin_capability_observability_audit_evidence_ce3e2cd6,
  admin_capability_plan_definitions_default_quotas_and_enti_7dd5db83,
  admin_capability_plan_entitlements_644ef7d1,
  admin_capability_platform_registered_accounts_roles_and_a_42b92bee,
  admin_capability_read_only_exception_first_list_and_ops_v_946ade68,
  admin_capability_redemption_codes_7ebc000c,
  admin_capability_redemption_issue_redeem_and_reconciliati_2fc2c5c8,
  admin_capability_runtime_governance_f7712550,
  admin_capability_six_domain_capability_inventory_evidence_5692d605,
  admin_capability_skill_catalog_e4646dec,
  admin_capability_supply_ops_console_ba739a80,
  admin_capability_supply_run_table_task_drill_down_and_ass_a503513d,
  admin_capability_task_orchestration_7b4c7f16,
  admin_capability_task_queue_harness_482c7281,
  admin_capability_task_submit_concurrency_gates_recovery_a_dbb6e393,
  admin_capability_template_assets_ff05f473,
  admin_capability_user_accounts_591990d5,
} from '@/locale/paraglide/messages';

/** L1 domain order fixed by D-054. */
export const CAPABILITY_CATALOG_L1_ORDER = [
  'account_and_commerce',
  'ai_supply_and_generation',
  'task_orchestration',
  'content_and_assets',
  'external_integrations',
  'runtime_and_governance',
] as const satisfies readonly CapabilityDomainGroup[];

export type CapabilityCatalogL1Id =
  (typeof CAPABILITY_CATALOG_L1_ORDER)[number];

/**
 * Stable ids for admin drilldown routes (six-domain IA).
 * Spec G / #390: cover supply / cloudflare / capabilities / index in addition
 * to the original eight regrouped pages.
 */
export const ADMIN_DRILLDOWN_PAGE_IDS = [
  'users',
  'plans',
  'redemptions',
  'models',
  'templates',
  'integrations',
  'audit',
  'skills',
  'supply',
  'cloudflare',
  'capabilities',
  'index',
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
    title: admin_capability_accounts_commercialization_dbc927f4(),
    functionSummary:
      admin_capability_login_identity_plan_entitlements_payment_7a292c73(),
    userImpact:
      admin_capability_affects_sign_up_login_available_quota_pl_91ffc4e9(),
  },
  ai_supply_and_generation: {
    domain: 'ai_supply_and_generation',
    title: admin_capability_ai_supply_generation_2bada48a(),
    functionSummary:
      admin_capability_model_supply_routing_quality_and_copy_im_49a57fa6(),
    userImpact:
      admin_capability_affects_whether_creation_tasks_can_submi_5f0b8154(),
  },
  task_orchestration: {
    domain: 'task_orchestration',
    title: admin_capability_task_orchestration_7b4c7f16(),
    functionSummary:
      admin_capability_task_submit_concurrency_gates_recovery_a_dbb6e393(),
    userImpact:
      admin_capability_affects_queue_wait_stuck_recovery_and_pr_24ac8db1(),
  },
  content_and_assets: {
    domain: 'content_and_assets',
    title: admin_capability_content_assets_5ae72969(),
    functionSummary:
      admin_capability_content_packages_templates_and_canvas_ma_84487289(),
    userImpact:
      admin_capability_affects_template_choices_material_reuse_6e5f958b(),
  },
  external_integrations: {
    domain: 'external_integrations',
    title: admin_capability_external_integrations_3cc02b73(),
    functionSummary:
      admin_capability_feishu_douyin_and_other_external_connect_d5deb074(),
    userImpact:
      admin_capability_affects_channel_connectivity_credential_c4b9940f(),
  },
  runtime_and_governance: {
    domain: 'runtime_and_governance',
    title: admin_capability_runtime_governance_f7712550(),
    functionSummary:
      admin_capability_data_storage_config_secrets_observabilit_f027ac08(),
    userImpact:
      admin_capability_affects_platform_stability_config_effect_b43ab9fc(),
  },
};

/**
 * Drilldown regroup: admin routes as L2 evidence under capability domains
 * (D-048 / D-051 / Spec G). Health = audit page block only.
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
    title: admin_capability_user_accounts_591990d5(),
    functionSummary:
      admin_capability_platform_registered_accounts_roles_and_a_42b92bee(),
    userImpact:
      admin_capability_affects_login_admission_and_account_leve_2cb2b49c(),
    capabilityIds: ['account_auth'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'plans',
    path: '/admin/plans',
    domain: 'account_and_commerce',
    title: admin_capability_plan_entitlements_644ef7d1(),
    functionSummary:
      admin_capability_plan_definitions_default_quotas_and_enti_7dd5db83(),
    userImpact:
      admin_capability_affects_available_feature_packs_quotas_a_6c38630d(),
    capabilityIds: ['entitlements_billing_redemption'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'redemptions',
    path: '/admin/redemptions',
    domain: 'account_and_commerce',
    title: admin_capability_redemption_codes_7ebc000c(),
    functionSummary:
      admin_capability_redemption_issue_redeem_and_reconciliati_2fc2c5c8(),
    userImpact:
      admin_capability_affects_campaign_credit_arrival_and_quot_b8583e74(),
    capabilityIds: ['entitlements_billing_redemption'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'models',
    path: '/admin/models',
    domain: 'ai_supply_and_generation',
    title: admin_capability_model_assets_pricing_4648036f(),
    functionSummary:
      admin_capability_model_catalog_defaults_and_supply_execut_99b8f521(),
    userImpact:
      admin_capability_affects_generation_channel_availability_cf57d6b6(),
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
    title: admin_capability_template_assets_ff05f473(),
    functionSummary:
      admin_capability_contentpackage_template_catalog_and_publ_4c8babf8(),
    userImpact:
      admin_capability_affects_selectable_creation_templates_an_9e67826c(),
    capabilityIds: ['content_package_canvas'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'integrations',
    path: '/admin/integrations',
    domain: 'external_integrations',
    title: admin_capability_channel_integrations_29c2f778(),
    functionSummary:
      admin_capability_external_channel_connectivity_credential_bcbcc158(),
    userImpact:
      admin_capability_affects_feishu_douyin_connectivity_and_p_d3b3ea7b(),
    capabilityIds: ['channel_tool_integrations'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'audit',
    path: '/admin/audit',
    domain: 'runtime_and_governance',
    title: admin_capability_audit_runtime_health_d6688ca0(),
    functionSummary:
      admin_capability_command_audit_byok_evidence_and_runtime_055e6a3b(),
    userImpact:
      admin_capability_affects_incident_tracing_runtime_health_cf3903c6(),
    capabilityIds: [
      'observability_audit',
      'config_secrets',
      'data_storage',
      'job_queue_harness',
    ],
    hostsOperationsHealth: true,
  },
  {
    pageId: 'skills',
    path: '/admin/skills',
    domain: 'content_and_assets',
    title: admin_capability_skill_catalog_e4646dec(),
    functionSummary:
      admin_capability_catalog_of_scenario_recipes_and_industry_a8c03ed2(),
    userImpact:
      admin_capability_affects_whether_ops_can_define_accept_bi_46993d0d(),
    capabilityIds: ['content_package_canvas'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'supply',
    path: '/admin/supply',
    domain: 'ai_supply_and_generation',
    title: admin_capability_supply_ops_console_ba739a80(),
    functionSummary:
      admin_capability_supply_run_table_task_drill_down_and_ass_a503513d(),
    userImpact:
      admin_capability_affects_supply_incident_triage_task_reco_cd52c11d(),
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
    pageId: 'cloudflare',
    path: '/admin/cloudflare',
    domain: 'runtime_and_governance',
    title: admin_capability_cloudflare_technical_desk_0deb83a7(),
    functionSummary:
      admin_capability_edge_workers_technical_surface_and_ops_d_2c82626f(),
    userImpact:
      admin_capability_affects_edge_config_deploy_visibility_an_43c702d3(),
    capabilityIds: ['data_storage', 'config_secrets'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'capabilities',
    path: '/admin/capabilities',
    domain: 'runtime_and_governance',
    title: admin_capability_capability_catalog_a4ed742e(),
    functionSummary:
      admin_capability_six_domain_capability_inventory_evidence_5692d605(),
    userImpact:
      admin_capability_affects_ops_locating_capabilities_by_dom_9f5001b3(),
    capabilityIds: ['observability_audit', 'config_secrets'],
    hostsOperationsHealth: false,
  },
  {
    pageId: 'index',
    path: '/admin',
    domain: 'runtime_and_governance',
    title: admin_capability_exception_home_73bdde91(),
    functionSummary:
      admin_capability_read_only_exception_first_list_and_ops_v_946ade68(),
    userImpact:
      admin_capability_affects_first_screen_exception_visibilit_18d13d9e(),
    capabilityIds: [
      'observability_audit',
      'job_queue_harness',
      'config_secrets',
    ],
    hostsOperationsHealth: false,
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
  /** Flat drilldown registry for reachability checks. */
  drilldownPages: readonly AdminDrilldownPage[];
  /** Explicit: workspaceId is not an L1 IA key. */
  l1ExcludesWorkspaceId: true;
  /** D-048: daily ops catalog path exposes no banned control surfaces. */
  opsPathBannedControls: readonly D048BannedOpsControl[];
}

/** Known technical dependency labels for L2 projection (static). */
const TECHNICAL_DEPENDENCY_LABELS: Record<string, string> = {
  config_secrets: admin_capability_config_secret_references_b3364653(),
  job_queue_harness: admin_capability_task_queue_harness_482c7281(),
  observability_audit: admin_capability_observability_audit_evidence_ce3e2cd6(),
  data_storage: admin_capability_data_object_storage_a4ba234c(),
  account_auth: admin_capability_account_auth_gate_19ff97e7(),
  model_supply_routing_quality:
    admin_capability_model_supply_routing_070def57(),
  entitlements_billing_redemption:
    admin_capability_entitlement_quota_ledger_9b3483f0(),
  generation_image: admin_capability_image_generation_path_4e692dcf(),
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

/** Domain context for a registered drilldown route. */
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
export function listL1IaKeys(
  view: CapabilityCatalogView = buildCapabilityCatalog()
): string[] {
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
