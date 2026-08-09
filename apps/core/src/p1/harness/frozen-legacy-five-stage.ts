/**
 * Frozen five-stage rollback truth retained until V31-26b pilot acceptance.
 *
 * Source truth: c8e679fef11ecdefcb542e5d12296bb7bcd5e91b
 * (the fixed parent of the V31-25 convergence commit).
 *
 * This module intentionally does not import the compiled executor or any
 * carrier primitive program. Its adapter contracts, orchestration, and effect
 * topology are fixed so a regression in the new executor cannot disable the
 * rollback path.
 */

import { isBoundedExecutionSuspension } from './bounded-execution-controller.js';
import { projectHarnessExperienceBasis } from './experience-basis.js';
import { merchantNoteStyleQuestion } from './merchant-delivery-language.js';
import {
  projectLegacyDeterministicFields,
  type ShadowDeterministicFields,
} from './shadow-reconciliation.js';
import type {
  HarnessMediaStagePorts,
  HarnessNoteStagePorts,
  HarnessStageExecutionInput,
  HarnessStagePorts,
  HarnessWorkflowResult,
} from './workflow-core.js';

export const FROZEN_LEGACY_SOURCE_COMMIT =
  'c8e679fef11ecdefcb542e5d12296bb7bcd5e91b' as const;

type FrozenLegacySharedPorts = Pick<
  HarnessStagePorts,
  'recordExecutionAssemblyStep'
>;
type FrozenLegacyCopyPorts = FrozenLegacySharedPorts &
  Pick<
    HarnessStagePorts,
    | 'compileBrief'
    | 'executeAndSelect'
    | 'executeAndSelectBounded'
    | 'assembleAndDeliver'
  >;
type FrozenLegacyNotePorts = FrozenLegacySharedPorts &
  Pick<
    HarnessNoteStagePorts,
    'compileNoteBrief' | 'executeNoteAndSelect' | 'assembleNoteAndDeliver'
  >;
type FrozenLegacyMediaPorts = FrozenLegacySharedPorts &
  Pick<
    HarnessMediaStagePorts,
    | 'compileMediaBrief'
    | 'executeMediaAndSelect'
    | 'executeMediaAndSelectBounded'
    | 'assembleMediaAndDeliver'
  >;

export async function runFrozenLegacyFiveStage(
  input: HarnessStageExecutionInput,
): Promise<HarnessWorkflowResult> {
  const lens = input.request.executionSnapshot?.lens ?? 'copy';
  if (lens === 'image_text_note') return runFrozenNote(input);
  if (lens === 'image' || lens === 'video') return runFrozenMedia(input);
  return runFrozenCopy(input);
}

async function runFrozenCopy(
  input: HarnessStageExecutionInput,
): Promise<HarnessWorkflowResult> {
  const ports = input.ports as FrozenLegacyCopyPorts;
  const { activeRequest, context, factGate, routed, stageSkills } = input.prelude;
  const briefSkills = stageSkills.brief_compilation.instructions;
  const executionSkills = stageSkills.execution_selection.instructions;
  const assemblySkills = stageSkills.assembly_delivery.instructions;
  const compiledBrief = await input.runtime.runStep(
    legacyEffectKey(
      input.workflowId,
      3,
      legacySkillUnit('copy', briefSkills),
      '0',
    ),
    () =>
      ports.compileBrief({
        workflowId: input.workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context,
        allowedFactRefs: factGate.allowedFactRefs ?? [],
        ...(briefSkills.length > 0
          ? { skillInstructions: briefSkills }
          : {}),
      }),
  );
  const brief = unwrapMeasuredBrief(compiledBrief);
  const selection = await input.runtime.runStep(
    legacyEffectKey(
      input.workflowId,
      4,
      legacySkillUnit('copy', executionSkills),
      'selection',
    ),
    async () => {
      const selected =
        activeRequest.boundedExecution && ports.executeAndSelectBounded
          ? await ports.executeAndSelectBounded({
              workflowId: input.workflowId,
              request: activeRequest,
              brief,
              context,
              ...(executionSkills.length > 0
                ? { skillInstructions: executionSkills }
                : {}),
            })
          : await ports.executeAndSelect({
              workflowId: input.workflowId,
              request: activeRequest,
              brief,
              context,
              ...(executionSkills.length > 0
                ? { skillInstructions: executionSkills }
                : {}),
            });
      if (isBoundedExecutionSuspension(selected)) {
        throw new Error('Frozen legacy copy execution suspended at its bound.');
      }
      await ports.recordExecutionAssemblyStep?.({
        workflowId: input.workflowId,
        request: activeRequest,
        step: 'execution_check',
      });
      return selected;
    },
  );
  await finalizeLegacyMerchantExecution(
    input,
    activeRequest,
    selection.merchantExecutionEffectKey,
  );
  const delivery = await input.runtime.runStep(
    legacyEffectKey(
      input.workflowId,
      5,
      legacySkillUnit('package', assemblySkills),
      '0',
    ),
    async () => {
      const delivered = await ports.assembleAndDeliver({
        workflowId: input.workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context,
        allowedFactRefs: factGate.allowedFactRefs ?? [],
        brief,
        selection,
        ...(assemblySkills.length > 0
          ? { skillInstructions: assemblySkills }
          : {}),
      });
      await ports.recordExecutionAssemblyStep?.({
        workflowId: input.workflowId,
        request: activeRequest,
        step: 'event_persistence',
      });
      return delivered;
    },
  );
  await persistLegacyObservation(input, brief.factRefs, context);
  return {
    delivery,
    deliveryLayer: routed.declaration.deliveryLayer,
    experienceBasis: projectHarnessExperienceBasis(context.bundle),
    recommendation: {
      recommendedCandidateId: selection.winner.candidateId,
      decisionTrace: selection.trace as never,
    },
    trace: selection.trace,
  } as HarnessWorkflowResult;
}

