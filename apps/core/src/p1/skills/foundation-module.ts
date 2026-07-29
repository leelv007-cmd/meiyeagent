import { HARNESS_STAGES, type EvalRun } from '@meiye/contracts';

import {
  PrewriteDeterministicRejectionError,
  type P1Context,
} from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import { SKILL_BINDING_MODES } from './types.js';
import type {
  SkillCatalog,
  SkillExecutionMode,
  SkillGovernanceSidecar,
  SkillRevision,
  SkillRevisionManifest,
} from './types.js';
import { SkillService } from './service.js';

function fail(message: string): never {
  throw new PrewriteDeterministicRejectionError(message);
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
        onlyKeys(
          value,
          [
            'expectedRevision',
            'frontmatter',
            'governance',
            'instruction',
            'name',
            'packagePaths',
            'presentationPolicy',
            'promptReference',
            'skillId',
          ],
          'Skill 定义命令',
        );
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
        const promptReference = object(value, 'promptReference');
        onlyKeys(
          promptReference,
          ['contentHash', 'name', 'version'],
          'Skill prompt reference',
        );
        const contentHash = text(promptReference, 'contentHash');
        const promptName = text(promptReference, 'name');
        const promptVersion = text(promptReference, 'version');
        if (!/^[a-f0-9]{64}$/u.test(contentHash)) {
          fail('Skill prompt contentHash 必须是 64 位小写 SHA-256。');
        }
        if (
          /^<[^>]+>$/u.test(promptName) ||
          /^<[^>]+>$/u.test(promptVersion)
        ) {
          fail('Skill prompt name 与 version 必须是可解析的固定引用。');
        }
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
        const { catalog, revision } =
          await this.service.defineCatalogAndDraftRevision({
          skillId,
          name: catalogName,
          presentationPolicy,
          actorId: args.context.userId,
          expectedRevision,
          instruction,
          manifest: value.frontmatter as SkillRevisionManifest,
          governance: value.governance as SkillGovernanceSidecar,
          promptReference: {
            contentHash,
            name: promptName,
            version: promptVersion,
          },
          packagePaths,
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
        fail(`未知的 Skill 运营命令：“${name}”。`);
    }
  }
}
