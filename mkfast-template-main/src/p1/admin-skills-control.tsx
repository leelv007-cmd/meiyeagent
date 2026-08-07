import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/reui/badge';
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  assertReferenceOnlySkillPayload,
  redactSkillCommandResult,
} from '@/p1/admin-skills-contract';
import { commandP1, queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  admin_capability_all_778fc8f9,
  admin_capability_skill_catalog_e4646dec,
  admin_sensitive_words_disable_d989e551,
  admin_skills_accept_and_freeze_62c55e1e,
  admin_skills_admin_cancel_recoverable_379b7eac,
  admin_skills_admin_only_256d9f9a,
  admin_skills_approve_and_continue_f2d98e71,
  admin_skills_assembly_delivery_0a6156e1,
  admin_skills_base_version_ref_d58f0e4f,
  admin_skills_before_retire_load_reverse_dependencies_db0e6004,
  admin_skills_bind_stage_and_rollback_binding_only_swi_849e87d0,
  admin_skills_bind_stage_f5f28c8d,
  admin_skills_binding_being_rolled_back_090d688b,
  admin_skills_binding_id_d9d88c74,
  admin_skills_binding_mode_cd3b4321,
  admin_skills_brief_compile_90d7c5e5,
  admin_skills_business_terminate_irrecoverable_66a07809,
  admin_skills_catalog_read_failed_please_retry_717c437d,
  admin_skills_context_injection_eec79988,
  admin_skills_controlled_practice_body_7353e406,
  admin_skills_controlled_revision_ad2b3dcf,
  admin_skills_controlled_revision_failed_to_start_plea_dfef11e8,
  admin_skills_current_production_prompt_ref_is_not_rea_36b5074a,
  admin_skills_current_production_prompt_ref_unavailabl_892d6852,
  admin_skills_current_prompt_07bd4ba9,
  admin_skills_current_version_46e66f63,
  admin_skills_current_version_must_be_a_positive_integ_01c0ce22,
  admin_skills_current_version_number_31e02486,
  admin_skills_current_version_number_leave_empty_for_f_e4914e80,
  admin_skills_current_version_number_must_be_a_positiv_b06507aa,
  admin_skills_currently_hosts_platform_and_industry_la_21e67a8f,
  admin_skills_dependency_read_failed_retire_stays_bloc_4d091c9f,
  admin_skills_deployment_id_bd91c8a9,
  admin_skills_display_policy_88e66a3f,
  admin_skills_effective_stage_2d94ddf6,
  admin_skills_eval_run_id_c39c4257,
  admin_skills_execution_selection_e8fa9ec7,
  admin_skills_explainable_701f9b47,
  admin_skills_field_required,
  admin_skills_filter_by_layer_de4f93bc,
  admin_skills_global_a5644f4b,
  admin_skills_governance_run_8165d3ab,
  admin_skills_governance_run_id_5f00ef9c,
  admin_skills_governance_run_operation_failed_please_r_ef7a5191,
  admin_skills_governance_workflows_published_catalog_m_161b3621,
  admin_skills_handwritten_19002f60,
  admin_skills_harvest_source_url_harvested_translation_15630f3a,
  admin_skills_harvest_time_iso_8601_harvested_translat_e92c5e86,
  admin_skills_harvested_translation_838ef818,
  admin_skills_immutable_name_source_layer_governance_b_e5a81b71,
  admin_skills_industry_layer_9fad7f92,
  admin_skills_industry_layer_second_source_cross_check_caed8dad,
  admin_skills_intent_naming_72027f84,
  admin_skills_layer_dac36cb8,
  admin_skills_loading_b21b631c,
  admin_skills_loading_f950213a,
  admin_skills_loading_published_workflow_catalog_091eca78,
  admin_skills_merchant_optional_19ea6539,
  admin_skills_merchant_selectable_0ee88adf,
  admin_skills_name_1be7ae4f,
  admin_skills_new_binding_id_ef9fc32e,
  admin_skills_new_practice_3ed9bf79,
  admin_skills_no_dependencies_found_93ae6ed5,
  admin_skills_no_published_recipe_workflows_yet_290f9354,
  admin_skills_no_skills_yet_use_new_practice_below_to_724789ca,
  admin_skills_not_yet_accepted_9e65dd32,
  admin_skills_one_line_description_f960848c,
  admin_skills_only_controlled_practice_body_and_one_li_9d4a8ac0,
  admin_skills_operation_completed_d285ee4a,
  admin_skills_other_workspace_deps_5f81764d,
  admin_skills_peer_skill_id_4afb57a0,
  admin_skills_peer_version_af4bbbbe,
  admin_skills_platform_layer_dbecdefc,
  admin_skills_please_select_382f4b55,
  admin_skills_processing_1cac8ac7,
  admin_skills_provider_62e38921,
  admin_skills_publish_run_id_41466e91,
  admin_skills_published_generation_must_be_a_non_negat_94635ba1,
  admin_skills_published_is_each_skill_s_unique_lifecyc_f734ef29,
  admin_skills_published_switch_failed_please_retry_19e2f54b,
  admin_skills_published_unique_81041b5a,
  admin_skills_published_workflow_catalog_not_ready_can_c00a173a,
  admin_skills_published_workflow_catalog_read_failed_p_9a03a8d7,
  admin_skills_refresh_status_7cc7f07a,
  admin_skills_refreshing_d47379f9,
  admin_skills_register_deployment_3c3afb30,
  admin_skills_required_7800d5bb,
  admin_skills_resume_after_admin_cancel_4bae812b,
  admin_skills_retire_blocked_91eb75f1,
  admin_skills_retire_run_id_2f94a368,
  admin_skills_retire_this_version_20cc3f32,
  admin_skills_retiring_97c3815f,
  admin_skills_reverse_dependencies_remain_this_version_b88675b0,
  admin_skills_reverse_dependencies_retire_ca2bbf94,
  admin_skills_rollback_binding_efc3f534,
  admin_skills_rollback_to_version_a6407e2c,
  admin_skills_run_state_resumes_here_after_start_ce3af0bc,
  admin_skills_select_a_published_workflow_c466f863,
  admin_skills_select_a_valid_skill_id_from_the_current_f94d8342,
  admin_skills_select_a_workflow_version_from_the_publi_4852acd8,
  admin_skills_select_at_least_one_governance_workflow_c7273436,
  admin_skills_skill_bound_workflow_is_unpublished_or_n_8a446a82,
  admin_skills_skill_id_0ba503b6,
  admin_skills_skill_operation_failed_please_retry_25350fdc,
  admin_skills_source_c63f79e6,
  admin_skills_standard_package_name_26c6592b,
  admin_skills_start_revision_run_cdffed85,
  admin_skills_store_layer_d3bcb4a6,
  admin_skills_submit_governed_command_1430e707,
  admin_skills_submitting_17e519c5,
  admin_skills_switch_published_306a0aaf,
  admin_skills_switching_717bbfb3,
  admin_skills_synthesized_19ab899d,
  admin_skills_target_version_ref_ddaa8254,
  admin_skills_this_workspace_ba93d643,
  admin_skills_traffic_targets_new_requests_base_lifecy_66c8a83e,
  admin_skills_updated_at_093dea88,
  admin_skills_version_records_4173c9ea,
  admin_skills_version_records_7c9253ad,
  admin_skills_version_ref_9b17a444,
  admin_skills_version_ref_cannot_be_empty_438f7f5d,
  admin_skills_version_retire_failed_please_retry_7bb0464e,
  admin_skills_view_provenance_84ec1d0a,
  admin_skills_view_reverse_dependencies_073dbd6f,
  admin_skills_view_versions_31140423,
  admin_skills_workflow_not_in_catalog,
  admin_skills_workflow_version_published_catalog_8da8a089,
  admin_supply_action_f3ea6d34,
  admin_supply_channel_c152be9f,
} from '@/locale/paraglide/messages';

