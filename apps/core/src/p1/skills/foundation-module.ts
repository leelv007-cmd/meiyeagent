import type { EvalRun } from '@meiye/contracts';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import { SKILL_BINDING_MODES, SKILL_STAGES } from './types.js';
import type {
  SkillCatalog,
  SkillDeploymentArtifactType,
  SkillExecutionMode,
  SkillGovernanceSidecar,
  SkillPromptReference,
  SkillRevision,
  SkillRevisionManifest,
} from './types.js';
import { SkillService } from './service.js';

function fail(message: string): never {
  throw new P1DomainError('INVALID_STATE', message);
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

function publicRevision(revision: SkillRevision) {
  const { fallbackContent: _fallbackContent, ...prompt } = revision.prompt;
  return { ...revision, prompt };
}

export class SkillFoundationModule implements P1OperationModule {
  readonly name = 'skills';

  constructor(private readonly service: SkillService) {}

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    const name = action(args.input);
    const value = payload(args.input);
    switch (name) {
      case 'skill_define': {
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
        const catalog = await this.service.defineCatalogEntry({
          skillId: text(value, 'skillId'),
          name: text(value, 'name'),
          presentationPolicy,
          actorId: args.context.userId,
        });
        if (
          value.instruction === undefined &&
          value.frontmatter === undefined &&
          value.governance === undefined &&
          value.promptReference === undefined
        ) {
          return { catalog, revision: null };
        }
        if (
          !value.frontmatter ||
          !value.governance ||
          !value.promptReference
        ) {
          fail(
            '定义 Skill 版本时必须同时提供 instruction、frontmatter、governance 与 promptReference。',
          );
        }
        const promptReference = object(value, 'promptReference');
        if ('content' in promptReference) {
          fail('Skill prompt reference must not include content.');
        }
        const revision = await this.service.draftRevision({
          skillId: catalog.skillId,
          expectedRevision: integerOrNull(value, 'expectedRevision'),
          actorId: args.context.userId,
          instruction: text(value, 'instruction'),
          manifest: value.frontmatter as SkillRevisionManifest,
          governance: value.governance as SkillGovernanceSidecar,
          promptReference: promptReference as unknown as SkillPromptReference,
        });
        return { catalog, revision: publicRevision(revision) };
      }
      case 'skill_accept':
        return publicRevision(
          await this.service.acceptAndFreezeRevision({
            skillRevisionRef: text(value, 'skillRevisionRef'),
            actorId: args.context.userId,
            evalRun: value.evalRun as EvalRun,
          }),
        );
      case 'skill_bind': {
        const mode = text(value, 'mode');
        const stage = text(value, 'stage');
        if (
          !SKILL_BINDING_MODES.includes(
            mode as (typeof SKILL_BINDING_MODES)[number],
          ) ||
          !SKILL_STAGES.includes(stage as (typeof SKILL_STAGES)[number])
        ) {
          fail('Skill 绑定模式或阶段不受支持。');
        }
        return this.service.bindRevision({
          bindingId: text(value, 'bindingId'),
          workflowRevisionRef: text(value, 'workflowRevisionRef'),
          stage: stage as (typeof SKILL_STAGES)[number],
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
        const artifactType = text(
          value,
          'artifactType',
        ) as SkillDeploymentArtifactType;
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
          executionMode,
          artifactType,
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
        fail(`未知的 Skill 运营命令：“${name}”。`);
    }
  }
}