async function runFrozenNote(
  input: HarnessStageExecutionInput,
): Promise<HarnessWorkflowResult> {
  const ports = input.ports as FrozenLegacyNotePorts;
  const { activeRequest, context, factGate, routed, stageSkills } = input.prelude;
  const briefSkills = stageSkills.brief_compilation.instructions;
  const executionSkills = stageSkills.execution_selection.instructions;
  const assemblySkills = stageSkills.assembly_delivery.instructions;
  const brief = await input.runtime.runStep(
    legacyEffectKey(
      input.workflowId,
      3,
      legacySkillUnit('image_text_note', briefSkills),
      '0',
    ),
    () =>
      ports.compileNoteBrief({
        workflowId: input.workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context,
        allowedFactRefs: factGate.allowedFactRefs ?? [],
        ...(briefSkills.length > 0
          ? { skillInstructions: briefSkills }
          : {}),
      }),
  );
  const frozenStyle = [...(activeRequest.decisionReferences ?? [])]
    .reverse()
    .find(({ field }) => field === 'note_style');
  const selectedStyleId = frozenStyle
    ? resolveLegacyStyleId(brief, frozenStyle.value)
    : resolveLegacyStyleId(
        brief,
        await resolveLegacyStyleDecision(input, brief),
      );
  const selection = await ports.executeNoteAndSelect({
    workflowId: input.workflowId,
    request: activeRequest,
    brief,
    context,
    selectedStyleId,
    ...(executionSkills.length > 0
      ? { skillInstructions: executionSkills }
      : {}),
    ...(input.runtime.awaitSignal
      ? { awaitSignal: input.runtime.awaitSignal.bind(input.runtime) }
      : {}),
    runStep: input.runtime.runStep.bind(input.runtime),
  });
  await input.runtime.runStep(
    legacyEffectKey(
      input.workflowId,
      4,
      legacySkillUnit('image_text_note', executionSkills),
      'execution-check',
    ),
    () =>
      ports.recordExecutionAssemblyStep?.({
        workflowId: input.workflowId,
        request: activeRequest,
        step: 'execution_check',
      }) ?? Promise.resolve(),
  );
  const delivery = await input.runtime.runStep(
    legacyEffectKey(
      input.workflowId,
      5,
      legacySkillUnit('package', assemblySkills),
      '0',
    ),
    async () => {
      const delivered = await ports.assembleNoteAndDeliver({
        workflowId: input.workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context,
        allowedFactRefs: factGate.allowedFactRefs ?? [],
        brief,
        selection,
        ...(assemblySkills.length > 0
          ? { skillInstructions: assemblySkills }
          : {}),
      });
      await ports.recordExecutionAssemblyStep?.({
        workflowId: input.workflowId,
        request: activeRequest,
        step: 'event_persistence',
      });
      return delivered;
    },
  );
  const factRefs = brief.candidates.candidates.flatMap(({ plan }) =>
    plan.pages.flatMap(({ imageIntent }) => imageIntent.factRefs),
  );
  await persistLegacyObservation(input, factRefs, context);
  return {
    delivery,
    deliveryLayer: routed.declaration.deliveryLayer,
    experienceBasis: projectHarnessExperienceBasis(context.bundle),
    recommendation: {
      recommendedCandidateId: selection.selectedStyleId,
      decisionTrace: selection.trace as never,
    },
    trace: selection.trace,
  } as HarnessWorkflowResult;
}

