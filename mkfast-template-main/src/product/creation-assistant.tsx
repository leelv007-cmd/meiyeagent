import { useChat } from '@ai-sdk/react';
import type { AssistantStreamRequest } from '@meiye/contracts';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useMemo, useReducer, useRef } from 'react';

import { StreamingAiMarkdown } from '@/components/markdown/ai-markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  creation_assistant_accept,
  creation_assistant_aria,
  creation_assistant_context_aria,
  creation_assistant_context_loading,
  creation_assistant_context_ready,
  creation_assistant_context_unavailable,
  creation_assistant_conversation_aria,
  creation_assistant_decision_accepted,
  creation_assistant_decision_editing,
  creation_assistant_decision_ignored,
  creation_assistant_decision_pending,
  creation_assistant_edit,
  creation_assistant_empty,
  creation_assistant_field_audience,
  creation_assistant_field_intent,
  creation_assistant_field_scene,
  creation_assistant_field_tone,
  creation_assistant_fetch,
  creation_assistant_ignore,
  creation_assistant_interrupted,
  creation_assistant_local_only,
  creation_assistant_patch_aria,
  creation_assistant_patch_edit_aria,
  creation_assistant_patch_loading,
  creation_assistant_patch_title,
  creation_assistant_patch_unavailable,
  creation_assistant_save_edit,
  creation_assistant_seed,
  creation_assistant_source_count,
  creation_assistant_stop,
  creation_assistant_title,
} from '@/locale/paraglide/messages';

import {
  initialAssistantPatchDecision,
  isConversationNearBottom,
  projectAssistantMessageParts,
  reduceAssistantPatchDecision,
  type AssistantVisiblePart,
} from './creation-assistant-model';

type AssistantContext = AssistantStreamRequest['context'];

type CreationAssistantProps = {
  catalogModelId: string;
  context: AssistantContext;
};

/** Fixed seed for a single proposal turn — not merchant free-text chat. */
export const CREATION_ASSISTANT_SEED = creation_assistant_seed();

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

const FIELD_LABELS = {
  audience: creation_assistant_field_audience,
  intent: creation_assistant_field_intent,
  scene: creation_assistant_field_scene,
  tone: creation_assistant_field_tone,
} as const;

export function AssistantMessageParts({
  parts,
  streaming,
}: {
  parts: readonly unknown[];
  streaming: boolean;
}) {
  const visibleParts = projectAssistantMessageParts(parts);
  return (
    <div className="space-y-3">
      {visibleParts.map((part) => {
        if (part.kind === 'text') {
          return (
            <StreamingAiMarkdown
              className="prose prose-sm max-w-none dark:prose-invert"
              content={part.text}
              key={part.id}
              streaming={streaming}
            />
          );
        }
        if (part.kind === 'context') {
          return <AssistantContextPart key={part.id} part={part} />;
        }
        return <AssistantFieldPatchPart key={part.id} part={part} />;
      })}
    </div>
  );
}

function AssistantContextPart({
  part,
}: {
  part: Extract<AssistantVisiblePart, { kind: 'context' }>;
}) {
  if (part.state === 'loading') {
    return (
      <p className="rounded-2xl border border-divider bg-surface-0/80 p-4 text-sm text-muted-foreground">
        {creation_assistant_context_loading()}
      </p>
    );
  }
  if (part.state === 'unavailable' || !part.summary) {
    return (
      <p className="rounded-2xl border border-divider bg-surface-0/80 p-4 text-sm text-muted-foreground">
        {creation_assistant_context_unavailable()}
      </p>
    );
  }
  return (
    <section
      aria-label={creation_assistant_context_aria()}
      className="space-y-2 rounded-2xl border border-divider bg-surface-0/80 p-4 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{creation_assistant_context_ready()}</p>
        <Badge variant="outline">
          {creation_assistant_source_count({
            count: part.summary.sourceCount,
          })}
        </Badge>
      </div>
      <p>{part.summary.intent}</p>
      {[
        [creation_assistant_field_scene(), part.summary.scene],
        [creation_assistant_field_tone(), part.summary.tone],
        [creation_assistant_field_audience(), part.summary.audience],
      ].map(([label, value]) =>
        value ? (
          <p className="text-xs text-muted-foreground" key={label}>
            {label}：{value}
          </p>
        ) : null
      )}
    </section>
  );
}

function AssistantFieldPatchPart({
  part,
}: {
  part: Extract<AssistantVisiblePart, { kind: 'field-patch' }>;
}) {
  if (part.state === 'loading') {
    return (
      <p className="rounded-2xl border border-divider bg-surface-0/80 p-4 text-sm text-muted-foreground">
        {creation_assistant_patch_loading()}
      </p>
    );
  }
  if (part.state === 'unavailable' || !part.patch) {
    return (
      <p className="rounded-2xl border border-divider bg-surface-0/80 p-4 text-sm text-muted-foreground">
        {creation_assistant_patch_unavailable()}
      </p>
    );
  }
  return <EditableAssistantFieldPatch patch={part.patch} />;
}