/** Operator-facing labels for the source column (a hard catalog requirement). */
const SOURCE_LABELS = {
  harvested: admin_skills_harvested_translation_838ef818(),
  authored: admin_skills_handwritten_19002f60(),
  induced: admin_skills_synthesized_19ab899d(),
} as const;

const TIER_LABELS = {
  platform: admin_skills_platform_layer_dbecdefc(),
  industry: admin_skills_industry_layer_9fad7f92(),
  store: admin_skills_store_layer_d3bcb4a6(),
} as const;

type SourceKind = keyof typeof SOURCE_LABELS;
type Tier = keyof typeof TIER_LABELS;

export interface SkillCatalogRow {
  skillId: string;
  name: string;
  description: string;
  sourceKind: SourceKind;
  sourceRef?: {
    externalUrl?: string;
    harvestedAt?: string;
  } | null;
  tier: Tier;
  presentationPolicy: string;
  activeRevisionRef: string | null;
  publicationGeneration: number;
  updatedAt: string;
}

interface SkillCatalogPage {
  items: SkillCatalogRow[];
  stats: {
    total: number;
    industryTierTotal: number;
    industryTierCorroborated: number;
  };
}

interface CurrentSkillPromptReference {
  contentHash: string;
  eligibleForAcceptance: boolean;
  isFallback: boolean;
  label: string;
  name: string;
  reasonCode?: string;
  source: 'langfuse' | 'builtin';
  version: string;
}

interface SkillCommandAuthorities {
  promptReference?: CurrentSkillPromptReference;
  /**
   * #360 published Recipe workflow catalog — sole client source for define/bind
   * workflow options (Spec B / #362). Never hardcode a Web-only allowlist.
   */
  publishedWorkflowRevisionRefs?: readonly string[];
}

/** Stable Core INVALID_STATE message for bind boundary (Spec B / #362). */
export const SKILL_WORKFLOW_BINDING_INVALID_MESSAGE =
  admin_skills_skill_bound_workflow_is_unpublished_or_n_8a446a82();

interface SkillGovernanceFormValues {
  baseSkillRevisionRef: string;
  description: string;
  expectedHeadRevision: string;
  instruction: string;
  runId: string;
}

interface SkillPublishFormValues {
  expectedPublicationGeneration: string;
  expectedPublishedRevisionRef: string;
  runId: string;
  skillId: string;
  targetSkillRevisionRef: string;
}

interface SkillReverseDependency {
  consumerId: string;
  consumerKind: string;
  consumerLabel: string;
  scopeKind: 'global' | 'workspace';
}

interface SkillReverseDependencyResult {
  blocked: boolean;
  hiddenCount: number;
  targetSkillRevisionRef: string;
  visibleDependencies: SkillReverseDependency[];
}

interface SkillGovernanceRunState {
  runId: string;
  state?: {
    result?: SkillGovernanceResult | null;
    status: string;
  } | null;
  run?: {
    result: SkillGovernanceResult;
    status: string;
  } | null;
  status?: string;
  workflowStatus?: string | null;
}

interface SkillGovernanceResult {
  applied: boolean;
  success: boolean;
  validationResults: Array<{
    fieldPath: string;
    reasonCode: string;
    status: string;
  }>;
}

type FieldKind =
  | 'text'
  | 'select'
  | 'textarea'
  /** Single pick from #360 published workflow catalog (bind). */
  | 'workflow_select'
  /** Multi pick from #360 published workflow catalog (define governance). */
  | 'workflow_multi';

interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  options?: readonly { value: string; label: string }[];
  placeholder?: string;
}

/**
 * Every command is a labelled form rather than a JSON box: a raw JSON editor
 * is a banned ops control, and an operator should not have to hand-assemble a
 * payload to publish a Skill.
 */
