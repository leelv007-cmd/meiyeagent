import {
  assistantContextSchema,
  assistantFieldPatchSchema,
  type AssistantFieldPatch,
  type AssistantStreamRequest,
} from '@meiye/contracts';

type AssistantContext = AssistantStreamRequest['context'];

export interface SafeAssistantContextSummary {
  audience?: string;
  intent: string;
  scene?: string;
  sourceCount: number;
  tone?: string;
}

type VisiblePartState = 'loading' | 'ready' | 'unavailable';

export type AssistantVisiblePart =
  | { id: string; kind: 'text'; text: string }
  | {
      id: string;
      kind: 'context';
      state: VisiblePartState;
      summary?: SafeAssistantContextSummary;
    }
  | {
      id: string;
      kind: 'field-patch';
      patch?: AssistantFieldPatch;
      state: VisiblePartState;
    };

export interface AssistantPatchDecision {
  state: 'accepted' | 'editing' | 'ignored' | 'pending';
  value: string;
}

export type AssistantPatchDecisionAction =
  | { type: 'accept' | 'edit' | 'ignore' | 'save-edit' }
  | { type: 'change' | 'reset'; value: string };

export function projectAssistantMessageParts(
  parts: readonly unknown[]
): AssistantVisiblePart[] {
  const hasContextData = parts.some(
    (part) => isRecord(part) && part.type === 'data-context'
  );
  const hasFieldPatchData = parts.some(
    (part) => isRecord(part) && part.type === 'data-field_patch'
  );

  return parts.flatMap((part, index) => {
    if (!isRecord(part) || typeof part.type !== 'string') return [];

    if (part.type === 'text') {
      return typeof part.text === 'string' && part.text.length > 0
        ? [{ id: partId(part, `text-${index}`), kind: 'text', text: part.text }]
        : [];
    }

    if (part.type === 'tool-readCurrentContext') {
      if (hasContextData) return [];
      return [projectContextPart(part, partId(part, `context-tool-${index}`))];
    }
    if (part.type === 'tool-proposeFieldPatch') {
      if (hasFieldPatchData) return [];
      return [projectFieldPatchTool(part, partId(part, `patch-tool-${index}`))];
    }
    if (part.type === 'data-context') {
      return [projectContextData(part, partId(part, `context-data-${index}`))];
    }
    if (part.type === 'data-field_patch') {
      return [projectFieldPatchData(part, partId(part, `patch-data-${index}`))];
    }

    return [];
  });
}

export function initialAssistantPatchDecision(
  value: string
): AssistantPatchDecision {
  return { state: 'pending', value };
}

export function reduceAssistantPatchDecision(
  current: AssistantPatchDecision,
  action: AssistantPatchDecisionAction
): AssistantPatchDecision {
  switch (action.type) {
    case 'accept':
      return { ...current, state: 'accepted' };
    case 'edit':
      return { ...current, state: 'editing' };
    case 'change':
      return current.state === 'editing'
        ? { ...current, value: action.value }
        : current;
    case 'reset':
      return initialAssistantPatchDecision(action.value);
    case 'save-edit':
      return current.state === 'editing' && current.value.trim()
        ? { ...current, state: 'accepted', value: current.value.trim() }
        : current;
    case 'ignore':
      return { ...current, state: 'ignored' };
  }
}

export function isConversationNearBottom(
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
  threshold = 48
) {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold
  );
}

function projectContextPart(
  part: Record<string, unknown>,
  id: string
): AssistantVisiblePart {
  if (part.state === 'output-error' || part.state === 'output-denied') {
    return { id, kind: 'context', state: 'unavailable' };
  }
  if (part.state !== 'output-available') {
    return { id, kind: 'context', state: 'loading' };
  }
  return contextPart(id, part.output);
}

function projectContextData(
  part: Record<string, unknown>,
  id: string
): AssistantVisiblePart {
  return contextPart(id, part.data);
}

function contextPart(id: string, value: unknown): AssistantVisiblePart {
  const parsed = assistantContextSchema.safeParse(value);
  if (!parsed.success) return { id, kind: 'context', state: 'unavailable' };
  return {
    id,
    kind: 'context',
    state: 'ready',
    summary: safeContextSummary(parsed.data),
  };
}

function projectFieldPatchTool(
  part: Record<string, unknown>,
  id: string
): AssistantVisiblePart {
  if (part.state === 'output-error' || part.state === 'output-denied') {
    return { id, kind: 'field-patch', state: 'unavailable' };
  }
  if (part.state === 'input-streaming') {
    return { id, kind: 'field-patch', state: 'loading' };
  }
  const value = part.state === 'output-available' ? part.output : part.input;
  return fieldPatchPart(id, value);
}

function projectFieldPatchData(
  part: Record<string, unknown>,
  id: string
): AssistantVisiblePart {
  return fieldPatchPart(id, part.data);
}

function fieldPatchPart(id: string, value: unknown): AssistantVisiblePart {
  const parsed = assistantFieldPatchSchema.safeParse(value);
  return parsed.success
    ? { id, kind: 'field-patch', patch: parsed.data, state: 'ready' }
    : { id, kind: 'field-patch', state: 'unavailable' };
}

function safeContextSummary(
  context: AssistantContext
): SafeAssistantContextSummary {
  return {
    ...(context.audience ? { audience: context.audience } : {}),
    intent: context.intent,
    ...(context.scene ? { scene: context.scene } : {}),
    sourceCount: context.sourceSummaries.length,
    ...(context.tone ? { tone: context.tone } : {}),
  };
}

function partId(part: Record<string, unknown>, fallback: string) {
  if (typeof part.toolCallId === 'string') return part.toolCallId;
  return typeof part.id === 'string' ? part.id : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
