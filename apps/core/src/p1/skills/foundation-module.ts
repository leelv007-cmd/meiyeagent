import { HARNESS_STAGES } from '@meiye/contracts';

import {
  P1DomainError,
  PrewriteDeterministicRejectionError,
  type P1Context,
} from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import {
  SKILL_BINDING_MODES,
  SKILL_SOURCE_KINDS,
  SKILL_TIERS,
} from './types.js';
import type {
  SkillCatalog,
  SkillExecutionMode,
  SkillGovernanceSidecar,
  SkillRevision,
  SkillRevisionManifest,
  SkillSourceKind,
  SkillSourceRef,
  SkillTier,
} from './types.js';
import { SkillService } from './service.js';

export const SKILL_QUERY_ACTIONS = [
  'skill_catalog_list',
  'skill_governance_run_get',
  'skill_revision_history',
  'skill_prompt_reference',
  'skill_reverse_dependencies',
] as const;

export const SKILL_COMMAND_ACTIONS = [
  'skill_accept',
  'skill_bind',
  'skill_define',
  'skill_deployment',
  'skill_governance_approve',
  'skill_governance_business_cancel',
  'skill_governance_cancel',
  'skill_governance_resume',
  'skill_governance_start',
  'skill_publish',
  'skill_retire',
  'skill_rollback',
] as const;

export interface SkillGovernanceRuntimePort {
  start(input: Parameters<SkillService['applyGovernanceRevision']>[0]): Promise<unknown>;
  approve(input: {
    actorId: string;
    idempotencyKey: string;
    runId: string;
    workspaceId: string;
  }): Promise<unknown>;
  businessCancel(input: {
    actorId: string;
    idempotencyKey: string;
    runId: string;
    workspaceId: string;
  }): Promise<unknown>;
  cancel(input: {
    actorId: string;
    runId: string;
    workspaceId: string;
  }): Promise<unknown>;
  resume(input: {
    actorId: string;
    runId: string;
    workspaceId: string;
  }): Promise<unknown>;
  inspect(workspaceId: string, runId: string): Promise<unknown>;
}

function isSkillQueryAction(
  value: string,
): value is (typeof SKILL_QUERY_ACTIONS)[number] {
  return (SKILL_QUERY_ACTIONS as readonly string[]).includes(value);
}

function isSkillCommandAction(
  value: string,
): value is (typeof SKILL_COMMAND_ACTIONS)[number] {
  return (SKILL_COMMAND_ACTIONS as readonly string[]).includes(value);
}

function fail(message: string): never {
  throw new PrewriteDeterministicRejectionError(message);
}

function parsePrewritePromptReference(value: Record<string, unknown>) {
  try {
    const promptReference = object(value, 'promptReference');
    onlyKeys(
      promptReference,
      ['contentHash', 'name', 'version'],
      'Skill prompt reference',
    );
    const contentHash = text(promptReference, 'contentHash');
    const name = text(promptReference, 'name');
    const version = text(promptReference, 'version');
    if (!/^[a-f0-9]{64}$/u.test(contentHash)) {
      fail('Skill prompt contentHash 必须是 64 位小写 SHA-256。');
    }
    if (/^<[^>]+>$/u.test(name) || /^<[^>]+>$/u.test(version)) {
      fail('Skill prompt name 与 version 必须是可解析的固定引用。');
    }
    return { contentHash, name, version };
  } catch (error) {
    if (
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE'
    ) {
      throw new PrewriteDeterministicRejectionError(error.message);
    }
    throw error;
  }
}

function payload(input: Record<string, unknown>) {
  const value = input.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('Skill 命令必须提供 payload。');
  }
  return value as Record<string, unknown>;
}

function action(input: Record<string, unknown>) {
  if (typeof input.action !== 'string' || !input.action.trim()) {
    fail('Skill 命令必须提供 action。');
  }
  return input.action;
}

function text(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  if (typeof candidate !== 'string' || !candidate.trim()) {
    fail(`Skill 命令字段 ${key} 不能为空。`);
  }
  return candidate.trim();
}