async function runFrozenMedia(
  input: HarnessStageExecutionInput,
): Promise<HarnessWorkflowResult> {
  const ports = input.ports as FrozenLegacyMediaPorts;
  const { activeRequest, context, factGate, routed, stageSkills } = input.prelude;
  const briefSkills = stageSkills.brief_compilation.instructions;
  const executionSkills = stageSkills.execution_selection.instructions;
  const assemblySkills = stageSkills.assembly_delivery.instructions;
  const compiledBrief = await input.runtime.runStep(
    legacyEffectKey(
      input.workflowId,
      3,
      legacySkillUnit(input.request.executionSnapshot?.lens ?? 'image', briefSkills),
      '0',
    ),
    () =>
      ports.compileMediaBrief({
        workflowId: input.workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context,
        allowedFactRefs: factGate.allowedFactRefs ?? [],
        ...(briefSkills.length > 0
          ? { skillInstructions: briefSkills }
          : {}),
      }),
  );
  const brief = unwrapMeasuredBrief(compiledBrief);
  const executionInput = {
    workflowId: input.workflowId,
    request: activeRequest,
    brief,
    context,
    ...(executionSkills.length > 0
      ? { skillInstructions: executionSkills }
      : {}),
    ...(input.runtime.awaitSignal
      ? { awaitSignal: input.runtime.awaitSignal.bind(input.runtime) }
      : {}),
    runStep: input.runtime.runStep.bind(input.runtime),
  };
  const selection =
    activeRequest.boundedExecution && ports.executeMediaAndSelectBounded
      ? await ports.executeMediaAndSelectBounded(executionInput)
      : await ports.executeMediaAndSelect(executionInput);
  if (isBoundedExecutionSuspension(selection)) {
    throw new Error('Frozen legacy media execution suspended at its bound.');
  }
  await input.runtime.runStep(
    legacyEffectKey(
      input.workflowId,
      4,
      legacySkillUnit(
        input.request.executionSnapshot?.lens ?? 'image',
        executionSkills,
      ),
      'execution-check',
    ),
    () =>
      ports.recordExecutionAssemblyStep?.({
        workflowId: input.workflowId,
        request: activeRequest,
        step: 'execution_check',
      }) ?? Promise.resolve(),
  );
  await finalizeLegacyMerchantExecution(
    input,
    activeRequest,
    selection.merchantExecutionEffectKey,
  );
  const delivery = await input.runtime.runStep(
    legacyEffectKey(
      input.workflowId,
      5,
      legacySkillUnit('package', assemblySkills),
      '0',
    ),
    async () => {
      const delivered = await ports.assembleMediaAndDeliver({
        workflowId: input.workflowId,
        request: activeRequest,
        declaration: routed.declaration,
        context,
        allowedFactRefs: factGate.allowedFactRefs ?? [],
        brief,
        selection,
        ...(assemblySkills.length > 0
          ? { skillInstructions: assemblySkills }
          : {}),
      });
      await ports.recordExecutionAssemblyStep?.({
        workflowId: input.workflowId,
        request: activeRequest,
        step: 'event_persistence',
      });
      return delivered;
    },
  );
  await persistLegacyObservation(
    input,
    brief.kind === 'image' ? brief.intent.factRefs : [],
    context,
  );
  return {
    delivery,
    deliveryLayer: routed.declaration.deliveryLayer,
    experienceBasis: projectHarnessExperienceBasis(context.bundle),
    recommendation: {
      recommendedCandidateId: selection.asset?.id ?? 'legacy-media',
      decisionTrace: selection.trace as never,
    },
    trace: selection.trace,
  } as HarnessWorkflowResult;
}