function EditableAssistantFieldPatch({
  patch,
}: {
  patch: NonNullable<
    Extract<AssistantVisiblePart, { kind: 'field-patch' }>['patch']
  >;
}) {
  const [decision, dispatch] = useReducer(
    reduceAssistantPatchDecision,
    patch.value,
    initialAssistantPatchDecision
  );
  const fieldLabel = FIELD_LABELS[patch.field]();

  useEffect(() => {
    dispatch({ type: 'reset', value: patch.value });
  }, [patch.field, patch.reason, patch.value]);

  return (
    <section
      aria-label={creation_assistant_patch_aria({ field: fieldLabel })}
      className="space-y-3 rounded-2xl border border-divider bg-surface-0/80 p-4"
      data-proposal-card="field-patch"
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">
          {creation_assistant_patch_title({ field: fieldLabel })}
        </p>
        <Badge variant="outline">{creation_assistant_local_only()}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{patch.reason}</p>
      {decision.state === 'editing' ? (
        <Textarea
          aria-label={creation_assistant_patch_edit_aria({
            field: fieldLabel,
          })}
          onChange={(event) =>
            dispatch({ type: 'change', value: event.currentTarget.value })
          }
          value={decision.value}
        />
      ) : (
        <p className="whitespace-pre-wrap rounded-xl bg-surface-1/60 px-3 py-2 text-sm leading-6">
          {decision.value}
        </p>
      )}
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {decision.state === 'accepted'
          ? creation_assistant_decision_accepted()
          : decision.state === 'editing'
            ? creation_assistant_decision_editing()
            : decision.state === 'ignored'
              ? creation_assistant_decision_ignored()
              : creation_assistant_decision_pending()}
      </p>
      {decision.state === 'pending' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => dispatch({ type: 'accept' })}
            size="sm"
            type="button"
          >
            {creation_assistant_accept()}
          </Button>
          <Button
            onClick={() => dispatch({ type: 'edit' })}
            size="sm"
            type="button"
            variant="outline"
          >
            {creation_assistant_edit()}
          </Button>
          <Button
            onClick={() => dispatch({ type: 'ignore' })}
            size="sm"
            type="button"
            variant="ghost"
          >
            {creation_assistant_ignore()}
          </Button>
        </div>
      ) : decision.state === 'editing' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!decision.value.trim()}
            onClick={() => dispatch({ type: 'save-edit' })}
            size="sm"
            type="button"
          >
            {creation_assistant_save_edit()}
          </Button>
          <Button
            onClick={() => dispatch({ type: 'ignore' })}
            size="sm"
            type="button"
            variant="ghost"
          >
            {creation_assistant_ignore()}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Document-timeline entry — proposal cards only; user seeds are hidden chrome. */
export function AssistantConversationEntry({
  message,
  streaming,
}: {
  message: UIMessage;
  streaming: boolean;
}) {
  // Seed / user turns are transport-only — never render as chat chrome.
  if (message.role !== 'assistant') return null;

  const content = messageText(message);
  const visibleParts = projectAssistantMessageParts(message.parts);
  if (!content && visibleParts.length === 0) return null;

  return (
    <article className="space-y-2">
      <AssistantMessageParts parts={message.parts} streaming={streaming} />
    </article>
  );
}

export function CreationAssistant({
  catalogModelId,
  context,
}: CreationAssistantProps) {
  const conversationRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/core/p1/assistant/stream',
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            catalogModelId,
            context,
            messages: messages
              .filter(
                (message) =>
                  message.role === 'user' || message.role === 'assistant'
              )
              .map((message) => ({
                role: message.role as 'user' | 'assistant',
                content: messageText(message),
              }))
              .filter((message) => message.content.trim().length > 0),
          } satisfies AssistantStreamRequest,
        }),
      }),
    [catalogModelId, context]
  );
  const { error, messages, sendMessage, status, stop } = useChat({
    id: `creation-assistant-${context.workId}`,
    transport,
    throttle: 50,
  });
  const streaming = status === 'submitted' || status === 'streaming';
  const proposalMessages = useMemo(
    () => messages.filter((message) => message.role === 'assistant'),
    [messages]
  );

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation || !stickToBottomRef.current) return;
    conversation.scrollTop = conversation.scrollHeight;
  }, [proposalMessages]);

  const requestSuggestions = async () => {
    if (streaming || proposalMessages.length > 0) return;
    stickToBottomRef.current = true;
    await sendMessage({ text: CREATION_ASSISTANT_SEED });
  };

  return (
    <section aria-label={creation_assistant_aria()} className="space-y-4">
      <h2 className="text-base font-medium tracking-tight">
        {creation_assistant_title()}
      </h2>

      {proposalMessages.length > 0 ? (
        <div
          aria-label={creation_assistant_conversation_aria()}
          aria-live="polite"
          aria-relevant="additions text"
          className="max-h-96 space-y-4 overflow-y-auto pr-1"
          onScroll={(event) => {
            stickToBottomRef.current = isConversationNearBottom(
              event.currentTarget
            );
          }}
          ref={conversationRef}
          role="log"
        >
          {proposalMessages.map((message, index) => {
            const isCurrentAssistant = index === proposalMessages.length - 1;
            return (
              <AssistantConversationEntry
                key={message.id}
                message={message}
                streaming={streaming && isCurrentAssistant}
              />
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-muted-foreground">
            {creation_assistant_empty()}
          </p>
          {streaming ? (
            <Button
              onClick={() => void stop()}
              size="sm"
              type="button"
              variant="outline"
            >
              {creation_assistant_stop()}
            </Button>
          ) : (
            <Button
              onClick={() => void requestSuggestions()}
              size="sm"
              type="button"
            >
              {creation_assistant_fetch()}
            </Button>
          )}
        </div>
      )}

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {creation_assistant_interrupted()}
        </p>
      ) : null}

      {streaming && proposalMessages.length > 0 ? (
        <Button
          onClick={() => void stop()}
          size="sm"
          type="button"
          variant="outline"
        >
          {creation_assistant_stop()}
        </Button>
      ) : null}
    </section>
  );
}