function integerOrNull(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  if (candidate === null) return null;
  if (typeof candidate !== 'number' || !Number.isInteger(candidate)) {
    fail(`Skill 命令字段 ${key} 必须是整数或 null。`);
  }
  return candidate;
}

function textOrNull(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  if (candidate === null) return null;
  return text(value, key);
}

function skillSourceKind(value: Record<string, unknown>): SkillSourceKind {
  const candidate = text(value, 'sourceKind');
  if (!(SKILL_SOURCE_KINDS as readonly string[]).includes(candidate)) {
    fail(`Skill 来源必须是 ${SKILL_SOURCE_KINDS.join('、')} 之一。`);
  }
  return candidate as SkillSourceKind;
}

function skillTier(value: Record<string, unknown>): SkillTier {
  const candidate = text(value, 'tier');
  if (!(SKILL_TIERS as readonly string[]).includes(candidate)) {
    fail(`Skill 层级必须是 ${SKILL_TIERS.join('、')} 之一。`);
  }
  return candidate as SkillTier;
}

function parseSourceRef(
  value: Record<string, unknown>,
): SkillSourceRef | undefined {
  const candidate = value.sourceRef;
  if (candidate === undefined || candidate === null) return undefined;
  if (typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('Skill 命令字段 sourceRef 必须是对象。');
  }
  const record = candidate as Record<string, unknown>;
  onlyKeys(record, ['externalUrl', 'harvestedAt'], 'Skill 来源出处');
  return {
    ...(record.externalUrl === undefined
      ? {}
      : { externalUrl: text(record, 'externalUrl') }),
    ...(record.harvestedAt === undefined
      ? {}
      : { harvestedAt: text(record, 'harvestedAt') }),
  };
}

function positiveInteger(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  if (
    typeof candidate !== 'number' ||
    !Number.isInteger(candidate) ||
    candidate <= 0
  ) {
    fail(`Skill 命令字段 ${key} 必须是正整数。`);
  }
  return candidate;
}

function optionalTextOrNull(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  if (candidate === undefined || candidate === null) return null;
  if (typeof candidate !== 'string' || !candidate.trim()) {
    fail(`Skill 命令字段 ${key} 必须是非空字符串或 null。`);
  }
  return candidate.trim();
}

function object(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate)
  ) {
    fail(`Skill 命令字段 ${key} 必须是对象。`);
  }
  return candidate as Record<string, unknown>;
}

function stringArray(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  if (
    !Array.isArray(candidate) ||
    candidate.some((item) => typeof item !== 'string')
  ) {
    fail(`Skill 命令字段 ${key} 必须是字符串数组。`);
  }
  return candidate as string[];
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpected) {
    fail(`${label} 不支持字段 ${unexpected}。`);
  }
}

function publicRevision(revision: SkillRevision) {
  const { instruction: _instruction, ...publicFields } = revision;
  const {
    content: _content,
    fallbackContent: _legacyFallbackContent,
    ...prompt
  } = revision.prompt as SkillRevision['prompt'] & {
    fallbackContent?: string;
  };
  return revision.formatVersion === 1
    ? { ...publicFields, prompt }
    : { ...publicFields, instruction: revision.instruction, prompt };
}

export class SkillFoundationModule implements P1OperationModule {
  readonly name = 'skills';

  constructor(
    private readonly service: SkillService,
    private readonly governanceRuntime?: SkillGovernanceRuntimePort,
  ) {}