const COMMAND_FORMS = {
  skill_define: {
    label: admin_skills_new_practice_3ed9bf79(),
    fields: [
      { key: 'skillId', label: admin_skills_skill_id_0ba503b6(), kind: 'text' },
      { key: 'name', label: admin_skills_name_1be7ae4f(), kind: 'text' },
      {
        key: 'packageName',
        label: admin_skills_standard_package_name_26c6592b(),
        kind: 'text',
      },
      {
        key: 'description',
        label: admin_skills_one_line_description_f960848c(),
        kind: 'text',
      },
      {
        key: 'instruction',
        label: admin_skills_controlled_practice_body_7353e406(),
        kind: 'textarea',
      },
      {
        key: 'workflowRevisionRefs',
        label: admin_skills_governance_workflows_published_catalog_m_161b3621(),
        kind: 'workflow_multi',
      },
      {
        key: 'expectedRevision',
        label: admin_skills_current_version_number_leave_empty_for_f_e4914e80(),
        kind: 'text',
      },
      {
        key: 'sourceKind',
        label: admin_skills_source_c63f79e6(),
        kind: 'select',
        options: [
          {
            value: 'harvested',
            label: admin_skills_harvested_translation_838ef818(),
          },
          { value: 'authored', label: admin_skills_handwritten_19002f60() },
          { value: 'induced', label: admin_skills_synthesized_19ab899d() },
        ],
      },
      {
        key: 'tier',
        label: admin_skills_layer_dac36cb8(),
        kind: 'select',
        options: [
          { value: 'platform', label: admin_skills_platform_layer_dbecdefc() },
          { value: 'industry', label: admin_skills_industry_layer_9fad7f92() },
        ],
      },
      {
        key: 'sourceExternalUrl',
        label: admin_skills_harvest_source_url_harvested_translation_15630f3a(),
        kind: 'text',
      },
      {
        key: 'sourceHarvestedAt',
        label: admin_skills_harvest_time_iso_8601_harvested_translat_e92c5e86(),
        kind: 'text',
      },
      {
        key: 'presentationPolicy',
        label: admin_skills_display_policy_88e66a3f(),
        kind: 'select',
        options: [
          { value: 'backend_only', label: admin_skills_admin_only_256d9f9a() },
          { value: 'explainable', label: admin_skills_explainable_701f9b47() },
          {
            value: 'user_selectable',
            label: admin_skills_merchant_selectable_0ee88adf(),
          },
        ],
      },
    ],
  },
  skill_accept: {
    label: admin_skills_accept_and_freeze_62c55e1e(),
    fields: [
      {
        key: 'skillRevisionRef',
        label: admin_skills_version_ref_9b17a444(),
        kind: 'text',
      },
      {
        key: 'evalRunId',
        label: admin_skills_eval_run_id_c39c4257(),
        kind: 'text',
      },
    ],
  },
  skill_bind: {
    label: admin_skills_bind_stage_f5f28c8d(),
    fields: [
      {
        key: 'bindingId',
        label: admin_skills_binding_id_d9d88c74(),
        kind: 'text',
      },
      {
        key: 'workflowRevisionRef',
        label: admin_skills_workflow_version_published_catalog_8da8a089(),
        kind: 'workflow_select',
      },
      {
        key: 'skillRevisionRef',
        label: admin_skills_version_ref_9b17a444(),
        kind: 'text',
      },
      {
        key: 'harnessStage',
        label: admin_skills_effective_stage_2d94ddf6(),
        kind: 'select',
        options: [
          {
            value: 'intent_naming',
            label: admin_skills_intent_naming_72027f84(),
          },
          {
            value: 'context_injection',
            label: admin_skills_context_injection_eec79988(),
          },
          {
            value: 'brief_compilation',
            label: admin_skills_brief_compile_90d7c5e5(),
          },
          {
            value: 'execution_selection',
            label: admin_skills_execution_selection_e8fa9ec7(),
          },
          {
            value: 'assembly_delivery',
            label: admin_skills_assembly_delivery_0a6156e1(),
          },
        ],
      },
      {
        key: 'mode',
        label: admin_skills_binding_mode_cd3b4321(),
        kind: 'select',
        options: [
          { value: 'required', label: admin_skills_required_7800d5bb() },
          {
            value: 'user_selected',
            label: admin_skills_merchant_optional_19ea6539(),
          },
          {
            value: 'disabled',
            label: admin_sensitive_words_disable_d989e551(),
          },
        ],
      },
    ],
  },
  skill_rollback: {
    label: admin_skills_rollback_binding_efc3f534(),
    fields: [
      {
        key: 'bindingId',
        label: admin_skills_new_binding_id_ef9fc32e(),
        kind: 'text',
      },
      {
        key: 'sourceBindingId',
        label: admin_skills_binding_being_rolled_back_090d688b(),
        kind: 'text',
      },
      {
        key: 'targetSkillRevisionRef',
        label: admin_skills_rollback_to_version_a6407e2c(),
        kind: 'text',
      },
      {
        key: 'workflowRevisionRef',
        label: admin_skills_workflow_version_published_catalog_8da8a089(),
        kind: 'workflow_select',
      },
    ],
  },
  skill_deployment: {
    label: admin_skills_register_deployment_3c3afb30(),
    fields: [
      {
        key: 'deploymentId',
        label: admin_skills_deployment_id_bd91c8a9(),
        kind: 'text',
      },
      {
        key: 'skillRevisionRef',
        label: admin_skills_version_ref_9b17a444(),
        kind: 'text',
      },
      {
        key: 'provider',
        label: admin_skills_provider_62e38921(),
        kind: 'text',
      },
      { key: 'channel', label: admin_supply_channel_c152be9f(), kind: 'text' },
      {
        key: 'nativeSkillId',
        label: admin_skills_peer_skill_id_4afb57a0(),
        kind: 'text',
      },
      {
        key: 'nativeVersion',
        label: admin_skills_peer_version_af4bbbbe(),
        kind: 'text',
      },
    ],
  },
} as const satisfies Record<
  string,
  { label: string; fields: readonly FieldSpec[] }
>;

type SkillAction = keyof typeof COMMAND_FORMS;

const ACTION_ORDER = [
  'skill_define',
  'skill_accept',
  'skill_bind',
  'skill_rollback',
  'skill_deployment',
] as const satisfies readonly SkillAction[];

const GOVERNANCE_RUN_ACTIONS = [
  'skill_governance_approve',
  'skill_governance_business_cancel',
  'skill_governance_cancel',
  'skill_governance_resume',
] as const;

type GovernanceRunAction = (typeof GOVERNANCE_RUN_ACTIONS)[number];
type GovernanceIntentAction = GovernanceRunAction | 'skill_governance_start';

export function createGovernanceActionIntentRegistry(
  createIdempotencyKey: () => string = () => crypto.randomUUID()
) {
  const pendingKeys = new Map<string, string>();
  return {
    async execute<T>(
      runAction: GovernanceIntentAction,
      runId: string,
      submit: (idempotencyKey: string) => Promise<T>
    ) {
      const fingerprint = `${runAction}:${runId}`;
      const idempotencyKey =
        pendingKeys.get(fingerprint) ??
        `${runAction}:${createIdempotencyKey()}`;
      pendingKeys.set(fingerprint, idempotencyKey);
      const result = await submit(idempotencyKey);
      if (pendingKeys.get(fingerprint) === idempotencyKey) {
        pendingKeys.delete(fingerprint);
      }
      return result;
    },
  };
}

const ADMIN_SKILL_GOVERNANCE_BASE = {
  budget: {
    maxChildEffects: 0,
    maxCostCents: 0,
    timeoutMs: 10_000,
  },
  contextScopes: [],
  executionMode: 'prompt_materialized',
  fallback: 'fail_closed',
  inputSchemaRef: 'skill-input.daily-industry@1',
  outputSchemaRef: 'skill-output.intent-decision@1',
  requiredModelCapabilities: ['structured_output'],
  sideEffectClass: 'none',
} as const;

/** Parse multi-select workflow refs stored as newline- or comma-separated text. */
export function parseSelectedWorkflowRevisionRefs(
  raw: string | undefined
): string[] {
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(/[\n,]/u)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
    ),
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Maps Core bind boundary failures onto the bind form without clearing input.
 * Server is authority; this only normalizes the stable Spec B message.
 */
export function mapSkillBindFormError(message: string): string {
  if (message.includes(SKILL_WORKFLOW_BINDING_INVALID_MESSAGE)) {
    return SKILL_WORKFLOW_BINDING_INVALID_MESSAGE;
  }
  return message;
}

/**
 * Assembles the nested command payload from flat form values. Shapes the
 * caller should not have to know (trigger conditions, execution mode) are
 * derived here rather than typed by hand.
 */
