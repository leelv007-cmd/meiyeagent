import type { EvalRun } from '@meiye/contracts';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import { SKILL_BINDING_MODES, SKILL_STAGES } from './types.js';
import type {
  SkillCatalog,
  SkillDeploymentArtifactType,
  SkillExecutionMode,
  SkillRevisionManifest,
} from './types.js';
import { SkillService } from './service.js';
import type { HarnessFrozenPrompt } from '../harness/langfuse-prompts.js';

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
          value.manifest === undefined &&
          value.prompt === undefined
        ) {
          return { catalog, revision: null };
        }
        if (!value.manifest || !value.prompt) {
          fail('定义 Skill 版本时必须同时提供 instruction、manifest 与 prompt。');
        }
        const revision = await this.service.draftRevision({
          skillId: catalog.skillId,
          expectedRevision: integerOrNull(value, 'expectedRevision'),
          actorId: args.context.userId,
          instruction: text(value, 'instruction'),
          manifest: value.manifest as SkillRevisionManifest,
          prompt: value.prompt as HarnessFrozenPrompt,
        });
        return { catalog, revision };
      }
      case 'skill_accept':
        return this.service.acceptAndFreezeRevision({
          skillRevisionRef: text(value, 'skillRevisionRef'),
          actorId: args.context.userId,
          evalRun: value.evalRun as EvalRun,
        });
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