  /**
   * Read face for the operator catalog. Until now the module was
   * command-only, so the catalog had no way to be listed at all.
   */
  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    const name = action(args.input);
    const value = payload(args.input);
    if (!isSkillQueryAction(name)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Skill 查询 ${name} 不受支持。`,
      );
    }
    switch (name) {
      case 'skill_catalog_list': {
        onlyKeys(value, ['limit', 'sourceKind', 'tier'], 'Skill 目录查询');
        return this.service.listCatalog({
          ...(value.tier === undefined ? {} : { tier: skillTier(value) }),
          ...(value.sourceKind === undefined
            ? {}
            : { sourceKind: skillSourceKind(value) }),
          ...(value.limit === undefined
            ? {}
            : { limit: positiveInteger(value, 'limit') }),
        });
      }
      case 'skill_revision_history': {
        onlyKeys(value, ['limit', 'skillId'], 'Skill 版本历史查询');
        return this.service.listRevisionHistory(
          text(value, 'skillId'),
          value.limit === undefined
            ? undefined
            : positiveInteger(value, 'limit'),
        );
      }
      case 'skill_governance_run_get': {
        onlyKeys(value, ['runId'], 'Skill 治理运行查询');
        return this.requireGovernanceRuntime().inspect(
          args.context.workspaceId,
          text(value, 'runId'),
        );
      }
      case 'skill_prompt_reference': {
        onlyKeys(value, ['slot'], 'Skill prompt 引用查询');
        const slot = text(value, 'slot');
        if (!['intentNaming', 'copyCandidate'].includes(slot)) {
          fail('Skill prompt slot 不受支持。');
        }
        return this.service.promptReference(
          slot as 'intentNaming' | 'copyCandidate',
        );
      }
      case 'skill_reverse_dependencies': {
        onlyKeys(
          value,
          ['skillRevisionRef'],
          'Skill 反向依赖查询',
        );
        return this.service.inspectReverseDependencies({
          targetSkillRevisionRef: text(value, 'skillRevisionRef'),
          viewerWorkspaceId: args.context.workspaceId,
        });
      }
      default:
        return name satisfies never;
    }
  }

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    const name = action(args.input);
    const value = payload(args.input);
    if (!isSkillCommandAction(name)) {
      fail(`未知的 Skill 运营命令：“${name}”。`);
    }
    switch (name) {
      case 'skill_define': {
        onlyKeys(
          value,
          [
            'description',
            'expectedRevision',
            'frontmatter',
            'governance',
            'instruction',
            'name',
            'packagePaths',
            'presentationPolicy',
            'promptReference',
            'skillId',
            'sourceKind',
            'sourceRef',
            'tier',
          ],
          'Skill 定义命令',
        );
        const sourceKind = skillSourceKind(value);
        const tier = skillTier(value);
        if (tier === 'store') {
          fail(
            '门店层 Skill 需要工作区归属；租户维度通电前只允许平台层或行业层。',
          );
        }
        const sourceRef = parseSourceRef(value);
        if (
          sourceKind === 'harvested' &&
          (!sourceRef?.externalUrl || !sourceRef.harvestedAt)
        ) {
          fail('收割转译 Skill 必须提供来源链接与收割时间。');
        }
        if (sourceKind === 'harvested' && sourceRef) {
          let sourceUrl: URL;
          try {
            sourceUrl = new URL(sourceRef.externalUrl!);
          } catch {
            fail('收割转译 Skill 的来源链接必须是有效 URL。');
          }
          if (
            !['http:', 'https:'].includes(sourceUrl.protocol) ||
            Number.isNaN(Date.parse(sourceRef.harvestedAt!))
          ) {
            fail('收割转译 Skill 的来源链接或收割时间无效。');
          }
        }
        const presentationPolicy = text(
          value,
          'presentationPolicy',
        ) as SkillCatalog['presentationPolicy'];
        if (
          !['backend_only', 'explainable', 'user_selectable'].includes(
            presentationPolicy,
          )
        ) {
          fail('Skill 展示策略不受支持。');
        }
        const revisionRequested = !(
          value.instruction === undefined &&
          value.frontmatter === undefined &&
          value.governance === undefined &&
          value.promptReference === undefined
        );
        if (!revisionRequested) {
          const catalog = await this.service.defineCatalogEntry({
            skillId: text(value, 'skillId'),
            name: text(value, 'name'),
            // No revision here, so there is no frontmatter to take the
            // description from — the caller must supply it.
            description: text(value, 'description'),
            sourceKind,
            tier,
            ...(sourceRef ? { sourceRef } : {}),
            presentationPolicy,
            actorId: args.context.userId,
          });
          return { catalog, revision: null };
        }
        if (
          value.instruction === undefined ||
          !value.frontmatter ||
          !value.governance ||
          !value.promptReference
        ) {
          fail(
            '定义 Skill 版本时必须同时提供 instruction、frontmatter、governance 与 promptReference。',
          );
        }
        const promptReference = parsePrewritePromptReference(value);
        const packagePaths =
          value.packagePaths === undefined
            ? ['SKILL.md']
            : stringArray(value, 'packagePaths');
        const expectedRevision = integerOrNull(
          value,
          'expectedRevision',
        );
        const instruction = text(value, 'instruction');
        const skillId = text(value, 'skillId');
        const catalogName = text(value, 'name');
        const frontmatter = value.frontmatter as SkillRevisionManifest;
        const { catalog, revision } =
          await this.service.defineCatalogAndDraftRevision({
          skillId,
          name: catalogName,
          // Single authority: when a revision is drafted the standard
          // frontmatter owns the description, so the catalog projects it
          // rather than keeping a second editable copy.
          description: frontmatter?.description,
          sourceKind,
          tier,
          ...(sourceRef ? { sourceRef } : {}),
          presentationPolicy,
          actorId: args.context.userId,
          expectedRevision,
          instruction,
          manifest: value.frontmatter as SkillRevisionManifest,
          governance: value.governance as SkillGovernanceSidecar,
          promptReference,
          packagePaths,
          });
        return { catalog, revision: publicRevision(revision) };
      }
      case 'skill_accept':
        onlyKeys(
          value,
          ['evalRunId', 'skillRevisionRef'],
          'Skill 接受命令',
        );
        return publicRevision(
          await this.service.acceptAndFreezeRevision({
            skillRevisionRef: text(value, 'skillRevisionRef'),
            actorId: args.context.userId,
            evalRunId: text(value, 'evalRunId'),
          }),
        );
      case 'skill_governance_start':
        onlyKeys(
          value,
          [
            'baseSkillRevisionRef',
            'expectedHeadRevision',
            'patch',
            'runId',
          ],
          'Skill 治理启动命令',
        );
        return this.requireGovernanceRuntime().start({
          actorId: args.context.userId,
          baseSkillRevisionRef: text(value, 'baseSkillRevisionRef'),
          expectedHeadRevision: positiveInteger(
            value,
            'expectedHeadRevision',
          ),
          patch: object(value, 'patch'),
          runId: text(value, 'runId'),
          workspaceId: args.context.workspaceId,
        });
      case 'skill_governance_approve':
        onlyKeys(value, ['runId'], 'Skill 治理审批命令');
        return this.requireGovernanceRuntime().approve({
          actorId: args.context.userId,
          idempotencyKey: args.idempotencyKey,
          runId: text(value, 'runId'),
          workspaceId: args.context.workspaceId,
        });
      case 'skill_governance_business_cancel':
        onlyKeys(value, ['runId'], 'Skill 治理业务终止命令');
        return this.requireGovernanceRuntime().businessCancel({
          actorId: args.context.userId,
          idempotencyKey: args.idempotencyKey,
          runId: text(value, 'runId'),
          workspaceId: args.context.workspaceId,
        });
      case 'skill_governance_cancel':
        onlyKeys(value, ['runId'], 'Skill 治理管理取消命令');
        return this.requireGovernanceRuntime().cancel({
          actorId: args.context.userId,
          runId: text(value, 'runId'),
          workspaceId: args.context.workspaceId,
        });
      case 'skill_governance_resume':
        onlyKeys(value, ['runId'], 'Skill 治理恢复命令');
        return this.requireGovernanceRuntime().resume({
          actorId: args.context.userId,
          runId: text(value, 'runId'),
          workspaceId: args.context.workspaceId,
        });
      case 'skill_publish':
        onlyKeys(
          value,
          [
            'runId',
            'skillId',
            'targetSkillRevisionRef',
            'expectedPublishedRevisionRef',
            'expectedPublicationGeneration',
          ],
          'Skill 发布命令',
        );
        return this.service.publishAcceptedRevision({
          runId: text(value, 'runId'),
          skillId: text(value, 'skillId'),
          targetSkillRevisionRef: text(
            value,
            'targetSkillRevisionRef',
          ),
          expectedPublishedRevisionRef: textOrNull(
            value,
            'expectedPublishedRevisionRef',
          ),
          expectedPublicationGeneration: integerOrNull(
            value,
            'expectedPublicationGeneration',
          ) as number,
          actorId: args.context.userId,
          workspaceId: args.context.workspaceId,
        });
      case 'skill_retire':
        onlyKeys(
          value,
          ['runId', 'skillRevisionRef'],
          'Skill 退役命令',
        );
        return this.service.retireRevision({
          actorId: args.context.userId,
          runId: text(value, 'runId'),
          skillRevisionRef: text(value, 'skillRevisionRef'),
          workspaceId: args.context.workspaceId,
        });
      case 'skill_bind': {
        const mode = text(value, 'mode');
        const triggerCondition = object(value, 'triggerCondition');
        onlyKeys(
          triggerCondition,
          ['harnessStage', 'industryCategory', 'tenantId'],
          'Skill 触发条件',
        );
        const harnessStage = text(triggerCondition, 'harnessStage');
        if (
          !SKILL_BINDING_MODES.includes(
            mode as (typeof SKILL_BINDING_MODES)[number],
          ) ||
          !HARNESS_STAGES.includes(
            harnessStage as (typeof HARNESS_STAGES)[number],
          )
        ) {
          fail('Skill 绑定模式或触发条件不受支持。');
        }
        return this.service.bindRevision({
          bindingId: text(value, 'bindingId'),
          workflowRevisionRef: text(value, 'workflowRevisionRef'),
          triggerCondition: {
            harnessStage:
              harnessStage as (typeof HARNESS_STAGES)[number],
            industryCategory: optionalTextOrNull(
              triggerCondition,
              'industryCategory',
            ),
            tenantId: optionalTextOrNull(triggerCondition, 'tenantId'),
          },
          ownerWorkspaceId: args.context.workspaceId,
          skillRevisionRef: text(value, 'skillRevisionRef'),
          mode: mode as (typeof SKILL_BINDING_MODES)[number],
        });
      }
      case 'skill_rollback':
        return this.service.rollbackBinding({
          bindingId: text(value, 'bindingId'),
          sourceBindingId: text(value, 'sourceBindingId'),
          targetSkillRevisionRef: text(value, 'targetSkillRevisionRef'),
          workflowRevisionRef: text(value, 'workflowRevisionRef'),
        });
      case 'skill_deployment': {
        const executionMode = text(value, 'executionMode') as SkillExecutionMode;
        const gate =
          value.experimentalGate &&
          typeof value.experimentalGate === 'object' &&
          !Array.isArray(value.experimentalGate)
            ? (value.experimentalGate as Record<string, unknown>)
            : undefined;
        return this.service.registerDeployment({
          deploymentId: text(value, 'deploymentId'),
          skillRevisionRef: text(value, 'skillRevisionRef'),
          provider: text(value, 'provider'),
          channel: text(value, 'channel'),
          nativeSkillId: text(value, 'nativeSkillId'),
          nativeVersion: text(value, 'nativeVersion'),
          ownerWorkspaceId: args.context.workspaceId,
          executionMode,
          packagePaths: stringArray(value, 'packagePaths'),
          ...(gate
            ? {
                experimentalGate: {
                  enabled: gate.enabled === true,
                  evidenceRef: text(gate, 'evidenceRef'),
                },
              }
            : {}),
        });
      }
      default:
        return name satisfies never;
    }
  }

  private requireGovernanceRuntime() {
    if (!this.governanceRuntime) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Skill 治理运行时未配置。',
      );
    }
    return this.governanceRuntime;
  }
}