export function buildSkillCommandPayload(
  action: SkillAction,
  values: Record<string, string>,
  authorities: SkillCommandAuthorities = {}
): Record<string, unknown> {
  if (action === 'skill_define') {
    const promptReference = authorities.promptReference;
    if (!promptReference?.eligibleForAcceptance) {
      throw new Error(
        admin_skills_current_production_prompt_ref_is_not_rea_36b5074a()
      );
    }
    const expectedRevision = values.expectedRevision?.trim();
    if (
      expectedRevision &&
      (!/^\d+$/u.test(expectedRevision) || Number(expectedRevision) < 1)
    ) {
      throw new Error(
        admin_skills_current_version_must_be_a_positive_integ_01c0ce22()
      );
    }
    const published = authorities.publishedWorkflowRevisionRefs ?? [];
    if (published.length === 0) {
      throw new Error(
        admin_skills_published_workflow_catalog_not_ready_can_c00a173a()
      );
    }
    const workflowRevisionRefs = parseSelectedWorkflowRevisionRefs(
      values.workflowRevisionRefs
    );
    if (workflowRevisionRefs.length === 0) {
      throw new Error(
        admin_skills_select_at_least_one_governance_workflow_c7273436()
      );
    }
    const publishedSet = new Set(published);
    for (const ref of workflowRevisionRefs) {
      if (!publishedSet.has(ref)) {
        throw new Error(admin_skills_workflow_not_in_catalog({ ref }));
      }
    }
    return {
      description: values.description,
      expectedRevision: expectedRevision ? Number(expectedRevision) : null,
      frontmatter: {
        description: values.description,
        name: values.packageName,
      },
      governance: {
        ...ADMIN_SKILL_GOVERNANCE_BASE,
        workflowRevisionRefs,
      },
      instruction: values.instruction,
      name: values.name,
      packagePaths: ['SKILL.md'],
      presentationPolicy: values.presentationPolicy,
      promptReference: {
        contentHash: promptReference.contentHash,
        name: promptReference.name,
        version: promptReference.version,
      },
      skillId: values.skillId,
      sourceKind: values.sourceKind,
      ...(values.sourceKind === 'harvested'
        ? {
            sourceRef: {
              externalUrl: values.sourceExternalUrl,
              harvestedAt: values.sourceHarvestedAt,
            },
          }
        : {}),
      tier: values.tier,
    };
  }
  if (action === 'skill_accept') {
    return {
      evalRunId: values.evalRunId,
      skillRevisionRef: values.skillRevisionRef,
    };
  }
  if (action === 'skill_bind') {
    const workflowRevisionRef = values.workflowRevisionRef?.trim() ?? '';
    if (!workflowRevisionRef) {
      throw new Error(
        admin_skills_select_a_workflow_version_from_the_publi_4852acd8()
      );
    }
    const published = authorities.publishedWorkflowRevisionRefs;
    if (published && !published.includes(workflowRevisionRef)) {
      throw new Error(SKILL_WORKFLOW_BINDING_INVALID_MESSAGE);
    }
    return {
      bindingId: values.bindingId,
      workflowRevisionRef,
      skillRevisionRef: values.skillRevisionRef,
      mode: values.mode,
      triggerCondition: {
        harnessStage: values.harnessStage,
        industryCategory: null,
        tenantId: null,
      },
    };
  }
  if (action === 'skill_deployment') {
    return {
      ...values,
      // Only prompt-materialised first deployments clear the gate without an
      // experimental waiver, so that is what this surface offers.
      executionMode: 'prompt_materialized',
      packagePaths: ['SKILL.md'],
    };
  }
  return { ...values };
}

export function buildSkillGovernanceStartPayload(
  values: SkillGovernanceFormValues
) {
  const expectedHeadRevision = Number(values.expectedHeadRevision);
  if (!Number.isInteger(expectedHeadRevision) || expectedHeadRevision < 1) {
    throw new Error(
      admin_skills_current_version_number_must_be_a_positiv_b06507aa()
    );
  }
  return {
    baseSkillRevisionRef: requiredFormValue(
      values.baseSkillRevisionRef,
      admin_skills_base_version_ref_d58f0e4f()
    ),
    expectedHeadRevision,
    patch: {
      instruction: requiredFormValue(
        values.instruction,
        admin_skills_controlled_practice_body_7353e406()
      ),
      'manifest.description': requiredFormValue(
        values.description,
        admin_skills_one_line_description_f960848c()
      ),
    },
    runId: requiredFormValue(
      values.runId,
      admin_skills_governance_run_id_5f00ef9c()
    ),
  };
}

export function buildSkillPublishPayload(values: SkillPublishFormValues) {
  const expectedPublicationGeneration = Number(
    values.expectedPublicationGeneration
  );
  if (
    !Number.isInteger(expectedPublicationGeneration) ||
    expectedPublicationGeneration < 0
  ) {
    throw new Error(
      admin_skills_published_generation_must_be_a_non_negat_94635ba1()
    );
  }
  return {
    expectedPublicationGeneration,
    expectedPublishedRevisionRef:
      values.expectedPublishedRevisionRef.trim() || null,
    runId: requiredFormValue(
      values.runId,
      admin_skills_publish_run_id_41466e91()
    ),
    skillId: requiredFormValue(
      values.skillId,
      admin_skills_skill_id_0ba503b6()
    ),
    targetSkillRevisionRef: requiredFormValue(
      values.targetSkillRevisionRef,
      admin_skills_target_version_ref_ddaa8254()
    ),
  };
}

function requiredFormValue(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(admin_skills_field_required({ label }));
  return normalized;
}

function governanceWorkflowStatus(run: SkillGovernanceRunState | undefined) {
  return run?.workflowStatus?.toLowerCase();
}

function governanceRunStatus(run: SkillGovernanceRunState | undefined) {
  const workflowStatus = run?.workflowStatus?.toLowerCase();
  if (workflowStatus === 'cancelled' || workflowStatus === 'canceled') {
    return 'administrative_cancelled';
  }
  if (
    workflowStatus === 'error' ||
    workflowStatus === 'max_recovery_attempts_exceeded'
  ) {
    return 'failed';
  }
  const stateStatus = run?.state?.status ?? run?.run?.status ?? run?.status;
  if (stateStatus === 'cancelled' || stateStatus === 'canceled') {
    return 'business_cancelled';
  }
  return stateStatus ?? workflowStatus ?? undefined;
}

const GOVERNANCE_RUN_TERMINAL_STATUSES = [
  'administrative_cancelled',
  'business_cancelled',
  'completed',
  'failed',
];

/**
 * Poll a governance run until it reaches a terminal status.
 *
 * An unknown status keeps polling on purpose. Every run action is disabled
 * while the status is unreadable, so a read that was aborted or failed would
 * otherwise strand the panel: no poll to recover it, and no enabled control to
 * act on. Only a terminal run has nothing left to observe.
 */
export function governanceRunPollInterval(
  run: SkillGovernanceRunState | undefined
) {
  const status = governanceRunStatus(run);
  return status && GOVERNANCE_RUN_TERMINAL_STATUSES.includes(status)
    ? false
    : 2_000;
}

function governanceRunStatusLabel(status: string | undefined) {
  if (status === 'administrative_cancelled') {
    return admin_skills_admin_cancel_recoverable_379b7eac();
  }
  if (status === 'business_cancelled') {
    return admin_skills_business_terminate_irrecoverable_66a07809();
  }
  return status;
}

function governanceRunResult(run: SkillGovernanceRunState | undefined) {
  return run?.state?.result ?? run?.run?.result ?? null;
}