async function resolveLegacyStyleDecision(
  input: HarnessStageExecutionInput,
  brief: Awaited<ReturnType<HarnessNoteStagePorts['compileNoteBrief']>>,
) {
  const language = merchantNoteStyleQuestion();
  const resolved = await input.runtime.awaitDecision(
    {
      questionId: `${input.workflowId}:note-style`,
      workflowId: input.workflowId,
      workflowRevision: input.request.workflowRevision,
      question: language.question,
      options: brief.candidates.candidates.map((candidate) => ({
        id: candidate.styleId,
        label: candidate.styleName,
        description: candidate.positioning,
      })),
      freeText: { enabled: false },
      response: { field: 'note_style', reason: language.responseReason },
      unattended: 'hold',
      scope: 'current_task',
    },
    'brief_compilation',
  );
  if ('cancelled' in resolved) throw new Error(resolved.merchantMessage);
  const decision = 'command' in resolved ? resolved.command : resolved;
  return decision.decision.value;
}

function resolveLegacyStyleId(
  brief: Awaited<ReturnType<HarnessNoteStagePorts['compileNoteBrief']>>,
  value: string,
) {
  const selected = brief.candidates.candidates.find(
    (candidate) =>
      candidate.styleId === value || candidate.styleName === value,
  );
  if (!selected) throw new Error('Frozen legacy note style is unavailable.');
  return selected.styleId;
}

async function finalizeLegacyMerchantExecution(
  input: HarnessStageExecutionInput,
  request: HarnessStageExecutionInput['request'],
  selectionEffectKey?: string,
) {
  if (!selectionEffectKey) return;
  const snapshot = request.executionSnapshot;
  if (!snapshot || !request.usageReservation || !input.runtime.finalizeMerchantExecution) {
    throw new Error('Frozen legacy merchant execution finalization is unavailable.');
  }
  await input.runtime.runStep(
    legacyEffectKey(input.workflowId, 4, 'merchant-primary', '0'),
    () =>
      input.runtime.finalizeMerchantExecution!({
        quoteRevision: snapshot.quote.revision,
        sourceEffectKey: selectionEffectKey,
        taskId: snapshot.task.id,
        workspaceId: snapshot.workspaceId,
      }),
  );
}

async function persistLegacyObservation(
  input: HarnessStageExecutionInput,
  factRefs: readonly string[],
  context: HarnessStageExecutionInput['prelude']['context'],
) {
  if (!input.runtime.recordLegacyShadowObservation) return;
  const observation = legacyObservation(input, factRefs, context);
  if (!observation) return;
  await input.runtime.recordLegacyShadowObservation({
    observation,
    workflowId: input.workflowId,
    workspaceId: input.request.workspaceId,
  });
}

function legacyObservation(
  input: HarnessStageExecutionInput,
  factRefs: readonly string[],
  context: HarnessStageExecutionInput['prelude']['context'],
): ShadowDeterministicFields | null {
  const snapshot = input.request.executionSnapshot;
  const bounds =
    input.request.boundedExecution ??
    input.request.executionPlanSnapshot?.boundedExecution;
  if (!snapshot || !bounds) return null;
  return projectLegacyDeterministicFields({
    deliverables: snapshot.deliverables.map((deliverable) => ({
      kind:
        deliverable.kind === 'copy'
          ? 'copy'
          : deliverable.kind === 'image_text_note'
            ? 'note'
            : 'media',
      quantity: deliverable.quantity,
    })),
    factRefs: [...factRefs],
    rightsRefs:
      context.policyReferences?.rightsRefs?.map(
        (right) => `${right.assetId}:${right.status}`,
      ) ?? [],
    quoteRef: snapshot.quote,
    bounds: {
      maxIterations: bounds.maxIterations,
      maxCostCents: bounds.maxCostCents,
      maxWallClockMs: bounds.maxWallClockMs,
      maxDelegations: bounds.maxDelegations,
    },
  });
}

function unwrapMeasuredBrief<T>(value: T): T extends { brief: infer Brief } ? Brief : T {
  if (value && typeof value === 'object' && 'brief' in value) {
    return value.brief as never;
  }
  return value as never;
}

function legacyEffectKey(
  workflowId: string,
  stage: 1 | 2 | 3 | 4 | 5,
  unit: string,
  candidate: string,
) {
  return `wf:${workflowId}:s${stage}:${unit}:${candidate}`;
}

function legacySkillUnit(
  unit: string,
  skills: readonly { skillRevisionRef: string }[],
) {
  if (skills.length === 0) return unit;
  return `${unit}:skills=${skills
    .map((skill) => encodeURIComponent(skill.skillRevisionRef))
    .join(',')}`;
}