function GovernanceResultView({ result }: { result: SkillGovernanceResult }) {
  return (
    <div className="space-y-2 text-sm" data-testid="skill-governance-result">
      <p>
        success={String(result.success)}
        {' · '}applied={String(result.applied)}
      </p>
      {result.validationResults.length > 0 ? (
        <ul className="space-y-1 text-muted-foreground">
          {result.validationResults.map((validation) => (
            <li key={`${validation.fieldPath}:${validation.reasonCode}`}>
              {validation.fieldPath} · {validation.reasonCode} ·{' '}
              {validation.status}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AdminSkillsControl() {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<SkillAction>('skill_define');
  const [values, setValues] = useState<Record<string, string>>({});
  const [tierFilter, setTierFilter] = useState('');
  const [historySkillId, setHistorySkillId] = useState('');
  const [governanceValues, setGovernanceValues] =
    useState<SkillGovernanceFormValues>({
      baseSkillRevisionRef: '',
      description: '',
      expectedHeadRevision: '',
      instruction: '',
      runId: '',
    });
  const [governanceRunId, setGovernanceRunId] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : (window.localStorage.getItem('admin-skill-governance-run-id') ?? '')
  );
  const [governanceError, setGovernanceError] = useState('');
  const [governanceBusy, setGovernanceBusy] = useState(false);
  const [governanceActionIntents] = useState(() =>
    createGovernanceActionIntentRegistry()
  );
  const [publishValues, setPublishValues] = useState<SkillPublishFormValues>({
    expectedPublicationGeneration: '',
    expectedPublishedRevisionRef: '',
    runId: '',
    skillId: '',
    targetSkillRevisionRef: '',
  });
  const [publishError, setPublishError] = useState('');
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishResult, setPublishResult] =
    useState<SkillGovernanceResult | null>(null);
  const [dependencyInput, setDependencyInput] = useState('');
  const [dependencyTarget, setDependencyTarget] = useState('');
  const [retireRunId, setRetireRunId] = useState('');
  const [retireError, setRetireError] = useState('');
  const [retireBusy, setRetireBusy] = useState(false);
  const [retireResult, setRetireResult] =
    useState<SkillGovernanceResult | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!governanceRunId) {
      window.localStorage.removeItem('admin-skill-governance-run-id');
      return;
    }
    window.localStorage.setItem(
      'admin-skill-governance-run-id',
      governanceRunId
    );
  }, [governanceRunId]);

  const catalogQuery = useQuery({
    queryKey: p1QueryKeys.request('skills', 'skill_catalog_list', {
      tier: tierFilter,
    }),
    queryFn: ({ signal }) =>
      queryP1<SkillCatalogPage>(
        'skills',
        {
          action: 'skill_catalog_list',
          payload: tierFilter ? { tier: tierFilter } : {},
        },
        signal
      ),
  });
  const historyQuery = useQuery({
    enabled: Boolean(historySkillId),
    queryKey: p1QueryKeys.request('skills', 'skill_revision_history', {
      skillId: historySkillId,
    }),
    queryFn: ({ signal }) =>
      queryP1<
        Array<{
          skillRevisionRef: string;
          status: string;
          createdAt: string;
        }>
      >(
        'skills',
        {
          action: 'skill_revision_history',
          payload: { skillId: historySkillId },
        },
        signal
      ),
  });
  const promptReferenceQuery = useQuery({
    queryKey: p1QueryKeys.request('skills', 'skill_prompt_reference', {
      slot: 'intentNaming',
    }),
    queryFn: ({ signal }) =>
      queryP1<CurrentSkillPromptReference>(
        'skills',
        {
          action: 'skill_prompt_reference',
          payload: { slot: 'intentNaming' },
        },
        signal
      ),
  });
  // #360 catalog via skills query — bind dropdown and define multi-select share
  // this list with server-side validation (Spec B / #362).
  const publishedWorkflowQuery = useQuery({
    queryKey: p1QueryKeys.request(
      'skills',
      'published_recipe_workflow_revision_refs',
      {}
    ),
    queryFn: ({ signal }) =>
      queryP1<{ workflowRevisionRefs: string[] }>(
        'skills',
        {
          action: 'published_recipe_workflow_revision_refs',
          payload: {},
        },
        signal
      ),
  });
  const publishedWorkflowRevisionRefs =
    publishedWorkflowQuery.data?.workflowRevisionRefs ?? [];
  const governanceRunQuery = useQuery({
    enabled: Boolean(governanceRunId),
    queryKey: p1QueryKeys.request('skills', 'skill_governance_run_get', {
      runId: governanceRunId,
    }),
    queryFn: ({ signal }) =>
      queryP1<SkillGovernanceRunState>(
        'skills',
        {
          action: 'skill_governance_run_get',
          payload: { runId: governanceRunId },
        },
        signal
      ),
    refetchInterval: (query) => governanceRunPollInterval(query.state.data),
  });
  const dependencyQuery = useQuery({
    enabled: Boolean(dependencyTarget),
    queryKey: p1QueryKeys.request('skills', 'skill_reverse_dependencies', {
      skillRevisionRef: dependencyTarget,
    }),
    queryFn: ({ signal }) =>
      queryP1<SkillReverseDependencyResult>(
        'skills',
        {
          action: 'skill_reverse_dependencies',
          payload: { skillRevisionRef: dependencyTarget },
        },
        signal
      ),
  });
  const form = COMMAND_FORMS[action];
  const authorityUnavailable =
    !promptReferenceQuery.data?.eligibleForAcceptance;

  const submit = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const payload = buildSkillCommandPayload(action, values, {
        promptReference: promptReferenceQuery.data,
        publishedWorkflowRevisionRefs,
      });
      assertReferenceOnlySkillPayload(payload);
      setResult(
        redactSkillCommandResult(
          await commandP1(
            'skills',
            { action, payload },
            `${action}:${crypto.randomUUID()}`
          )
        )
      );
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('skills'),
      });
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : admin_skills_skill_operation_failed_please_retry_25350fdc();
      // Bind form keeps `values` as-is; only map the stable Spec B message.
      setError(
        action === 'skill_bind' ? mapSkillBindFormError(message) : message
      );
    } finally {
      setBusy(false);
    }
  };

  const startGovernanceRun = async () => {
    setGovernanceBusy(true);
    setGovernanceError('');
    try {
      const payload = buildSkillGovernanceStartPayload(governanceValues);
      await governanceActionIntents.execute(
        'skill_governance_start',
        payload.runId,
        (idempotencyKey) =>
          commandP1(
            'skills',
            { action: 'skill_governance_start', payload },
            idempotencyKey
          )
      );
      setGovernanceRunId(payload.runId);
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('skills'),
      });
    } catch (cause) {
      setGovernanceError(
        cause instanceof Error
          ? cause.message
          : admin_skills_controlled_revision_failed_to_start_plea_dfef11e8()
      );
    } finally {
      setGovernanceBusy(false);
    }
  };

  const actOnGovernanceRun = async (runAction: GovernanceRunAction) => {
    if (!governanceRunId) return;
    setGovernanceBusy(true);
    setGovernanceError('');
    try {
      await governanceActionIntents.execute(
        runAction,
        governanceRunId,
        (idempotencyKey) =>
          commandP1(
            'skills',
            {
              action: runAction,
              payload: { runId: governanceRunId },
            },
            idempotencyKey
          )
      );
      await governanceRunQuery.refetch();
    } catch (cause) {
      setGovernanceError(
        cause instanceof Error
          ? cause.message
          : admin_skills_governance_run_operation_failed_please_r_ef7a5191()
      );
    } finally {
      setGovernanceBusy(false);
    }
  };

  const publishRevision = async () => {
    setPublishBusy(true);
    setPublishError('');
    try {
      const catalog = rows.find(
        (row) => row.skillId === publishValues.skillId.trim()
      );
      if (!catalog) {
        throw new Error(
          admin_skills_select_a_valid_skill_id_from_the_current_f94d8342()
        );
      }
      const payload = buildSkillPublishPayload({
        ...publishValues,
        expectedPublicationGeneration: String(catalog.publicationGeneration),
        expectedPublishedRevisionRef: catalog.activeRevisionRef ?? '',
      });
      const response = await commandP1<SkillGovernanceResult>(
        'skills',
        { action: 'skill_publish', payload },
        `skill_publish:${payload.runId}`
      );
      setPublishResult(response);
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('skills'),
      });
    } catch (cause) {
      setPublishError(
        cause instanceof Error
          ? cause.message
          : admin_skills_published_switch_failed_please_retry_19e2f54b()
      );
    } finally {
      setPublishBusy(false);
    }
  };

  const inspectDependencies = () => {
    const target = dependencyInput.trim();
    setRetireResult(null);
    if (!target) {
      setRetireError(admin_skills_version_ref_cannot_be_empty_438f7f5d());
      return;
    }
    setRetireError('');
    if (target === dependencyTarget) {
      void dependencyQuery.refetch();
      return;
    }
    setDependencyTarget(target);
  };

  const visibleDependencies = dependencyQuery.data?.visibleDependencies ?? [];
  const retirementBlocked =
    !dependencyQuery.data ||
    dependencyQuery.data.blocked === true ||
    dependencyQuery.data.hiddenCount > 0 ||
    visibleDependencies.length > 0;

  const retireRevision = async () => {
    setRetireBusy(true);
    setRetireError('');
    setRetireResult(null);
    try {
      const runId = requiredFormValue(
        retireRunId,
        admin_skills_retire_run_id_2f94a368()
      );
      const skillRevisionRef = requiredFormValue(
        dependencyTarget,
        admin_skills_version_ref_9b17a444()
      );
      if (retirementBlocked) {
        throw new Error(
          admin_skills_reverse_dependencies_remain_this_version_b88675b0()
        );
      }
      const response = await commandP1<SkillGovernanceResult>(
        'skills',
        {
          action: 'skill_retire',
          payload: { runId, skillRevisionRef },
        },
        `skill_retire:${runId}`
      );
      setRetireResult(response);
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('skills'),
      });
    } catch (cause) {
      setRetireError(
        cause instanceof Error
          ? cause.message
          : admin_skills_version_retire_failed_please_retry_7bb0464e()
      );
    } finally {
      setRetireBusy(false);
    }
  };

  const rows = catalogQuery.data?.items ?? [];
  const stats = catalogQuery.data?.stats;

  return (
    <div className="space-y-6" data-testid="admin-skills-control">
      <Frame>
        <FrameHeader className="gap-1">
          <FrameTitle>{admin_capability_skill_catalog_e4646dec()}</FrameTitle>
          <FrameDescription>
            {admin_skills_currently_hosts_platform_and_industry_la_21e67a8f()}
          </FrameDescription>
        </FrameHeader>
        {/* 目录面板的节奏：工具条 → Separator → 表格，版本记录落在 FrameFooter。 */}
        <FramePanel className="flex flex-col gap-0 p-0!">
          <div className="flex items-end gap-3 px-4 py-3">
            <div className="space-y-2">
              <Label htmlFor="skills-tier-filter">
                {admin_skills_filter_by_layer_de4f93bc()}
              </Label>
              <Select
                onValueChange={(value) => {
                  if (value == null) return;
                  setTierFilter(value === '__all__' ? '' : value);
                }}
                value={tierFilter || '__all__'}
              >
                <SelectTrigger
                  className="w-auto min-w-32"
                  data-ops-control="select"
                  id="skills-tier-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">
                    {admin_capability_all_778fc8f9()}
                  </SelectItem>
                  <SelectItem value="platform">
                    {admin_skills_platform_layer_dbecdefc()}
                  </SelectItem>
                  <SelectItem value="industry">
                    {admin_skills_industry_layer_9fad7f92()}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {stats?.industryTierTotal ? (
              <p className="pb-2 text-sm text-muted-foreground">
                {admin_skills_industry_layer_second_source_cross_check_caed8dad()}
                {Math.round(
                  (stats.industryTierCorroborated / stats.industryTierTotal) *
                    100
                )}
                %（{stats.industryTierCorroborated}/{stats.industryTierTotal}）
              </p>
            ) : null}
          </div>
          <Separator />
          {catalogQuery.isError ? (
            <p role="alert" className="px-4 py-3 text-sm text-destructive">
              {admin_skills_catalog_read_failed_please_retry_717c437d()}
            </p>
          ) : null}
          {!catalogQuery.isLoading && !rows.length ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {admin_skills_no_skills_yet_use_new_practice_below_to_724789ca()}
            </p>
          ) : null}
          {rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{admin_skills_name_1be7ae4f()}</TableHead>
                  <TableHead>
                    {admin_skills_one_line_description_f960848c()}
                  </TableHead>
                  <TableHead>{admin_skills_source_c63f79e6()}</TableHead>
                  <TableHead>{admin_skills_layer_dac36cb8()}</TableHead>
                  <TableHead>
                    {admin_skills_current_version_46e66f63()}
                  </TableHead>
                  <TableHead>{admin_skills_updated_at_093dea88()}</TableHead>
                  <TableHead>
                    {admin_skills_version_records_7c9253ad()}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.skillId}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <div
                        className="max-w-96 truncate"
                        title={row.description}
                      >
                        {row.description}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {SOURCE_LABELS[row.sourceKind] ?? row.sourceKind}
                      </Badge>
                      {row.sourceRef?.externalUrl ? (
                        <a
                          className="ml-2 text-xs underline"
                          href={row.sourceRef.externalUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {admin_skills_view_provenance_84ec1d0a()}
                        </a>
                      ) : null}
                    </TableCell>
                    <TableCell>{TIER_LABELS[row.tier] ?? row.tier}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.activeRevisionRef ??
                        admin_skills_not_yet_accepted_9e65dd32()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.updatedAt}
                    </TableCell>
                    <TableCell>
                      <Button
                        data-ops-control="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setHistorySkillId(row.skillId)}
                      >
                        {admin_skills_view_versions_31140423()}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </FramePanel>
        {historySkillId ? (
          <FrameFooter
            className="gap-2 py-3"
            data-testid="skills-revision-history"
          >
            <p className="font-medium text-sm">
              {historySkillId} {admin_skills_version_records_4173c9ea()}
            </p>
            {historyQuery.isLoading ? (
              <p className="text-muted-foreground text-sm">
                {admin_skills_loading_f950213a()}
              </p>
            ) : null}
            {historyQuery.data?.map((revision) => (
              <div
                className="flex justify-between rounded-lg border px-3 py-2 text-sm"
                key={revision.skillRevisionRef}
              >
                <span>{revision.skillRevisionRef}</span>
                <span>{revision.status}</span>
              </div>
            ))}
          </FrameFooter>
        ) : null}
      </Frame>

      <Frame>
        <FrameHeader className="gap-1">
          <FrameTitle>{admin_skills_controlled_revision_ad2b3dcf()}</FrameTitle>
          <FrameDescription>
            {admin_skills_only_controlled_practice_body_and_one_li_9d4a8ac0()}
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-4">
          <div
            className="rounded-md border bg-muted/30 p-3 text-muted-foreground text-sm"
            data-testid="skills-readonly-declaration"
          >
            {admin_skills_immutable_name_source_layer_governance_b_e5a81b71()}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="skills-governance-run-id">
                {admin_skills_governance_run_id_5f00ef9c()}
              </Label>
              <Input
                id="skills-governance-run-id"
                data-ops-control="text"
                value={governanceValues.runId}
                onChange={(event) =>
                  setGovernanceValues((current) => ({
                    ...current,
                    runId: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skills-governance-base-ref">
                {admin_skills_base_version_ref_d58f0e4f()}
              </Label>
              <Input
                id="skills-governance-base-ref"
                data-ops-control="text"
                value={governanceValues.baseSkillRevisionRef}
                onChange={(event) =>
                  setGovernanceValues((current) => ({
                    ...current,
                    baseSkillRevisionRef: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skills-governance-head">
                {admin_skills_current_version_number_31e02486()}
              </Label>
              <Input
                id="skills-governance-head"
                data-ops-control="text"
                inputMode="numeric"
                value={governanceValues.expectedHeadRevision}
                onChange={(event) =>
                  setGovernanceValues((current) => ({
                    ...current,
                    expectedHeadRevision: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skills-governance-description">
                {admin_skills_one_line_description_f960848c()}
              </Label>
              <Input
                id="skills-governance-description"
                data-ops-control="text"
                value={governanceValues.description}
                onChange={(event) =>
                  setGovernanceValues((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="skills-governance-instruction">
                {admin_skills_controlled_practice_body_7353e406()}
              </Label>
              <Textarea
                id="skills-governance-instruction"
                data-ops-control="text"
                value={governanceValues.instruction}
                onChange={(event) =>
                  setGovernanceValues((current) => ({
                    ...current,
                    instruction: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <Button
            data-ops-control="button"
            disabled={governanceBusy}
            onClick={() => void startGovernanceRun()}
          >
            {governanceBusy
              ? admin_skills_processing_1cac8ac7()
              : admin_skills_start_revision_run_cdffed85()}
          </Button>
          {governanceError ? (
            <p role="alert" className="text-sm text-destructive">
              {governanceError}
            </p>
          ) : null}
          <div
            className="space-y-3 rounded-md border p-3"
            data-testid="skills-governance-run"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-sm">
                  {admin_skills_governance_run_8165d3ab()}
                </p>
                <p className="text-muted-foreground text-sm">
                  {governanceRunId
                    ? `${governanceRunId} · ${
                        governanceRunStatusLabel(
                          governanceRunStatus(governanceRunQuery.data)
                        ) ?? admin_skills_loading_b21b631c()
                      }`
                    : admin_skills_run_state_resumes_here_after_start_ce3af0bc()}
                </p>
              </div>
              {governanceRunQuery.isFetching ? (
                <Badge variant="secondary">
                  {admin_skills_refreshing_d47379f9()}
                </Badge>
              ) : null}
            </div>
            {governanceRunResult(governanceRunQuery.data) ? (
              <GovernanceResultView
                result={governanceRunResult(governanceRunQuery.data)!}
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                data-ops-control="button"
                disabled={
                  governanceBusy ||
                  governanceRunStatus(governanceRunQuery.data) !==
                    'awaiting_approval'
                }
                onClick={() =>
                  void actOnGovernanceRun('skill_governance_approve')
                }
                size="sm"
                variant="outline"
              >
                {admin_skills_approve_and_continue_f2d98e71()}
              </Button>
              <Button
                data-ops-control="button"
                disabled={
                  governanceBusy ||
                  !governanceRunId ||
                  !['awaiting_approval', 'applying'].includes(
                    governanceRunStatus(governanceRunQuery.data) ?? ''
                  )
                }
                onClick={() =>
                  void actOnGovernanceRun('skill_governance_cancel')
                }
                size="sm"
                variant="outline"
              >
                {admin_skills_admin_cancel_recoverable_379b7eac()}
              </Button>
              <Button
                data-ops-control="button"
                disabled={
                  governanceBusy ||
                  governanceRunStatus(governanceRunQuery.data) !==
                    'awaiting_approval'
                }
                onClick={() =>
                  void actOnGovernanceRun('skill_governance_business_cancel')
                }
                size="sm"
                variant="outline"
              >
                {admin_skills_business_terminate_irrecoverable_66a07809()}
              </Button>
              <Button
                data-ops-control="button"
                disabled={
                  governanceBusy ||
                  governanceWorkflowStatus(governanceRunQuery.data) !==
                    'cancelled'
                }
                onClick={() =>
                  void actOnGovernanceRun('skill_governance_resume')
                }
                size="sm"
                variant="outline"
              >
                {admin_skills_resume_after_admin_cancel_4bae812b()}
              </Button>
              <Button
                data-ops-control="button"
                disabled={!governanceRunId}
                onClick={() => void governanceRunQuery.refetch()}
                size="sm"
                variant="ghost"
              >
                {admin_skills_refresh_status_7cc7f07a()}
              </Button>
            </div>
          </div>
        </FramePanel>
      </Frame>

      <Frame>
        <FrameHeader className="gap-1">
          <FrameTitle>{admin_skills_published_unique_81041b5a()}</FrameTitle>
          <FrameDescription>
            {admin_skills_published_is_each_skill_s_unique_lifecyc_f734ef29()}
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['runId', admin_skills_publish_run_id_41466e91()],
              ['skillId', admin_skills_skill_id_0ba503b6()],
              [
                'targetSkillRevisionRef',
                admin_skills_target_version_ref_ddaa8254(),
              ],
            ].map(([key, label]) => (
              <div className="space-y-2" key={key}>
                <Label htmlFor={`skills-publish-${key}`}>{label}</Label>
                <Input
                  id={`skills-publish-${key}`}
                  data-ops-control="text"
                  value={publishValues[key as keyof SkillPublishFormValues]}
                  onChange={(event) =>
                    setPublishValues((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>
          <Button
            data-ops-control="button"
            disabled={publishBusy}
            onClick={() => void publishRevision()}
          >
            {publishBusy
              ? admin_skills_switching_717bbfb3()
              : admin_skills_switch_published_306a0aaf()}
          </Button>
          {publishError ? (
            <p role="alert" className="text-sm text-destructive">
              {publishError}
            </p>
          ) : null}
          {publishResult ? (
            <GovernanceResultView result={publishResult} />
          ) : null}
        </FramePanel>
      </Frame>

      <Frame>
        <FrameHeader className="gap-1">
          <FrameTitle>
            {admin_skills_reverse_dependencies_retire_ca2bbf94()}
          </FrameTitle>
          <FrameDescription>
            {admin_skills_before_retire_load_reverse_dependencies_db0e6004()}
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="skills-dependency-ref">
                {admin_skills_version_ref_9b17a444()}
              </Label>
              <Input
                id="skills-dependency-ref"
                data-ops-control="text"
                value={dependencyInput}
                onChange={(event) => setDependencyInput(event.target.value)}
              />
            </div>
            <Button
              data-ops-control="button"
              onClick={inspectDependencies}
              variant="outline"
            >
              {admin_skills_view_reverse_dependencies_073dbd6f()}
            </Button>
          </div>
          {dependencyQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {admin_skills_dependency_read_failed_retire_stays_bloc_4d091c9f()}
            </p>
          ) : null}
          {dependencyQuery.data ? (
            <div
              className="space-y-3 rounded-md border p-3"
              data-testid="skills-reverse-dependencies"
            >
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={
                    retirementBlocked
                      ? 'destructive-outline'
                      : 'success-outline'
                  }
                >
                  {retirementBlocked
                    ? admin_skills_retire_blocked_91eb75f1()
                    : admin_skills_no_dependencies_found_93ae6ed5()}
                </Badge>
                <Badge variant="secondary">
                  {admin_skills_other_workspace_deps_5f81764d()}{' '}
                  {dependencyQuery.data.hiddenCount}
                </Badge>
              </div>
              {visibleDependencies.map((dependency, index) => (
                <div
                  className="flex items-center justify-between gap-3 text-sm"
                  key={`${dependency.consumerKind}:${dependency.consumerId || index}`}
                >
                  <span>{dependency.consumerLabel}</span>
                  <span className="text-muted-foreground">
                    {dependency.scopeKind === 'global'
                      ? admin_skills_global_a5644f4b()
                      : admin_skills_this_workspace_ba93d643()}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="skills-retire-run-id">
                {admin_skills_retire_run_id_2f94a368()}
              </Label>
              <Input
                id="skills-retire-run-id"
                data-ops-control="text"
                value={retireRunId}
                onChange={(event) => setRetireRunId(event.target.value)}
              />
            </div>
            <Button
              data-ops-control="button"
              disabled={retireBusy || retirementBlocked}
              onClick={() => void retireRevision()}
              variant="outline"
            >
              {retireBusy
                ? admin_skills_retiring_97c3815f()
                : admin_skills_retire_this_version_20cc3f32()}
            </Button>
          </div>
          {retireError ? (
            <p role="alert" className="text-sm text-destructive">
              {retireError}
            </p>
          ) : null}
          {retireResult ? <GovernanceResultView result={retireResult} /> : null}
        </FramePanel>
      </Frame>

      <Frame>
        <FrameHeader className="gap-1">
          <FrameTitle>
            {admin_skills_traffic_targets_new_requests_base_lifecy_66c8a83e()}
          </FrameTitle>
          <FrameDescription>
            {admin_skills_bind_stage_and_rollback_binding_only_swi_849e87d0()}
          </FrameDescription>
        </FrameHeader>
        <FramePanel className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="skills-action">
              {admin_supply_action_f3ea6d34()}
            </Label>
            <Select
              onValueChange={(value) => {
                if (!value) return;
                setAction(value as SkillAction);
                setValues({});
                setError('');
                setResult(null);
              }}
              value={action}
            >
              <SelectTrigger
                className="w-full"
                data-ops-control="select"
                id="skills-action"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_ORDER.map((value) => (
                  <SelectItem key={value} value={value}>
                    {COMMAND_FORMS[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {form.fields.map((field) => (
              <div
                key={field.key}
                className={
                  field.kind === 'workflow_multi'
                    ? 'space-y-2 sm:col-span-2'
                    : 'space-y-2'
                }
              >
                <Label htmlFor={`skills-field-${field.key}`}>
                  {field.label}
                </Label>
                {field.kind === 'select' ? (
                  <Select
                    onValueChange={(value) => {
                      if (value == null) return;
                      setValues((current) => ({
                        ...current,
                        [field.key]: value,
                      }));
                    }}
                    value={values[field.key] || undefined}
                  >
                    <SelectTrigger
                      className="w-full"
                      data-ops-control="select"
                      id={`skills-field-${field.key}`}
                    >
                      <SelectValue
                        placeholder={admin_skills_please_select_382f4b55()}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options?.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.kind === 'workflow_select' ? (
                  <Select
                    onValueChange={(value) => {
                      if (value == null) return;
                      setValues((current) => ({
                        ...current,
                        [field.key]: value,
                      }));
                    }}
                    value={values[field.key] || undefined}
                  >
                    <SelectTrigger
                      className="w-full"
                      data-ops-control="select"
                      data-testid={`skills-field-${field.key}`}
                      id={`skills-field-${field.key}`}
                    >
                      <SelectValue
                        placeholder={admin_skills_select_a_published_workflow_c466f863()}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {publishedWorkflowRevisionRefs.map((ref) => (
                        <SelectItem key={ref} value={ref}>
                          {ref}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.kind === 'workflow_multi' ? (
                  <div
                    className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3"
                    data-testid="skills-field-workflowRevisionRefs"
                  >
                    {publishedWorkflowQuery.isLoading ? (
                      <p className="text-muted-foreground text-sm">
                        {admin_skills_loading_published_workflow_catalog_091eca78()}
                      </p>
                    ) : null}
                    {publishedWorkflowQuery.isError ? (
                      <p role="alert" className="text-destructive text-sm">
                        {admin_skills_published_workflow_catalog_read_failed_p_9a03a8d7()}
                      </p>
                    ) : null}
                    {!publishedWorkflowQuery.isLoading &&
                    !publishedWorkflowQuery.isError &&
                    publishedWorkflowRevisionRefs.length === 0 ? (
                      <p className="text-muted-foreground text-sm">
                        {admin_skills_no_published_recipe_workflows_yet_290f9354()}
                      </p>
                    ) : null}
                    {publishedWorkflowRevisionRefs.map((ref) => {
                      const selected = new Set(
                        parseSelectedWorkflowRevisionRefs(
                          values.workflowRevisionRefs
                        )
                      );
                      return (
                        <label
                          key={ref}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            data-ops-control="checkbox"
                            checked={selected.has(ref)}
                            onChange={(event) => {
                              const next = new Set(selected);
                              if (event.target.checked) next.add(ref);
                              else next.delete(ref);
                              setValues((current) => ({
                                ...current,
                                workflowRevisionRefs: [...next]
                                  .sort((left, right) =>
                                    left < right ? -1 : left > right ? 1 : 0
                                  )
                                  .join('\n'),
                              }));
                            }}
                          />
                          <span className="font-mono text-xs">{ref}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : field.kind === 'textarea' ? (
                  <Textarea
                    id={`skills-field-${field.key}`}
                    data-ops-control="text"
                    value={values[field.key] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  <Input
                    id={`skills-field-${field.key}`}
                    data-ops-control="text"
                    value={values[field.key] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
          {promptReferenceQuery.data ? (
            <p
              className="text-muted-foreground text-sm"
              data-testid="skills-current-prompt-reference"
            >
              {admin_skills_current_prompt_07bd4ba9()}
              {promptReferenceQuery.data.name}@
              {promptReferenceQuery.data.version} ·{' '}
              {promptReferenceQuery.data.source} ·{' '}
              {promptReferenceQuery.data.label} · fallback=
              {String(promptReferenceQuery.data.isFallback)} · eligible=
              {String(promptReferenceQuery.data.eligibleForAcceptance)}
            </p>
          ) : null}
          {promptReferenceQuery.isError ||
          (promptReferenceQuery.data &&
            !promptReferenceQuery.data.eligibleForAcceptance) ? (
            <p role="alert" className="text-sm text-destructive">
              {admin_skills_current_production_prompt_ref_unavailabl_892d6852()}
            </p>
          ) : null}
          <Button
            data-ops-control="button"
            disabled={busy || authorityUnavailable}
            onClick={() => void submit()}
          >
            {busy
              ? admin_skills_submitting_17e519c5()
              : admin_skills_submit_governed_command_1430e707()}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {result ? (
            <div
              className="rounded-lg border p-3 text-sm"
              data-testid="skills-operation-result"
            >
              {admin_skills_operation_completed_d285ee4a()}
              {action}
            </div>
          ) : null}
        </FramePanel>
      </Frame>
    </div>
  );
}
